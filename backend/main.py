import asyncio
import os
import sqlite3
import uuid
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import AsyncGenerator

import psycopg2
import psycopg2.extras
import pdfplumber
from google import genai
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from langchain_text_splitters import RecursiveCharacterTextSplitter

from graphiti_core import Graphiti
from graphiti_core.llm_client.gemini_client import GeminiClient
from graphiti_core.llm_client.config import LLMConfig
from graphiti_core.embedder.gemini import GeminiEmbedder, GeminiEmbedderConfig
from graphiti_core.cross_encoder.gemini_reranker_client import GeminiRerankerClient
from graphiti_core.driver.neo4j_driver import Neo4jDriver
from graphiti_core.nodes import EpisodeType
from neo4j import AsyncGraphDatabase

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
DATABASE_URL = os.environ.get("DATABASE_URL", "")
NEO4J_URI = os.environ.get("NEO4J_URI", "")
NEO4J_USERNAME = os.environ.get("NEO4J_USERNAME", "")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "")

gemini_client = genai.Client(api_key=GEMINI_API_KEY)

graphiti: Graphiti | None = None


async def _discover_neo4j_database() -> str:
    raw = AsyncGraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USERNAME, NEO4J_PASSWORD))
    try:
        async with raw.session(database="system") as session:
            result = await session.run("SHOW DATABASES WHERE name <> 'system'")
            records = await result.data()
            user_dbs = [r["name"] for r in records if r.get("name") != "system"]
            return user_dbs[0] if user_dbs else "neo4j"
    except Exception:
        return "neo4j"
    finally:
        await raw.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global graphiti
    try:
        db_name = await _discover_neo4j_database()
        print(f"[Graphiti] Using Neo4j database: {db_name}")
        llm_client = GeminiClient(
            LLMConfig(api_key=GEMINI_API_KEY, model="gemini-3.1-flash-lite")
        )
        embedder = GeminiEmbedder(
            GeminiEmbedderConfig(api_key=GEMINI_API_KEY, embedding_model="models/gemini-embedding-001")
        )
        cross_encoder = GeminiRerankerClient(
            LLMConfig(api_key=GEMINI_API_KEY, model="gemini-3.1-flash-lite")
        )
        graph_driver = Neo4jDriver(NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, database=db_name)
        graphiti = Graphiti(
            llm_client=llm_client,
            embedder=embedder,
            cross_encoder=cross_encoder,
            graph_driver=graph_driver,
        )
        await graphiti.build_indices_and_constraints()
        print("[Graphiti] Initialized successfully")
    except Exception as e:
        print(f"[Graphiti] Failed to initialize: {e}")
        graphiti = None
    yield
    if graphiti:
        await graphiti.close()


def get_db_conn():
    return psycopg2.connect(DATABASE_URL)


def _init_pg() -> None:
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id         SERIAL PRIMARY KEY,
                    pdf_id     TEXT NOT NULL,
                    role       TEXT NOT NULL,
                    content    TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS idx_chat_messages_pdf_id ON chat_messages(pdf_id)")
        conn.commit()


_init_pg()


DB_PATH = os.path.join(os.path.dirname(__file__), "pdf_metadata.db")


def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db() -> None:
    with _get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS pdf_metadata (
                pdf_id    TEXT PRIMARY KEY,
                pdf_name  TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.commit()


_init_db()

app = FastAPI(title="Handbook Generator API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def embed_text(text: str) -> list[float]:
    response = gemini_client.models.embed_content(
        model="gemini-embedding-001",
        contents=text,
        config={"output_dimensionality": 1536},
    )
    return response.embeddings[0].values


def embed_query(text: str) -> list[float]:
    response = gemini_client.models.embed_content(
        model="gemini-embedding-001",
        contents=text,
        config={"output_dimensionality": 1536},
    )
    return response.embeddings[0].values


class ChatRequest(BaseModel):
    pdf_id: str
    message: str


class HandbookRequest(BaseModel):
    pdf_id: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/pdfs")
async def list_pdfs():
    with _get_db() as conn:
        rows = conn.execute(
            "SELECT pdf_id, pdf_name, created_at FROM pdf_metadata ORDER BY created_at ASC"
        ).fetchall()
    return [{"pdf_id": r["pdf_id"], "pdf_name": r["pdf_name"], "created_at": r["created_at"]} for r in rows]


@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    pdf_id = str(uuid.uuid4())

    with _get_db() as meta_conn:
        existing = meta_conn.execute(
            "SELECT pdf_id FROM pdf_metadata WHERE pdf_name = ?", (file.filename,)
        ).fetchone()
        if existing:
            old_id = existing["pdf_id"]
            with get_db_conn() as pg:
                with pg.cursor() as cur:
                    cur.execute("DELETE FROM documents WHERE pdf_id = %s", (old_id,))
                pg.commit()
            meta_conn.execute("DELETE FROM pdf_metadata WHERE pdf_id = ?", (old_id,))
            meta_conn.commit()

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        full_text = []
        with pdfplumber.open(tmp_path) as pdf:
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    full_text.append(text)
    finally:
        os.unlink(tmp_path)

    if not full_text:
        raise HTTPException(status_code=422, detail="Could not extract text from PDF.")

    combined = "\n\n".join(full_text)

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=50,
        length_function=lambda t: len(t.split()),
    )
    chunks = splitter.split_text(combined)

    rows = []
    for chunk in chunks:
        embedding = embed_text(chunk)
        rows.append((pdf_id, chunk, embedding))

    with get_db_conn() as pg:
        with pg.cursor() as cur:
            psycopg2.extras.execute_values(
                cur,
                "INSERT INTO documents (pdf_id, content, embedding) VALUES %s",
                [(pdf_id, chunk, embedding) for pdf_id, chunk, embedding in rows],
                template="(%s, %s, %s::vector)",
            )
        pg.commit()

    now = datetime.now(timezone.utc).isoformat()
    with _get_db() as meta_conn:
        meta_conn.execute(
            "INSERT OR REPLACE INTO pdf_metadata (pdf_id, pdf_name, created_at) VALUES (?, ?, ?)",
            (pdf_id, file.filename, now),
        )
        meta_conn.commit()

    return {"pdf_id": pdf_id, "name": file.filename, "chunk_count": len(rows)}


@app.post("/chat")
async def chat(req: ChatRequest):
    query_embedding = embed_query(req.message)

    context_chunks = []
    try:
        with get_db_conn() as pg:
            with pg.cursor() as cur:
                cur.execute(
                    "SELECT content FROM match_documents(%s::vector, %s, %s)",
                    (query_embedding, 5, req.pdf_id),
                )
                context_chunks = [row[0] for row in cur.fetchall()]
    except Exception:
        pass

    if not context_chunks:
        with get_db_conn() as pg:
            with pg.cursor() as cur:
                cur.execute(
                    "SELECT content FROM documents WHERE pdf_id = %s LIMIT 5",
                    (req.pdf_id,),
                )
                context_chunks = [row[0] for row in cur.fetchall()]

    pdf_chunks = "\n\n".join(context_chunks)

    graphiti_facts = ""
    if graphiti:
        try:
            results = await graphiti.search(
                query=req.message,
                group_ids=[req.pdf_id],
                num_results=10,
            )
            facts = [r.fact for r in results if hasattr(r, "fact") and r.fact]
            if facts:
                graphiti_facts = "\n".join(f"- {f}" for f in facts)
        except Exception as exc:
            print(f"[Graphiti] search failed (non-critical): {type(exc).__name__}")

    prompt = (
        f"Previous conversation facts:\n{graphiti_facts}\n\n"
        f"PDF content:\n{pdf_chunks}\n\n"
        f"User question:\n{req.message}"
    )

    response = gemini_client.models.generate_content(
        model="gemini-3.1-flash-lite",
        contents=prompt,
    )
    reply = response.text if response.text else "Sorry, I couldn't generate a response."

    # Save to PostgreSQL immediately (reliable primary store)
    try:
        with get_db_conn() as pg:
            with pg.cursor() as cur:
                cur.execute(
                    "INSERT INTO chat_messages (pdf_id, role, content) VALUES (%s, %s, %s)",
                    (req.pdf_id, "user", req.message),
                )
                cur.execute(
                    "INSERT INTO chat_messages (pdf_id, role, content) VALUES (%s, %s, %s)",
                    (req.pdf_id, "ai", reply),
                )
            pg.commit()
    except Exception as e:
        print(f"[DB] Failed to save chat messages: {e}")

    # Also attempt Graphiti knowledge graph (best-effort background task)
    if graphiti:
        now = datetime.now(timezone.utc)

        async def _save_episode():
            try:
                await graphiti.add_episode(
                    name=f"chat_{req.pdf_id}_{now.timestamp()}",
                    episode_body=f"User: {req.message}\nAI: {reply}",
                    source_description=f"Chat for PDF {req.pdf_id}",
                    reference_time=now,
                    source=EpisodeType.message,
                    group_id=req.pdf_id,
                )
                print(f"[Graphiti] Episode saved for pdf_id={req.pdf_id[:8]}")
            except Exception as exc:
                print(f"[Graphiti] add_episode failed (non-critical): {type(exc).__name__}")

        asyncio.create_task(_save_episode())

    return {"reply": reply}


@app.get("/messages/{pdf_id}")
async def get_messages(pdf_id: str):
    try:
        with get_db_conn() as pg:
            with pg.cursor() as cur:
                cur.execute(
                    """
                    SELECT role, content, created_at
                    FROM chat_messages
                    WHERE pdf_id = %s
                    ORDER BY created_at ASC
                    LIMIT 400
                    """,
                    (pdf_id,),
                )
                rows = cur.fetchall()
        return [
            {"role": row[0], "content": row[1], "timestamp": row[2].isoformat()}
            for row in rows
        ]
    except Exception as e:
        print(f"[DB] get_messages failed: {e}")
        return []


HANDBOOK_SECTIONS = [
    ("Introduction", "Write a thorough Introduction of approximately 2000 words."),
    ("Section 1: Overview", "Write Section 1: Overview of approximately 2000 words."),
    ("Section 2: Core Concepts", "Write Section 2: Core Concepts of approximately 2000 words."),
    ("Section 3: Methodology", "Write Section 3: Methodology of approximately 2000 words."),
    ("Section 4: Implementation", "Write Section 4: Implementation of approximately 2000 words."),
    ("Section 5: Results and Analysis", "Write Section 5: Results and Analysis of approximately 2000 words."),
    ("Section 6: Best Practices", "Write Section 6: Best Practices of approximately 2000 words."),
    ("Conclusion", "Write a thorough Conclusion of approximately 2000 words."),
]


def generate_section(context: str, section_title: str, section_instruction: str, graphiti_facts: str = "", retries: int = 3) -> str:
    prompt = (
        "You are an expert technical writer. "
        "Using the provided document content as your primary source, write a comprehensive "
        "handbook of at least 20000 words. "
        "Expand thoroughly on every concept. "
        "Add detailed explanations, examples, and best practices. "
        "Where you reference specific information from the source document, add inline citations like [Source: document name]. "
        "Structure with: Table of Contents, Introduction, 8 detailed sections with subheadings, and Conclusion.\n\n"
        f"Previous conversation facts:\n{graphiti_facts}\n\n"
        f"PDF content:\n{context}\n\n"
        f"{section_instruction} Write in a professional, detailed style with subheadings where appropriate."
    )
    last_err = None
    for attempt in range(retries):
        try:
            response = gemini_client.models.generate_content(
                model="gemini-3.1-flash-lite",
                contents=prompt,
            )
            return response.text or ""
        except Exception as e:
            last_err = e
            err_str = str(e)
            if "503" in err_str or "overloaded" in err_str.lower():
                import time
                time.sleep(2 ** attempt)
                continue
            raise
    raise last_err


@app.post("/handbook")
async def generate_handbook(req: HandbookRequest):
    with get_db_conn() as pg:
        with pg.cursor() as cur:
            cur.execute(
                "SELECT content FROM documents WHERE pdf_id = %s",
                (req.pdf_id,),
            )
            rows = cur.fetchall()

    if not rows:
        raise HTTPException(status_code=404, detail="No document chunks found for this PDF.")

    all_content = "\n\n".join(row[0] for row in rows)

    graphiti_facts = ""
    if graphiti:
        try:
            results = await graphiti.search(
                query="key topics concepts facts",
                group_ids=[req.pdf_id],
                num_results=10,
            )
            facts = [r.fact for r in results if hasattr(r, "fact") and r.fact]
            if facts:
                graphiti_facts = "\n".join(f"- {f}" for f in facts)
        except Exception as exc:
            print(f"[Graphiti] search failed (non-critical): {type(exc).__name__}")

    async def stream_response() -> AsyncGenerator[bytes, None]:
        yield "# Handbook\n\n## Table of Contents\n\n".encode("utf-8")
        for i, (title, _) in enumerate(HANDBOOK_SECTIONS, 1):
            yield f"{i}. {title}\n".encode("utf-8")
        yield "\n---\n\n".encode("utf-8")

        for title, instruction in HANDBOOK_SECTIONS:
            yield f"## {title}\n\n".encode("utf-8")
            try:
                text = await asyncio.to_thread(generate_section, all_content, title, instruction, graphiti_facts)
                yield text.encode("utf-8")
            except Exception as e:
                yield f"*(Error generating this section: {e})*\n".encode("utf-8")
            yield "\n\n---\n\n".encode("utf-8")

    return StreamingResponse(stream_response(), media_type="text/plain; charset=utf-8")


@app.delete("/pdf/{pdf_id}")
async def delete_pdf(pdf_id: str):
    with get_db_conn() as pg:
        with pg.cursor() as cur:
            cur.execute("DELETE FROM documents WHERE pdf_id = %s", (pdf_id,))
        pg.commit()
    with _get_db() as meta_conn:
        meta_conn.execute("DELETE FROM pdf_metadata WHERE pdf_id = ?", (pdf_id,))
        meta_conn.commit()
    return {"success": True}

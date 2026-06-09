import asyncio
import os
import sqlite3
import uuid
import tempfile
from datetime import datetime, timezone
from typing import AsyncGenerator

import pdfplumber
from google import genai
from google.genai import types
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from supabase import create_client, Client
from langchain_text_splitters import RecursiveCharacterTextSplitter

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

client = genai.Client(api_key=GEMINI_API_KEY)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# ---------------------------------------------------------------------------
# SQLite metadata store — persists pdf_id + pdf_name + created_at on disk
# so the home screen survives app restarts and Replit sleeps.
# ---------------------------------------------------------------------------
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

app = FastAPI(title="Handbook Generator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def embed_text(text: str) -> list[float]:
    response = client.models.embed_content(
        model="gemini-embedding-001",
        contents=text,
        config={"output_dimensionality": 1536},
    )
    return response.embeddings[0].values


def embed_query(text: str) -> list[float]:
    response = client.models.embed_content(
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
        rows.append({
            "pdf_id": pdf_id,
            "content": chunk,
            "embedding": embedding,
        })

    supabase.table("documents").insert(rows).execute()

    # Persist metadata locally so the home screen survives restarts
    now = datetime.now(timezone.utc).isoformat()
    with _get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO pdf_metadata (pdf_id, pdf_name, created_at) VALUES (?, ?, ?)",
            (pdf_id, file.filename, now),
        )
        conn.commit()

    return {"pdf_id": pdf_id, "name": file.filename, "chunk_count": len(rows)}


@app.post("/chat")
async def chat(req: ChatRequest):
    query_embedding = embed_query(req.message)

    try:
        result = supabase.rpc(
            "match_documents",
            {
                "query_embedding": query_embedding,
                "match_count": 5,
                "filter_pdf_id": req.pdf_id,
            },
        ).execute()
        context_chunks = [r["content"] for r in (result.data or [])]
    except Exception:
        context_chunks = []

    if not context_chunks:
        rows = (
            supabase.table("documents")
            .select("content")
            .eq("pdf_id", req.pdf_id)
            .limit(5)
            .execute()
        )
        context_chunks = [r["content"] for r in (rows.data or [])]

    context = "\n\n".join(context_chunks)

    prompt = (
        f"Use the following document excerpts to answer the question.\n\n"
        f"Document context:\n{context}\n\n"
        f"Question: {req.message}"
    )

    response = client.models.generate_content(
        model="gemini-3.1-flash-lite",
        contents=prompt,
    )
    reply = response.text if response.text else "Sorry, I couldn't generate a response."

    return {"reply": reply}


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


def generate_section(context: str, section_title: str, section_instruction: str, retries: int = 3) -> str:
    prompt = (
        "You are an expert technical writer. "
        "Using the provided document content as your primary source, write a comprehensive "
        "handbook of at least 20000 words. "
        "Expand thoroughly on every concept. "
        "Add detailed explanations, examples, and best practices. "
        "Where you reference specific information from the source document, add inline citations like [Source: document name]. "
        "Structure with: Table of Contents, Introduction, 8 detailed sections with subheadings, and Conclusion.\n\n"
        f"Document content:\n{context}\n\n"
        f"{section_instruction} Write in a professional, detailed style with subheadings where appropriate."
    )
    last_err = None
    for attempt in range(retries):
        try:
            response = client.models.generate_content(
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
    rows = (
        supabase.table("documents")
        .select("content")
        .eq("pdf_id", req.pdf_id)
        .execute()
    )

    if not rows.data:
        raise HTTPException(status_code=404, detail="No document chunks found for this PDF.")

    all_content = "\n\n".join(r["content"] for r in rows.data)

    async def stream_response() -> AsyncGenerator[bytes, None]:
        yield "# Handbook\n\n## Table of Contents\n\n".encode("utf-8")
        for i, (title, _) in enumerate(HANDBOOK_SECTIONS, 1):
            yield f"{i}. {title}\n".encode("utf-8")
        yield "\n---\n\n".encode("utf-8")

        for title, instruction in HANDBOOK_SECTIONS:
            yield f"## {title}\n\n".encode("utf-8")
            try:
                # Run the blocking Gemini call in a thread so the event loop
                # stays free to flush buffered chunks to the client
                text = await asyncio.to_thread(generate_section, all_content, title, instruction)
                yield text.encode("utf-8")
            except Exception as e:
                yield f"*(Error generating this section: {e})*\n".encode("utf-8")
            yield "\n\n---\n\n".encode("utf-8")

    return StreamingResponse(stream_response(), media_type="text/plain; charset=utf-8")


@app.delete("/pdf/{pdf_id}")
async def delete_pdf(pdf_id: str):
    supabase.table("documents").delete().eq("pdf_id", pdf_id).execute()
    with _get_db() as conn:
        conn.execute("DELETE FROM pdf_metadata WHERE pdf_id = ?", (pdf_id,))
        conn.commit()
    return {"success": True}

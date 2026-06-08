import os
import uuid
import tempfile
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
        model="models/embedding-001",
        contents=text,
        config=types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT"),
    )
    return response.embeddings[0].values


def embed_query(text: str) -> list[float]:
    response = client.models.embed_content(
        model="models/embedding-001",
        contents=text,
        config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY"),
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
        model="gemini-1.5-flash",
        contents=prompt,
    )
    reply = response.text if response.text else "Sorry, I couldn't generate a response."

    return {"reply": reply}


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

    system_prompt = (
        "You are an expert technical writer. "
        "Using the provided document content, write a comprehensive handbook of at least 20000 words. "
        "Structure it with:\n"
        "1. Table of Contents\n"
        "2. Introduction\n"
        "3. Minimum 8 detailed sections with subheadings\n"
        "4. Conclusion\n"
        "Use all provided content thoroughly. Be detailed and comprehensive."
    )

    full_prompt = f"{system_prompt}\n\nDocument content:\n\n{all_content}"

    async def stream_response() -> AsyncGenerator[bytes, None]:
        for chunk in client.models.generate_content_stream(
            model="gemini-1.5-flash",
            contents=full_prompt,
        ):
            if chunk.text:
                yield chunk.text.encode("utf-8")

    return StreamingResponse(stream_response(), media_type="text/plain; charset=utf-8")


@app.delete("/pdf/{pdf_id}")
async def delete_pdf(pdf_id: str):
    supabase.table("documents").delete().eq("pdf_id", pdf_id).execute()
    return {"success": True}

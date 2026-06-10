# Handbook Generator

A full-stack AI chat application that converts 
uploaded PDF documents into 20,000-word 
structured handbooks through a conversational 
interface.

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | React 19, TanStack Start, shadcn/ui, Tailwind CSS |
| Backend | Python 3.11, FastAPI, Uvicorn |
| LLM | Google Gemini 3.1 Flash Lite |
| Embeddings | Google Gemini Embedding 001 (1536 dimensions) |
| Vector Storage | Supabase pgvector |
| Metadata Storage | SQLite |
| PDF Processing | pdfplumber |

## Features

- Upload multiple PDF documents
- Each PDF has its own isolated chat workspace
- Ask questions about uploaded document content
- Type "generate handbook" to trigger 20,000 word 
  structured document generation
- Automatic duplicate prevention — re-uploading 
  same PDF replaces old data cleanly
- PDF list persists across app restarts
- Streaming output for handbook generation

## How to Run

### Prerequisites
- Python 3.11+
- Bun or Node.js
- Supabase account with pgvector enabled
- Google Gemini API key

### Environment Variables
Add these to Replit Secrets or .env file:
- SUPABASE_URL
- SUPABASE_SERVICE_KEY
- SUPABASE_PUBLISHABLE_KEY
- GEMINI_API_KEY

### Supabase Setup
Run this SQL in your Supabase SQL editor:

create extension if not exists vector;

create table documents (
  id uuid primary key default gen_random_uuid(),
  pdf_id text not null,
  content text not null,
  embedding vector(1536),
  created_at timestamp default now()
);

create index on documents 
using ivfflat (embedding vector_cosine_ops);

### Start the App
bash start.sh

This starts:
- Backend (FastAPI) on port 8000
- Frontend (React) on port 5000

## Known Limitations & Roadmap

- Chat history does not persist across sessions 
  (planned: store messages in Supabase)
- No handbook download button yet 
  (planned: export to PDF/Markdown)
- Delete icon positioning needs UI adjustment
  (limited by development credits)

## Built For
LunarTech AI Engineering Fellowship Assignment

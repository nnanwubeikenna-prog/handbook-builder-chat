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
## Architecture Decisions

### How the 20,000 Word Problem Was Solved

Large language models have an output token limit. 
Sending a single request asking Gemini to write 
20,000 words fails because the model stops 
generating well before reaching that length. 
This is a known limitation of all LLMs including 
GPT, Claude, and Gemini.

The solution implemented here is sequential 
section generation, which is the same principle 
behind the LongWriter technique referenced in 
the assignment documentation.

Instead of one request, the backend makes 8 
separate focused requests to Gemini, one per 
section:

Request 1: Write the Introduction
Request 2: Write the Overview section
Request 3: Write the Core Concepts section
Request 4: Write the Methodology section
Request 5: Write the Implementation section
Request 6: Write the Results and Analysis section
Request 7: Write the Best Practices section
Request 8: Write the Conclusion

Each request receives the full PDF context 
retrieved from Supabase pgvector. Each response 
is approximately 2,000 words. All 8 responses 
are combined and streamed to the frontend 
progressively as each section completes, so 
the user sees text appearing in real time 
rather than waiting for the full document.

Total output: 16,000 to 20,000+ words per 
handbook generation.

### How Duplicate Data Was Prevented

Every time a PDF is uploaded, the backend 
generates a unique ID using uuid4. Without 
duplicate prevention, uploading the same PDF 
twice would create two separate sets of chunks 
in Supabase, bloating the database and returning 
duplicate results during search.

The solution: before inserting new chunks, the 
backend checks the SQLite metadata store for any 
existing PDF with the same filename. If found, 
it deletes all matching chunks from Supabase and 
removes the metadata row from SQLite first. Then 
the fresh upload proceeds under a new unique ID.

This keeps the database clean automatically 
without any manual intervention from the user.

### How PDF Isolation Works

Each uploaded PDF gets its own unique ID stored 
in SQLite. When a user opens a PDF chat and asks 
a question, the backend only retrieves chunks 
from Supabase that match that specific PDF ID. 
This means conversations about one document 
never mix with content from another document, 
even if both documents cover similar topics.

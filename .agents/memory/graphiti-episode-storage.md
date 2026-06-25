---
name: Graphiti add_episode reliability
description: Graphiti's add_episode is not suitable as the sole chat-history store; it makes many Gemini LLM calls and 503s frequently.
---

## Rule
Use PostgreSQL as the primary/reliable store for chat messages. Use Graphiti `add_episode` as a best-effort background task only.

**Why:** `add_episode` performs entity extraction, deduplication, and relationship building — multiple internal Gemini LLM calls. Under model load (503 UNAVAILABLE), these fail silently if wrapped in `asyncio.create_task` without logging. This makes chat history unreliable if Graphiti is the only store.

**How to apply:**
1. Store user+AI messages in a `chat_messages` PostgreSQL table immediately on every `/chat` request (synchronous, always reliable).
2. Fire `asyncio.create_task(_save_episode())` with a try/except that logs the error — non-critical.
3. Serve `GET /messages/{pdf_id}` from PostgreSQL, not from `graphiti.retrieve_episodes`.

**Additional note:** Always wrap `asyncio.create_task` bodies with try/except and log, because unhandled exceptions in tasks are silently dropped in Python's asyncio.

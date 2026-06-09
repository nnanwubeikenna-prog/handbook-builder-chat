#!/bin/bash
set -e

ulimit -n 65536 2>/dev/null || true

echo "Starting backend..."
uvicorn backend.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

echo "Starting frontend..."
bun run dev &
FRONTEND_PID=$!

cleanup() {
  echo "Shutting down..."
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
  wait
}
trap cleanup SIGINT SIGTERM EXIT

wait

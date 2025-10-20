#!/usr/bin/env bash
gunicorn app:app \
  -k uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:${PORT:-8000} \
  --workers 2 --threads 8 --timeout 120

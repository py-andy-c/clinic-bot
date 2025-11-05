#!/bin/bash
set -e

# Ensure we're in the backend directory (where alembic.ini is)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Check if alembic directory exists and run migrations
if [ -d "alembic" ] && [ -f "alembic.ini" ]; then
    alembic upgrade head
else
    echo "Warning: Alembic directory not found, skipping migrations"
    echo "Current directory: $(pwd)"
    echo "Directory contents:"
    ls -la | head -10
fi

# Start the app from src directory
cd src
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}


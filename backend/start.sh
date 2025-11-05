#!/bin/bash
set -e

# Ensure we're in the backend directory (where alembic.ini is)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Fix alembic directory structure if files are in wrong location
# Railway/Nixpacks sometimes copies alembic/ contents to root instead of into alembic/
if [ ! -d "alembic" ] && [ -f "alembic.ini" ] && [ -f "env.py" ] && [ -d "versions" ]; then
    echo "Fixing alembic directory structure..."
    mkdir -p alembic
    mv env.py script.py.mako alembic/ 2>/dev/null || true
    if [ -d "versions" ] && [ ! -d "alembic/versions" ]; then
        mv versions alembic/ 2>/dev/null || true
    fi
fi

# Run migrations if alembic directory exists
if [ -d "alembic" ] && [ -f "alembic.ini" ]; then
    alembic upgrade head
else
    echo "Warning: Alembic directory not found, skipping migrations"
fi

# Start the app from src directory
cd src
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}


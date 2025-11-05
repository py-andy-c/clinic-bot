#!/bin/bash
set -e

# Run migrations from backend directory (where alembic.ini is)
# Then start the app from src directory (where main.py is)
cd "$(dirname "$0")"
alembic upgrade head || echo "Warning: Migration failed, continuing..."
cd src
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}


#!/bin/bash
set -e

# Railway deployment startup script
# Ensures proper directory structure and runs migrations before starting the app

# Ensure we're in the backend directory (where alembic.ini is)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Fix alembic directory structure if Nixpacks flattened it
# This handles a known Nixpacks quirk where subdirectories may be flattened
if [ ! -d "alembic" ] && [ -f "alembic.ini" ]; then
    if [ -f "env.py" ] || [ -d "versions" ]; then
        echo "Fixing alembic directory structure..."
        mkdir -p alembic
        [ -f "env.py" ] && mv env.py alembic/ 2>/dev/null || true
        [ -f "script.py.mako" ] && mv script.py.mako alembic/ 2>/dev/null || true
        [ -d "versions" ] && [ ! -d "alembic/versions" ] && mv versions alembic/ 2>/dev/null || true
    fi
fi

# Run database migrations
if [ -d "alembic" ] && [ -f "alembic.ini" ]; then
    # Check if database is fresh (no alembic_version table)
    if ! alembic current 2>/dev/null | grep -q "alembic_version"; then
        echo "Fresh database detected - creating initial schema..."
        cd src
        python -c "
from core.database import Base, engine
from core.config import DATABASE_URL
print(f'Creating tables in: {DATABASE_URL}')
Base.metadata.create_all(bind=engine)
print('Tables created successfully')
"
        cd ..
        echo "Stamping database with latest migration version..."
        alembic stamp head
    else
        echo "Running migrations..."
        alembic upgrade head
    fi
else
    echo "Warning: Alembic directory not found, skipping migrations"
fi

# Start the application
# Railway sets PORT environment variable automatically
cd src
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"


#!/bin/bash
set -e

# Railway deployment startup script
# Ensures proper directory structure and runs migrations before starting the app
# Best practice: Fail fast if migrations fail - do not start app with inconsistent schema

# Ensure we're in the backend directory (where alembic.ini is)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Fix alembic directory structure if Nixpacks flattened it
# This handles a known Nixpacks quirk where subdirectories may be flattened
if [ ! -d "alembic" ] && [ -f "alembic.ini" ]; then
    if [ -f "env.py" ] || [ -d "versions" ]; then
        echo "Fixing alembic directory structure..."
        mkdir -p alembic
        [ -f "env.py" ] && mv env.py alembic/ || true
        [ -f "script.py.mako" ] && mv script.py.mako alembic/ || true
        [ -d "versions" ] && [ ! -d "alembic/versions" ] && mv versions alembic/ || true
    fi
fi

# Run database migrations - CRITICAL: Must succeed before starting app
if [ -d "alembic" ] && [ -f "alembic.ini" ]; then
    # Handle migration history reset transition
    # If database has old migration revision, stamp it to baseline
    CURRENT_REV=$(alembic current 2>&1 | grep -oE '[a-f0-9]{12}' | head -1 || echo "")
    BASELINE_REV="680334b106f8"
    
    # Check if we have a revision that's not our baseline (old migration system)
    if [ -n "$CURRENT_REV" ] && [ "$CURRENT_REV" != "$BASELINE_REV" ]; then
        echo "⚠️  Detected old migration revision: $CURRENT_REV"
        echo "📋 This database was created with old migrations (pre-baseline reset)."
        echo "🔄 Stamping database to new baseline migration ($BASELINE_REV)..."
        echo "   Note: This assumes the schema already matches the baseline."
        echo "   If schema differs, you may need to create a bridge migration."
        
        if alembic stamp "$BASELINE_REV" 2>&1; then
            echo "✅ Database stamped to baseline successfully"
        else
            echo "❌ ERROR: Failed to stamp database to baseline" >&2
            echo "   You may need to manually verify the schema matches" >&2
            exit 1
        fi
    fi
    
    # Run migrations - baseline migration handles everything (fresh or existing)
    echo "Running migrations..."
    if ! alembic upgrade head; then
        echo "ERROR: Database migrations failed. Aborting startup." >&2
        echo "The application will not start with an inconsistent database schema." >&2
        exit 1
    fi
    echo "✅ Migrations completed successfully"
else
    echo "ERROR: Alembic directory or config not found. Cannot proceed without migrations." >&2
    echo "This is a critical error - migrations are required for database consistency." >&2
    exit 1
fi

# Start the application only after successful migrations
# Railway sets PORT environment variable automatically
echo "Starting application..."
cd src
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"


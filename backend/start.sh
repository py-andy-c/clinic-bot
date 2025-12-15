#!/bin/bash
set -e

# Railway deployment startup script
# Ensures proper directory structure and runs migrations before starting the app
# Best practice: Fail fast if migrations fail - do not start app with inconsistent schema

# Enable verbose output for debugging (shows each command as it runs)
# Comment out if too verbose: set -x

# Ensure we're in the backend directory (where alembic.ini is)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "🚀 Starting Railway deployment"
echo "=========================================="
echo "Working directory: $(pwd)"
echo "Python version: $(python3 --version 2>&1 || echo 'Python not found')"
echo "PORT: ${PORT:-8000}"
echo "=========================================="

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
    # Only stamp to baseline if we have an invalid/unknown revision
    # Valid revisions in the chain should be upgraded normally
    echo "Checking current database migration state..."
    CURRENT_REV=$(alembic current 2>&1 | grep -oE '[a-f0-9]{12}' | head -1 || echo "")
    BASELINE_REV="680334b106f8"
    
    if [ -n "$CURRENT_REV" ]; then
        echo "Current migration revision: $CURRENT_REV"
        # Check if the revision exists in our migration history
        if ! alembic history | grep -q "$CURRENT_REV"; then
            echo "⚠️  Detected invalid/unknown migration revision: $CURRENT_REV"
            echo "📋 This database has a revision not in the current migration chain."
            echo "🔄 Stamping database to baseline migration ($BASELINE_REV)..."
            echo "   Note: This assumes the schema already matches the baseline."
            echo "   If schema differs, you may need to create a bridge migration."
            
            if ! alembic stamp "$BASELINE_REV" 2>&1; then
                echo "❌ ERROR: Failed to stamp database to baseline" >&2
                echo "   You may need to manually verify the schema matches" >&2
                exit 1
            fi
            echo "✅ Database stamped to baseline successfully"
        else
            echo "✅ Current revision $CURRENT_REV is valid in migration chain"
        fi
    else
        echo "No current migration revision found (fresh database or uninitialized)"
    fi
    
    # Run migrations - baseline migration handles everything (fresh or existing)
    echo "=========================================="
    echo "🔄 Running database migrations..."
    echo "=========================================="
    if ! alembic upgrade head 2>&1; then
        echo "❌ ERROR: Database migrations failed. Aborting startup." >&2
        echo "The application will not start with an inconsistent database schema." >&2
        echo "Check the migration output above for details." >&2
        exit 1
    fi
    echo "✅ Migrations completed successfully"
    
    # Verify final migration state
    FINAL_REV=$(alembic current 2>&1 | grep -oE '[a-f0-9]{12}' | head -1 || echo "")
    echo "Final migration revision: ${FINAL_REV:-'none'}"
else
    echo "ERROR: Alembic directory or config not found. Cannot proceed without migrations." >&2
    echo "This is a critical error - migrations are required for database consistency." >&2
    exit 1
fi

# Validate critical environment variables
echo "=========================================="
echo "🔍 Validating environment variables..."
echo "=========================================="
if [ -z "$DATABASE_URL" ]; then
    echo "❌ ERROR: DATABASE_URL environment variable is not set" >&2
    exit 1
fi
echo "✅ DATABASE_URL is set"

# Check if we can import the main module (catches import errors early)
echo "=========================================="
echo "🔍 Testing Python imports..."
echo "=========================================="
if ! python3 -c "import sys; sys.path.insert(0, 'src'); from main import app; print('✅ Main module imports successfully')" 2>&1; then
    echo "❌ ERROR: Failed to import main module" >&2
    echo "This usually indicates:" >&2
    echo "  1. Missing Python dependencies" >&2
    echo "  2. Import errors in the code" >&2
    echo "  3. Missing environment variables required at import time" >&2
    exit 1
fi

# Check if uvicorn is available
if ! command -v uvicorn &> /dev/null; then
    echo "❌ ERROR: uvicorn command not found" >&2
    echo "This usually indicates missing dependencies. Check requirements.txt installation." >&2
    exit 1
fi

# Start the application only after successful migrations
# Railway sets PORT environment variable automatically
echo "=========================================="
echo "🚀 Starting application server..."
echo "=========================================="
PORT=${PORT:-8000}
echo "Command: uvicorn main:app --host 0.0.0.0 --port $PORT"
echo "Working directory: $(pwd)"
echo "=========================================="

# Change to src directory for uvicorn
cd src || {
    echo "❌ ERROR: Failed to change to src directory" >&2
    exit 1
}

# Start uvicorn with explicit error handling
# Use exec to replace shell process with uvicorn
exec uvicorn main:app --host 0.0.0.0 --port "$PORT" --log-level info


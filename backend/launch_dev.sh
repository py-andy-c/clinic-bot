#!/bin/bash

# Script to launch the FastAPI development server
# Kills existing uvicorn processes and starts fresh

# Set log file path for E2E tests - write immediately to ensure we capture everything
BACKEND_LOG_FILE="${E2E_BACKEND_LOG_FILE:-/tmp/backend_e2e.log}"

# ALWAYS write to log file first thing, even before checking E2E_TEST_MODE
# This ensures we capture if the script is even being called
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [BACKEND-STARTUP] ========== Script EXECUTED ==========" >> "$BACKEND_LOG_FILE" 2>&1
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [BACKEND-STARTUP] Script path: $0" >> "$BACKEND_LOG_FILE" 2>&1
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [BACKEND-STARTUP] E2E_TEST_MODE=${E2E_TEST_MODE:-not set}" >> "$BACKEND_LOG_FILE" 2>&1
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [BACKEND-STARTUP] DATABASE_URL=${DATABASE_URL:-not set}" >> "$BACKEND_LOG_FILE" 2>&1
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [BACKEND-STARTUP] PWD=$(pwd)" >> "$BACKEND_LOG_FILE" 2>&1

if [ "$E2E_TEST_MODE" = "true" ]; then
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [BACKEND-STARTUP] Writing all logs to: $BACKEND_LOG_FILE" >> "$BACKEND_LOG_FILE" 2>&1
    # Redirect all output to both stdout and log file
    exec > >(tee -a "$BACKEND_LOG_FILE") 2>&1
fi

echo "🚀 Launching Clinic Bot Development Server..."

# Kill existing uvicorn processes
echo "🛑 Killing existing uvicorn processes..."
pkill -f uvicorn 2>/dev/null || true
sleep 2

# Check and start PostgreSQL if not running
echo "🔍 Checking PostgreSQL status..."
if ! pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
    # For E2E tests, don't try to start PostgreSQL - just check if it's available
    if [ "$E2E_TEST_MODE" = "true" ]; then
        echo "⚠️  PostgreSQL is not running. For E2E tests, please ensure PostgreSQL is running."
        echo "   You can start it with: brew services start postgresql@14"
        echo "   Or use: pg_ctl -D /usr/local/var/postgresql@14 start"
        exit 1
    fi
    
    echo "⚠️  PostgreSQL is not running. Starting postgresql@14..."
    brew services restart postgresql@14 2>/dev/null || brew services start postgresql@14 2>/dev/null || true
    
    # Wait for PostgreSQL to be ready
    echo "⏳ Waiting for PostgreSQL to be ready..."
    for i in {1..10}; do
        if pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
            echo "✅ PostgreSQL is now running and accepting connections"
            break
        fi
        sleep 1
    done
    
    if ! pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
        echo "❌ ERROR: Could not start PostgreSQL. Please start it manually and try again." >&2
        exit 1
    fi
else
    echo "✅ PostgreSQL is running and accepting connections"
fi

# Activate virtual environment
source venv/bin/activate

# Run database migrations before starting server
echo "🔄 Running database migrations..."
if [ -d "alembic" ] && [ -f "alembic.ini" ]; then
    if alembic upgrade head; then
        echo "✅ Migrations completed successfully"
    else
        echo "❌ ERROR: Database migrations failed. Aborting startup." >&2
        echo "Please fix migration issues before starting the server." >&2
        exit 1
    fi
else
    echo "⚠️  WARNING: Alembic directory or config not found. Skipping migrations." >&2
    echo "This may cause errors if the database schema is out of date." >&2
fi

# Launch uvicorn with hot reload (foreground so logs are visible)
echo ""
echo "🌟 Starting FastAPI server with hot reload (logs visible below)..."
echo "🛑 Press Ctrl+C to stop server"
echo ""
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [BACKEND-STARTUP] Starting uvicorn server on port 8000..."
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [BACKEND-STARTUP] Command: cd src && uvicorn main:app --host 0.0.0.0 --port 8000 --log-level info --no-access-log"

# Ensure unbuffered output for immediate log visibility
export PYTHONUNBUFFERED=1
cd src && exec uvicorn main:app --host 0.0.0.0 --port 8000 --log-level info --no-access-log

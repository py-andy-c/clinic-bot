#!/bin/bash

# Script to launch the FastAPI development server
# Kills existing uvicorn processes and starts fresh

echo "🚀 Launching Clinic Bot Development Server..."

# Kill existing uvicorn processes
echo "🛑 Killing existing uvicorn processes..."
pkill -f uvicorn 2>/dev/null || true
sleep 2

# Check and start PostgreSQL if not running
echo "🔍 Checking PostgreSQL status..."
if ! pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
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
cd src && uvicorn main:app --host 0.0.0.0 --port 8000 --reload

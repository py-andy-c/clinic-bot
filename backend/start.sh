#!/bin/bash
set -e

# Set PYTHONPATH to include the backend directory so Python can find src modules
export PYTHONPATH="${PYTHONPATH}:$(pwd)"

# Run database migrations
echo "Running database migrations..."
alembic upgrade head

# Start the application
echo "Starting application..."
exec uvicorn src.main:app --host 0.0.0.0 --port ${PORT:-8000}


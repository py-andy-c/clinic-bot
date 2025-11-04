#!/bin/bash
set -e

# Get the directory where this script is located (backend directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Change to backend directory to ensure we're in the right place
cd "${SCRIPT_DIR}"

# Set PYTHONPATH to include the backend directory so Python can find src modules
export PYTHONPATH="${PYTHONPATH}:${SCRIPT_DIR}"

echo "Working directory: $(pwd)"
echo "PYTHONPATH: ${PYTHONPATH}"
echo "Checking src directory:"
ls -la src/ | head -5 || echo "src directory not found"

# Run database migrations (must be run from backend directory where alembic.ini is)
echo "Running database migrations..."
alembic upgrade head

# Change to src directory and run uvicorn from there
# This makes imports work naturally since we're in the src directory
cd src
echo "Changed to src directory: $(pwd)"

# Start the application
echo "Starting application..."
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}


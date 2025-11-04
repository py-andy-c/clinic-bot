#!/bin/bash
set -e

# Enable verbose logging
set -x

# Get the directory where this script is located (backend directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Change to backend directory to ensure we're in the right place
cd "${SCRIPT_DIR}"

echo "=== Startup Script Debug Info ==="
echo "Script directory: ${SCRIPT_DIR}"
echo "Current working directory: $(pwd)"
echo "PORT environment variable: ${PORT:-8000}"

# Set PYTHONPATH to include the backend directory so Python can find src modules
export PYTHONPATH="${PYTHONPATH}:${SCRIPT_DIR}"
echo "PYTHONPATH: ${PYTHONPATH}"

echo "=== Checking directory structure ==="
echo "Contents of current directory:"
ls -la | head -10
echo ""
echo "Contents of src directory:"
ls -la src/ | head -10 || echo "ERROR: src directory not found!"
echo ""
echo "Checking if api module exists:"
ls -la src/api/ | head -5 || echo "ERROR: src/api directory not found!"

# Run database migrations (must be run from backend directory where alembic.ini is)
echo ""
echo "=== Running database migrations ==="
alembic upgrade head || echo "WARNING: Migration failed, continuing anyway..."

# Change to src directory and run uvicorn from there
# This makes imports work naturally since we're in the src directory
echo ""
echo "=== Changing to src directory ==="
cd src
echo "Changed to src directory: $(pwd)"
echo "Verifying we can see api module:"
ls -la api/ | head -3 || echo "ERROR: Cannot find api module!"

# Start the application
echo ""
echo "=== Starting application ==="
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}


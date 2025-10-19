#!/bin/bash

# Script to launch the FastAPI development server
# Kills existing uvicorn processes and starts fresh

echo "🚀 Launching Clinic Bot Development Server..."

# Kill existing uvicorn processes
echo "🛑 Killing existing uvicorn processes..."
pkill -f uvicorn 2>/dev/null || true
sleep 2

# Activate virtual environment
source venv/bin/activate

# Launch uvicorn with hot reload (foreground so logs are visible)
echo ""
echo "🌟 Starting FastAPI server with hot reload (logs visible below)..."
echo "🛑 Press Ctrl+C to stop server"
echo ""
cd src && uvicorn main:app --host 0.0.0.0 --port 8000 --reload

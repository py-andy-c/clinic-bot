#!/bin/bash

# Simple script to launch the LINE bot
# Kills existing processes and starts fresh

echo "🚀 Launching Clinic Bot..."

# Kill existing processes
echo "🛑 Killing existing processes..."
pkill -f uvicorn 2>/dev/null || true
pkill -f ngrok 2>/dev/null || true
sleep 2

# Activate virtual environment
source venv/bin/activate

# Launch ngrok in background first
echo "🌐 Starting ngrok tunnel..."
ngrok http 8000 &
NGROK_PID=$!

# Wait for ngrok to start
sleep 3

# Show ngrok URL
echo "🌐 ngrok URL:"
curl -s http://localhost:4040/api/tunnels | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    if 'tunnels' in data and data['tunnels']:
        tunnel = data['tunnels'][0]
        print(f'   {tunnel[\"public_url\"]}')
        print(f'   Webhook: {tunnel[\"public_url\"]}/webhook/line')
except:
    print('   Could not get ngrok URL')
"

# Launch uvicorn with hot reload (foreground so logs are visible)
echo ""
echo "🌟 Starting FastAPI server with hot reload (logs visible below)..."
echo "🛑 Press Ctrl+C to stop both server and ngrok"
echo ""
PYTHONPATH="$PWD/src" uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload

#!/bin/bash

# Script to launch ngrok tunnel
# Kills existing ngrok processes and starts fresh

echo "🚀 Launching ngrok tunnel..."

# Kill existing ngrok processes
echo "🛑 Killing existing ngrok processes..."
pkill -f ngrok 2>/dev/null || true
sleep 2

# Activate virtual environment (in case ngrok needs it for config)
source venv/bin/activate

# Launch ngrok in background
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

echo ""
echo "🌐 ngrok tunnel is running in the background"
echo "🛑 Run 'pkill -f ngrok' to stop it"

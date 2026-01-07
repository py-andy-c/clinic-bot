#!/bin/bash

# Simple test runner script
echo "Running backend tests..."
cd backend && bash run_backend_tests.sh
BACKEND_EXIT=$?

echo "Running frontend tests..."  
cd ../frontend && bash run_frontend_tests.sh
FRONTEND_EXIT=$?

if [ $BACKEND_EXIT -ne 0 ] || [ $FRONTEND_EXIT -ne 0 ]; then
    echo "❌ Some tests failed!"
    exit 1
else
    echo "✅ All tests passed!"
    exit 0
fi

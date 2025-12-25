#!/bin/bash

# Frontend Test Driver Script
# Runs TypeScript type checking and unit tests for the frontend

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Determine script location and frontend directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR"

print_status "Frontend Test Driver"
print_status "Frontend directory: $FRONTEND_DIR"

# Navigate to frontend directory
cd "$FRONTEND_DIR"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    print_error "node_modules not found!"
    print_error "Please run: npm install"
    exit 1
fi

# Create minimal .env file for tests if it doesn't exist (to avoid permission errors)
# Vite will try to load .env during config initialization, so we need it to exist and be readable
if [ ! -f ".env" ]; then
    print_status "Creating minimal .env file for tests..."
    if (echo "VITE_API_BASE_URL=/api" > .env && echo "VITE_LIFF_ID=test-liff-id" >> .env) 2>/dev/null; then
        print_success "Created .env file for tests"
    else
        print_warning "Could not create .env file - tests may fail if file cannot be read"
    fi
elif [ ! -r ".env" ]; then
    # File exists but may not be readable - try to recreate it
    print_warning ".env file exists but may not be readable, attempting to recreate..."
    if (echo "VITE_API_BASE_URL=/api" > .env && echo "VITE_LIFF_ID=test-liff-id" >> .env) 2>/dev/null; then
        print_success "Recreated .env file for tests"
    else
        print_warning "Could not recreate .env file - tests may fail"
    fi
fi

# Check if package.json exists
if [ ! -f "package.json" ]; then
    print_error "package.json not found!"
    exit 1
fi

# Run TypeScript type checking (with incremental mode for faster subsequent runs)
print_status "Running TypeScript type checking..."
if ./node_modules/.bin/tsc --noEmit --incremental; then
    print_success "TypeScript type checking passed!"
else
    print_error "TypeScript type checking failed!"
    exit 1
fi

# Run frontend unit tests
# Set environment variables for tests (in case .env file can't be read)
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-/api}"
export VITE_LIFF_ID="${VITE_LIFF_ID:-test-liff-id}"

print_status "Running frontend unit tests..."
if npm test -- --run; then
    print_success "Frontend unit tests passed!"
else
    print_error "Frontend unit tests failed!"
    exit 1
fi

# Final success message
echo ""
print_success "✅ All Frontend Tests Passed!"
print_success "🔍 TypeScript: All type checks passed"
print_success "✅ Unit tests: All passed"
exit 0


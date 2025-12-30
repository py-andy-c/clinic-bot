#!/bin/bash

# Frontend Test Driver Script
# Runs TypeScript type checking and unit tests for the frontend
# Updated to handle .env file permission issues
#
# Usage:
#   ./run_frontend_tests.sh           - Run tests for changed files only (fast)
#   ./run_frontend_tests.sh --no-cache - Run full test suite

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

# Parse command line arguments
NO_CACHE=false
for arg in "$@"; do
    case $arg in
        --no-cache)
            NO_CACHE=true
            ;;
        --help|-h)
            echo "Usage: $0 [--no-cache]"
            echo ""
            echo "Options:"
            echo "  (no flags)   Run tests for changed files only (fast)"
            echo "  --no-cache   Run full test suite"
            echo "  --help       Show this help message"
            exit 0
            ;;
        *)
            print_error "Unknown option: $arg"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

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

# Note: We no longer need to create/fix .env file for tests
# vitest.config.ts is configured with envDir: undefined to prevent Vite from loading .env files
# Environment variables are provided via the define block in vitest.config.ts
# This eliminates permission issues with .env files during test runs

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

if [ "$NO_CACHE" = true ]; then
    print_status "Running full frontend unit test suite..."
    if npm test -- --run; then
        print_success "Frontend unit tests passed!"
    else
        print_error "Frontend unit tests failed!"
        exit 1
    fi
else
    print_status "Running frontend unit tests for changed files only..."
    if npm test -- --run --changed; then
        print_success "Frontend unit tests passed!"
    else
        print_error "Frontend unit tests failed!"
        exit 1
    fi
fi

# Final success message
echo ""
print_success "✅ All Frontend Tests Passed!"
print_success "🔍 TypeScript: All type checks passed"
print_success "✅ Unit tests: All passed"
exit 0


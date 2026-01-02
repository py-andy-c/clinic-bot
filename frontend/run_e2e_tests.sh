#!/bin/bash

# E2E Test Driver Script
# Runs Playwright E2E tests for the frontend
#
# Usage:
#   ./run_e2e_tests.sh           - Run E2E tests for changed features only (fast)
#   ./run_e2e_tests.sh --no-cache - Run full E2E test suite

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
            echo "  (no flags)   Run E2E tests for changed features only (fast)"
            echo "  --no-cache   Run full E2E test suite (all browsers)"
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

print_status "E2E Test Driver"
print_status "Frontend directory: $FRONTEND_DIR"

# Navigate to frontend directory
cd "$FRONTEND_DIR"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    print_error "node_modules not found!"
    print_error "Please run: npm install"
    exit 1
fi

# Check if package.json exists
if [ ! -f "package.json" ]; then
    print_error "package.json not found!"
    exit 1
fi

# Check if Playwright is installed
if ! grep -q '"@playwright/test"' package.json; then
    print_error "Playwright not found in package.json!"
    print_error "Please run: npm install -D @playwright/test"
    exit 1
fi

# Check for test database configuration
E2E_DB_URL="${E2E_DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/test_db}"
print_status "E2E test database: ${E2E_DB_URL//:[^:@]+@/:****@}" # Hide password in output

# Export for Playwright config
export E2E_DATABASE_URL="$E2E_DB_URL"

# Run E2E tests
print_status "Running E2E tests..."

if [ "$NO_CACHE" = true ]; then
    print_status "Running full E2E test suite..."
    if npm run test:e2e; then
        print_success "E2E tests passed!"
    else
        print_error "E2E tests failed!"
        exit 1
    fi
else
    print_status "Running incremental E2E tests for changed features..."
    if npm run test:e2e:changed; then
        print_success "E2E tests passed!"
    else
        print_error "E2E tests failed!"
        exit 1
    fi
fi

# Final success message
echo ""
print_success "✅ All E2E Tests Passed!"
exit 0


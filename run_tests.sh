#!/bin/bash

# Clinic Bot Test Runner
# Simplified test runner that uses the existing backend venv

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

# Determine script location and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

print_status "Clinic Bot Test Runner"
print_status "Project root: $PROJECT_ROOT"

# Navigate to backend directory
cd "$PROJECT_ROOT/backend"

# Check if venv exists
if [ ! -d "venv" ]; then
    print_error "Virtual environment not found at backend/venv"
    print_error "Please run the backend setup first or create the venv manually"
    exit 1
fi

# Activate existing virtual environment
print_status "Activating virtual environment..."
source venv/bin/activate

# Check PostgreSQL is running
print_status "Checking PostgreSQL availability..."
if ! pg_isready -h localhost &> /dev/null; then
    print_error "PostgreSQL is not running!"
    print_error "Start it with: brew services start postgresql@14"
    exit 1
fi
print_success "PostgreSQL is running"

# Ensure test database exists
print_status "Checking test database..."
if ! psql -lqt | cut -d \| -f 1 | grep -qw clinic_bot_test; then
    print_status "Creating test database..."
    createdb clinic_bot_test 2>/dev/null || {
        print_error "Failed to create test database"
        print_error "Try: createdb clinic_bot_test"
        exit 1
    }
    print_success "Test database created"
fi

# Run pyright type checking
print_status "Running Pyright type checking..."
if pyright; then
    print_success "Type checking passed!"
else
    print_error "Type checking failed!"
    exit 1
fi

source load_test_env.sh
# Run all tests with coverage
print_status "Running all tests with coverage..."
if PYTHONPATH=src python -m pytest tests/unit/ tests/integration/ -v --tb=short --cov=src --cov-report=html:htmlcov --cov-report=term-missing --cov-fail-under=60; then
    print_success "All tests passed!"
    print_success "Coverage report generated!"
else
    print_error "Tests failed!"
    exit 1
fi

# Run frontend tests using test driver script
print_status "Running frontend tests..."
cd "$PROJECT_ROOT/frontend"
if [ -f "run_frontend_tests.sh" ]; then
    if bash run_frontend_tests.sh; then
        print_success "Frontend tests passed!"
    else
        print_error "Frontend tests failed!"
        exit 1
    fi
else
    print_error "Frontend test driver script not found!"
    print_error "Expected: frontend/run_frontend_tests.sh"
    exit 1
fi

# Final success message
echo ""
print_success "🎉 All Tests Passed Successfully!"
echo ""
print_success "📁 Coverage report: backend/htmlcov/index.html"
print_success "🔍 TypeScript: All type checks passed"
if [ -f "node_modules/.bin/vitest" ] || npm list vitest &> /dev/null 2>&1; then
    print_success "✅ Frontend unit tests: All passed"
fi
exit 0
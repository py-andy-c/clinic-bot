#!/bin/bash

# Backend Test Runner
# Runs pyright type checking and pytest tests
#
# Usage:
#   ./run_backend_tests.sh        - Run tests with testmon (fast, incremental, no coverage)
#   ./run_backend_tests.sh --no-cache - Run all tests with coverage check

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
            echo "  (no flags)   Run tests with testmon (fast, incremental, no coverage)"
            echo "  --no-cache   Run all tests with coverage check"
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

# Determine script location and backend directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR"

print_status "Backend Test Runner"
print_status "Backend directory: $BACKEND_DIR"

# Navigate to backend directory
cd "$BACKEND_DIR"

# Check if venv exists
if [ ! -d "venv" ]; then
    print_error "Virtual environment not found at venv"
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
if ! psql -h localhost -t -c "SELECT 1 FROM pg_database WHERE datname='clinic_bot_test'" postgres 2>/dev/null | grep -q 1; then
    print_status "Creating test database..."
    createdb clinic_bot_test 2>/dev/null || {
        print_error "Failed to create test database"
        print_error "Try: createdb clinic_bot_test"
        exit 1
    }
    print_success "Test database created"
fi

source load_test_env.sh

# Run Pyright type checking first (fail-fast)
print_status "Running Pyright type checking..."
if pyright; then
    print_success "Type checking passed!"
else
    print_error "Type checking failed!"
    exit 1
fi

# Run schema contract validation
print_status "Running schema contract validation..."
if python scripts/validate_schema_contract.py; then
    print_success "Schema contract validation passed!"
else
    print_error "Schema contract validation failed!"
    exit 1
fi

# Run pytest tests
if [ "$NO_CACHE" = true ]; then
    # Full mode: Run all tests with coverage
    print_status "Running all tests with coverage..."
    if PYTHONPATH=src python -m pytest tests/unit/ tests/integration/ -v --tb=short --cov=src --cov-report=html:htmlcov --cov-report=term-missing --cov-fail-under=70; then
        print_success "All tests passed!"
        print_success "Coverage report generated!"
    else
        print_error "Tests failed!"
        exit 1
    fi
else
    # Default mode: Run tests with testmon (incremental, no coverage)
    # Check if pytest-testmon is installed
    if ! python -c "import testmon" 2>/dev/null; then
        print_error "pytest-testmon is not installed!"
        print_error ""
        print_error "To install:"
        print_error "  cd backend"
        print_error "  source venv/bin/activate"
        print_error "  pip install pytest-testmon"
        print_error ""
        print_error "Or update all requirements:"
        print_error "  cd backend && source venv/bin/activate && pip install -r requirements.txt"
        exit 1
    fi
    
    # Check if testmon cache exists (first run)
    if [ ! -f ".testmondata" ]; then
        print_status "First run detected - building testmon cache (this may take a while)..."
    fi
    
    print_status "Running tests with testmon (incremental mode)..."
    if PYTHONPATH=src python -m pytest tests/unit/ tests/integration/ -v --tb=short --testmon; then
        print_success "Tests passed!"
    else
        print_error "Tests failed!"
        exit 1
    fi
fi

exit 0


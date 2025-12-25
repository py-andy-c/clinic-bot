#!/bin/bash

# Clinic Bot Test Runner
# Simplified test runner that uses the existing backend venv
#
# Usage:
#   ./run_tests.sh        - Run tests with testmon (fast, incremental, no coverage)
#   ./run_tests.sh --full - Run all tests with coverage check

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
FULL_MODE=false
REBUILD_CACHE=false
for arg in "$@"; do
    case $arg in
        --full|--all)
            FULL_MODE=true
            ;;
        --rebuild-cache)
            REBUILD_CACHE=true
            ;;
        --help|-h)
            echo "Usage: $0 [--full|--all] [--rebuild-cache]"
            echo ""
            echo "Options:"
            echo "  (no flags)      Run tests with testmon (fast, incremental, no coverage)"
            echo "  --full          Run all tests with coverage check"
            echo "  --all           Alias for --full"
            echo "  --rebuild-cache Delete testmon cache and rebuild (useful if cache seems stale)"
            echo "  --help          Show this help message"
            exit 0
            ;;
        *)
            print_error "Unknown option: $arg"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Determine script location and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

print_status "Clinic Bot Test Runner"
print_status "Project root: $PROJECT_ROOT"
if [ "$FULL_MODE" = true ]; then
    print_status "Mode: Full test run with coverage"
else
    print_status "Mode: Incremental test run with testmon"
fi

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

# Ensure test database exists (optimized: direct query instead of listing all databases)
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

# Run pyright type checking
print_status "Running Pyright type checking..."
if pyright; then
    print_success "Type checking passed!"
else
    print_error "Type checking failed!"
    exit 1
fi

source load_test_env.sh

# Run backend tests based on mode
if [ "$FULL_MODE" = true ]; then
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
    # Check if pytest-testmon is installed (fast check - just import, no pytest --help)
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
    
    # Handle cache rebuild if requested
    if [ "$REBUILD_CACHE" = true ]; then
        if [ -f ".testmondata" ]; then
            print_status "Rebuilding testmon cache (deleting existing cache)..."
            rm .testmondata
        fi
    fi
    
    # Check if testmon cache exists (first run)
    # Note: We're already in backend/ directory at this point
    if [ ! -f ".testmondata" ]; then
        print_status "First run detected - building testmon cache (this may take a while)..."
    fi
    
    print_status "Running tests with testmon (incremental mode)..."
    if PYTHONPATH=src python -m pytest tests/unit/ tests/integration/ -v --tb=short --testmon; then
        print_success "Tests passed!"
        print_status "Note: Running in incremental mode. Use --full for coverage check."
    else
        print_error "Tests failed!"
        exit 1
    fi
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
if [ "$FULL_MODE" = true ]; then
    print_success "📁 Coverage report: backend/htmlcov/index.html"
fi
print_success "🔍 TypeScript: All type checks passed"
print_success "✅ Frontend unit tests: All passed"
if [ "$FULL_MODE" = false ]; then
    echo ""
    print_status "💡 Tip: Use './run_tests.sh --full' to run all tests with coverage check"
fi
exit 0

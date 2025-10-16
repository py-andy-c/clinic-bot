#!/bin/bash

# Clinic Bot Test Runner (Unix/Linux/macOS)  
# Runs backend tests including type checking and coverage

set -e  # Exit on any error

echo "🏥 Clinic Bot - Test Suite Runner"
echo "==================================="

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

# Get the directory where this script is located (should be project root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if we're in project root (contains backend directory)
if [ -d "$SCRIPT_DIR/backend" ]; then
    PROJECT_ROOT="$SCRIPT_DIR"
elif [ -d "backend" ]; then
    # We're in project root
    PROJECT_ROOT="$(pwd)"
else
    print_error "Could not find backend directory. Please run this script from the project root."
    exit 1
fi

print_status "Running backend tests from: $PROJECT_ROOT/backend"

# Navigate to backend directory
cd "$PROJECT_ROOT/backend"

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    print_warning "Virtual environment not found. Creating one..."
    python3 -m venv venv
fi

# Activate virtual environment
print_status "Activating virtual environment..."
source venv/bin/activate

# Install/update dependencies
print_status "Installing backend dependencies..."
pip install -q -r requirements.txt

# Run pyright type checking
echo ""
print_status "Running pyright type checking..."
if pyright; then
    print_success "Type checking passed!"
else
    print_error "Type checking failed!"
    exit 1
fi

# Run tests with coverage
echo ""
print_status "Running backend test suite with coverage..."
if PYTHONWARNINGS="ignore::DeprecationWarning:pydantic._internal._config" python3 -m pytest tests/ -v --tb=short --cov=src --cov-report=term-missing --cov-report=html:htmlcov --cov-fail-under=70; then
    print_success "All backend tests passed!"
else
    print_error "Some backend tests failed!"
    exit 1
fi

# Show coverage summary
echo ""
print_status "Coverage report generated at htmlcov/index.html"

echo ""
print_success "🎉 All backend checks passed! Code is ready for deployment."
echo ""
echo "Next steps:"
echo "  • View detailed coverage: open htmlcov/index.html"
echo "  • Run specific tests: python3 -m pytest tests/unit/test_models.py -v"
echo "  • Check types only: pyright"

# Deactivate virtual environment
deactivate

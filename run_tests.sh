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

# Load test environment variables
if [ -f ".env.test" ]; then
    print_status "Loading test environment variables from backend/.env.test..."
    source .env.test
else
    print_error ".env.test file not found in backend directory!"
    exit 1
fi

# Check if venv exists
if [ ! -d "venv" ]; then
    print_error "Virtual environment not found at backend/venv"
    print_error "Please run the backend setup first or create the venv manually"
    exit 1
fi

# Activate existing virtual environment
print_status "Activating virtual environment..."
source venv/bin/activate

# Run pyright type checking
print_status "Running Pyright type checking..."
if pyright; then
    print_success "Type checking passed!"
else
    print_error "Type checking failed!"
    exit 1
fi

# Run all tests with coverage
print_status "Running all tests with coverage..."
if PYTHONPATH=src python -m pytest tests/unit/ tests/integration/ -v --tb=short --cov=src --cov-report=html:htmlcov --cov-report=term-missing; then
    print_success "All tests passed!"
    print_success "Coverage report generated!"
else
    print_error "Tests failed!"
    exit 1
fi

# Run TypeScript type checking for frontend
print_status "Running TypeScript type checking for frontend..."
cd "$PROJECT_ROOT/frontend"
if npx tsc --noEmit; then
    print_success "Frontend TypeScript type checking passed!"
else
    print_error "Frontend TypeScript type checking failed!"
    exit 1
fi

# Final success message
echo ""
print_success "🎉 All Tests Passed Successfully!"
echo ""
print_success "📁 Coverage report: backend/htmlcov/index.html"
print_success "🔍 TypeScript: All type checks passed"
exit 0
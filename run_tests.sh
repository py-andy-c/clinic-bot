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

# Run pyright type checking
print_status "Running Pyright type checking..."
if pyright; then
    print_success "Type checking passed!"
else
    print_error "Type checking failed!"
    exit 1
fi

# Set up test environment variables
export JWT_SECRET_KEY="test-jwt-secret-key-for-testing-purposes-only"
export ENCRYPTION_KEY="YyD8O45QlfRZUXT9kzjW3xEf6iNqz5EtF_OB8WEOBqw="
export SYSTEM_ADMIN_EMAILS="test@example.com"
export DATABASE_URL="sqlite:///:memory:"

# Run all tests
print_status "Running all tests..."
if PYTHONPATH=src python -m pytest tests/unit/ tests/integration/ -v --tb=short; then
    print_success "All tests passed!"
else
    print_error "Tests failed!"
    exit 1
fi

# Generate coverage report
print_status "Generating coverage report..."
PYTHONPATH=src python -m pytest tests/unit/ tests/integration/ --cov=src --cov-report=html:htmlcov --cov-report=term-missing
print_success "Coverage report generated!"

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

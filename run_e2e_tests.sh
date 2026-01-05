#!/bin/bash

# Clinic Bot E2E Test Runner
# Runs Playwright E2E tests with automatic database setup and server management
#
# Usage:
#   ./run_e2e_tests.sh               - Run E2E tests incrementally (--only-changed)
#   ./run_e2e_tests.sh --full        - Run full E2E test suite
#   ./run_e2e_tests.sh --headed      - Run with UI mode (headed browser)

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
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

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Parse command line arguments
FULL=false
HEADED=false
for arg in "$@"; do
    case $arg in
        --full)
            FULL=true
            ;;
        --headed)
            HEADED=true
            ;;
        --help|-h)
            echo "Usage: $0 [--full] [--headed]"
            echo ""
            echo "Options:"
            echo "  (no flags)     Run tests incrementally (--only-changed)"
            echo "  --full         Run full E2E test suite"
            echo "  --headed       Run with UI mode (headed browser)"
            echo "  --help         Show this help message"
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

print_status "Clinic Bot E2E Test Runner"
print_status "Project root: $PROJECT_ROOT"

# Check if PostgreSQL is running
print_status "Checking PostgreSQL connection..."
if ! pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
    print_error "PostgreSQL is not running on localhost:5432"
    print_error "Please start PostgreSQL service and try again"
    exit 1
fi
print_success "PostgreSQL is running"

# Create E2E database if it doesn't exist
print_status "Checking E2E database..."
if ! psql -h localhost -U user -l | grep -q "clinic_bot_e2e"; then
    print_status "Creating clinic_bot_e2e database..."
    createdb -h localhost -U user clinic_bot_e2e
    print_success "Database clinic_bot_e2e created"
else
    print_success "Database clinic_bot_e2e already exists"
fi

# Check for port conflicts and clean them up
print_status "Checking for port conflicts..."

# Function to kill process on port
kill_port() {
    local port=$1
    local name=$2
    if lsof -i :$port >/dev/null 2>&1; then
        print_warning "Port $port is in use ($name), terminating..."
        lsof -ti :$port | xargs kill -9 2>/dev/null || true
        sleep 2
    fi
}

kill_port 8001 "backend E2E server"
kill_port 5174 "frontend E2E server"

print_success "Port conflicts resolved"

# Run database migrations
print_status "Running database migrations..."
cd "$PROJECT_ROOT/backend"
source venv/bin/activate
DATABASE_URL=postgresql://user:password@localhost/clinic_bot_e2e alembic upgrade head
print_success "Database migrations completed"

# Build Playwright command
cd "$PROJECT_ROOT/frontend"
PW_CMD="npx playwright test"

if [ "$FULL" = false ]; then
    PW_CMD="$PW_CMD --only-changed"
    print_status "Running incremental E2E tests (--only-changed)"
else
    print_status "Running full E2E test suite"
fi

if [ "$HEADED" = true ]; then
    PW_CMD="$PW_CMD --headed"
    print_status "Running in headed mode"
fi

# Run the tests
print_status "Starting Playwright tests..."
eval $PW_CMD

# Check test result
if [ $? -eq 0 ]; then
    print_success "🎉 All E2E tests passed!"
    echo ""
    echo "To open last HTML report run:"
    echo "  cd frontend && npx playwright show-report"
else
    print_error "❌ E2E tests failed"
    exit 1
fi

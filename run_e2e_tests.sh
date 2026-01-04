#!/bin/bash

# E2E Test Runner for Clinic Bot
# Runs Playwright E2E tests with proper environment setup
#
# Usage:
#   ./run_e2e_tests.sh           - Run E2E tests
#   ./run_e2e_tests.sh --full    - Run full E2E test suite (same as default)
#   ./run_e2e_tests.sh --ui      - Run with UI mode (headed browser)
#   ./run_e2e_tests.sh --help    - Show help message

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
UI_MODE=false
for arg in "$@"; do
    case $arg in
        --full)
            FULL=true
            ;;
        --ui)
            UI_MODE=true
            ;;
        --help|-h)
            echo "Usage: $0 [--full] [--ui]"
            echo ""
            echo "Options:"
            echo "  (no flags)   Run E2E tests"
            echo "  --full       Run full E2E test suite (same as default)"
            echo "  --ui         Run with UI mode (headed browser)"
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

# Determine script location and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

print_status "Clinic Bot E2E Test Runner"
print_status "Project root: $PROJECT_ROOT"

# Check if .env.e2e exists
ENV_E2E_FILE="$PROJECT_ROOT/.env.e2e"
if [ ! -f "$ENV_E2E_FILE" ]; then
    print_warning ".env.e2e file not found!"
    print_status "Creating .env.e2e from .env.e2e.example..."
    if [ -f "$PROJECT_ROOT/.env.e2e.example" ]; then
        cp "$PROJECT_ROOT/.env.e2e.example" "$ENV_E2E_FILE"
        print_success "Created .env.e2e from example file"
        print_warning "Please review and update .env.e2e with your actual values"
    else
        print_error ".env.e2e.example not found. Please create .env.e2e manually."
        exit 1
    fi
fi

# Check if test database exists (optional check - migrations will fail if DB doesn't exist)
if command -v psql &> /dev/null; then
    DB_NAME=$(grep "^DATABASE_URL=" "$ENV_E2E_FILE" 2>/dev/null | sed 's/.*\///' | sed 's/.*=//' | cut -d'@' -f2 | cut -d'/' -f2 || echo "clinic_bot_e2e")
    if [ -n "$DB_NAME" ] && ! psql -h localhost -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "$DB_NAME" 2>/dev/null; then
        print_warning "Test database '$DB_NAME' may not exist"
        print_status "Create it with: createdb $DB_NAME"
    fi
fi

# Check if Playwright is installed
if ! command -v npx &> /dev/null; then
    print_error "npx not found. Please install Node.js and npm."
    exit 1
fi

# Check if Playwright is installed (in root node_modules)
if [ ! -d "$PROJECT_ROOT/node_modules/@playwright/test" ]; then
    print_warning "Playwright not found in node_modules"
    print_status "Installing Playwright..."
    cd "$PROJECT_ROOT" && npm install -D @playwright/test dotenv
fi

# Check if browsers are installed
if [ ! -d "$HOME/.cache/ms-playwright" ] && [ ! -d "$PROJECT_ROOT/node_modules/.cache/ms-playwright" ]; then
    print_warning "Playwright browsers not installed"
    print_status "Installing Playwright browsers (this may take a few minutes)..."
    cd "$PROJECT_ROOT" && npx playwright install --with-deps chromium
    print_success "Playwright browsers installed"
fi

# Build Playwright command
PLAYWRIGHT_CMD="npx playwright test"

if [ "$FULL" = false ]; then
    PLAYWRIGHT_CMD="$PLAYWRIGHT_CMD --only-changed"
    print_status "Running E2E tests incrementally (changed files only)"
else
    print_status "Running full E2E test suite"
fi

if [ "$UI_MODE" = true ]; then
    PLAYWRIGHT_CMD="$PLAYWRIGHT_CMD --ui"
    print_status "Running in UI mode (headed browser)"
fi

# Run Playwright tests
print_status "Starting E2E tests..."
print_status "Command: $PLAYWRIGHT_CMD"
echo ""

cd "$PROJECT_ROOT"
if eval "$PLAYWRIGHT_CMD"; then
    echo ""
    print_success "🎉 All E2E Tests Passed Successfully!"
    exit 0
else
    echo ""
    print_error "❌ E2E Tests Failed"
    print_status "View test report: npx playwright show-report"
    exit 1
fi


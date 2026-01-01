#!/bin/bash

# Clinic Bot Test Runner
# Orchestrates backend, frontend, and E2E test runners
# Automatically detects changed files and runs only relevant tests
#
# Usage:
#   ./run_tests.sh           - Run tests for changed files only (smart mode)
#   ./run_tests.sh --no-cache - Run all tests with coverage check
#   ./run_tests.sh --all     - Run all tests regardless of changes

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
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

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Parse command line arguments
NO_CACHE=false
RUN_ALL=false
for arg in "$@"; do
    case $arg in
        --no-cache)
            NO_CACHE=true
            RUN_ALL=true  # --no-cache implies --all
            ;;
        --all)
            RUN_ALL=true
            ;;
        --help|-h)
            echo "Usage: $0 [--no-cache] [--all]"
            echo ""
            echo "Options:"
            echo "  (no flags)   Run tests for changed files only (smart mode)"
            echo "  --no-cache   Run all tests with coverage check"
            echo "  --all        Run all tests regardless of changes"
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

print_status "Clinic Bot Test Runner"
print_status "Project root: $PROJECT_ROOT"

# Determine which tests to run based on changed files (unless --all or --no-cache)
RUN_BACKEND=false
RUN_FRONTEND=false
RUN_E2E=false

if [ "$RUN_ALL" = true ]; then
    # Run all tests
    RUN_BACKEND=true
    RUN_FRONTEND=true
    RUN_E2E=true
    print_status "Running all tests (--all or --no-cache specified)"
else
    # Check if we're in a git repository
    if [ -d "$PROJECT_ROOT/.git" ]; then
        # Check for staged changes first (for pre-commit), then working directory changes
        FRONTEND_FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep -E "^frontend/" || git diff HEAD --name-only --diff-filter=ACM 2>/dev/null | grep -E "^frontend/" || true)
        BACKEND_FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep -E "^backend/" || git diff HEAD --name-only --diff-filter=ACM 2>/dev/null | grep -E "^backend/" || true)
        
        if [ -n "$BACKEND_FILES" ]; then
            RUN_BACKEND=true
            print_status "Backend files changed, will run backend tests"
        fi
        
        if [ -n "$FRONTEND_FILES" ]; then
            RUN_FRONTEND=true
            RUN_E2E=true  # E2E tests frontend, so run when frontend changes
            print_status "Frontend files changed, will run frontend and E2E tests"
        fi
        
        if [ "$RUN_BACKEND" = false ] && [ "$RUN_FRONTEND" = false ]; then
            print_status "No backend or frontend files changed, skipping tests"
            # Still show summary with all skipped
            echo ""
            print_status "=== Test Summary ==="
            echo -e "${BLUE}[INFO]${NC} Backend:  ⏭️  SKIPPED (no backend files changed)"
            echo -e "${BLUE}[INFO]${NC} Frontend: ⏭️  SKIPPED (no frontend files changed)"
            echo -e "${BLUE}[INFO]${NC} E2E:      ⏭️  SKIPPED (no frontend files changed)"
            echo ""
            exit 0
        fi
    else
        # Not in a git repo, run all tests
        print_warning "Not in a git repository, running all tests"
        RUN_BACKEND=true
        RUN_FRONTEND=true
        RUN_E2E=true
    fi
fi

# Build test commands only for tests that will run
BACKEND_SCRIPT="$PROJECT_ROOT/backend/run_backend_tests.sh"
FRONTEND_SCRIPT="$PROJECT_ROOT/frontend/run_frontend_tests.sh"
E2E_SCRIPT="$PROJECT_ROOT/frontend/run_e2e_tests.sh"

# Verify test scripts exist (only for tests that will run)
if [ "$RUN_BACKEND" = true ]; then
    if [ ! -f "$BACKEND_SCRIPT" ]; then
        print_error "Backend test script not found: $BACKEND_SCRIPT"
        exit 1
    fi
    BACKEND_CMD="$BACKEND_SCRIPT"
    if [ "$NO_CACHE" = true ]; then
        BACKEND_CMD="$BACKEND_CMD --no-cache"
    fi
fi

if [ "$RUN_FRONTEND" = true ]; then
    if [ ! -f "$FRONTEND_SCRIPT" ]; then
        print_error "Frontend test script not found: $FRONTEND_SCRIPT"
        exit 1
    fi
    FRONTEND_CMD="$FRONTEND_SCRIPT"
    if [ "$NO_CACHE" = true ]; then
        FRONTEND_CMD="$FRONTEND_CMD --no-cache"
    fi
fi

if [ "$RUN_E2E" = true ]; then
    if [ ! -f "$E2E_SCRIPT" ]; then
        print_error "E2E test script not found: $E2E_SCRIPT"
        exit 1
    fi
    E2E_CMD="$E2E_SCRIPT"
    if [ "$NO_CACHE" = true ]; then
        E2E_CMD="$E2E_CMD --no-cache"
    fi
fi

# Create temporary files for capturing output and exit codes
BACKEND_OUTPUT=$(mktemp)
FRONTEND_OUTPUT=$(mktemp)
E2E_OUTPUT=$(mktemp)
BACKEND_EXIT_FILE=$(mktemp)
FRONTEND_EXIT_FILE=$(mktemp)
E2E_EXIT_FILE=$(mktemp)

# Function to cleanup temp files
cleanup_temp_files() {
    rm -f "$BACKEND_OUTPUT" "$FRONTEND_OUTPUT" "$E2E_OUTPUT" "$BACKEND_EXIT_FILE" "$FRONTEND_EXIT_FILE" "$E2E_EXIT_FILE"
}
trap cleanup_temp_files EXIT

# Start tests in background
if [ "$RUN_BACKEND" = true ] && [ "$RUN_FRONTEND" = true ] && [ "$RUN_E2E" = true ]; then
    print_status "Running backend, frontend, and E2E tests in parallel..."
elif [ "$RUN_BACKEND" = true ] && [ "$RUN_FRONTEND" = true ]; then
    print_status "Running backend and frontend tests in parallel..."
elif [ "$RUN_BACKEND" = true ]; then
    print_status "Running backend tests..."
elif [ "$RUN_FRONTEND" = true ] && [ "$RUN_E2E" = true ]; then
    print_status "Running frontend and E2E tests in parallel..."
elif [ "$RUN_FRONTEND" = true ]; then
    print_status "Running frontend tests..."
elif [ "$RUN_E2E" = true ]; then
    print_status "Running E2E tests..."
fi

# Start backend tests in background if needed
if [ "$RUN_BACKEND" = true ]; then
    (
        bash $BACKEND_CMD > "$BACKEND_OUTPUT" 2>&1
        echo $? > "$BACKEND_EXIT_FILE"
    ) &
    BACKEND_PID=$!
fi

# Start frontend tests in background if needed
if [ "$RUN_FRONTEND" = true ]; then
    (
        bash $FRONTEND_CMD > "$FRONTEND_OUTPUT" 2>&1
        echo $? > "$FRONTEND_EXIT_FILE"
    ) &
    FRONTEND_PID=$!
fi

# Start E2E tests in background if needed
if [ "$RUN_E2E" = true ]; then
    (
        bash $E2E_CMD > "$E2E_OUTPUT" 2>&1
        echo $? > "$E2E_EXIT_FILE"
    ) &
    E2E_PID=$!
fi

# Wait for processes to complete
# Temporarily disable set -e to allow wait to return non-zero exit codes
# (which is expected when background processes fail)
set +e
if [ "$RUN_BACKEND" = true ]; then
    wait $BACKEND_PID
    BACKEND_WAIT_EXIT=$?
fi
if [ "$RUN_FRONTEND" = true ]; then
    wait $FRONTEND_PID
    FRONTEND_WAIT_EXIT=$?
fi
if [ "$RUN_E2E" = true ]; then
    wait $E2E_PID
    E2E_WAIT_EXIT=$?
fi
set -e

# Give processes a moment to write exit codes to files
# Note: This is a small delay to ensure file I/O completes. In practice,
# the wait above should be sufficient, but this provides a safety margin.
sleep 0.1

# Read exit codes from files
BACKEND_EXIT=0
FRONTEND_EXIT=0
E2E_EXIT=0

if [ "$RUN_BACKEND" = true ]; then
    BACKEND_EXIT=1
    if [ -f "$BACKEND_EXIT_FILE" ] && [ -s "$BACKEND_EXIT_FILE" ]; then
        BACKEND_EXIT=$(cat "$BACKEND_EXIT_FILE" 2>/dev/null)
        # Ensure it's a valid integer, default to 1 if not
        case "$BACKEND_EXIT" in
            ''|*[!0-9]*) BACKEND_EXIT=1 ;;
        esac
    fi
fi

if [ "$RUN_FRONTEND" = true ]; then
    FRONTEND_EXIT=1
    if [ -f "$FRONTEND_EXIT_FILE" ] && [ -s "$FRONTEND_EXIT_FILE" ]; then
        FRONTEND_EXIT=$(cat "$FRONTEND_EXIT_FILE" 2>/dev/null)
        # Ensure it's a valid integer, default to 1 if not
        case "$FRONTEND_EXIT" in
            ''|*[!0-9]*) FRONTEND_EXIT=1 ;;
        esac
    fi
fi

if [ "$RUN_E2E" = true ]; then
    E2E_EXIT=1
    if [ -f "$E2E_EXIT_FILE" ] && [ -s "$E2E_EXIT_FILE" ]; then
        E2E_EXIT=$(cat "$E2E_EXIT_FILE" 2>/dev/null)
        # Ensure it's a valid integer, default to 1 if not
        case "$E2E_EXIT" in
            ''|*[!0-9]*) E2E_EXIT=1 ;;
        esac
    fi
fi

# Display results only if they failed
if [ "$RUN_BACKEND" = true ] && [ "$BACKEND_EXIT" -ne 0 ]; then
    echo ""
    print_error "Backend tests failed!"
    echo ""
    print_status "=== Backend Test Output ==="
    if [ -f "$BACKEND_OUTPUT" ]; then
        cat "$BACKEND_OUTPUT"
    else
        print_error "Backend output file not found!"
    fi
    echo ""
fi

if [ "$RUN_FRONTEND" = true ] && [ "$FRONTEND_EXIT" -ne 0 ]; then
    echo ""
    print_error "Frontend tests failed!"
    echo ""
    print_status "=== Frontend Test Output ==="
    if [ -f "$FRONTEND_OUTPUT" ]; then
        cat "$FRONTEND_OUTPUT"
    else
        print_error "Frontend output file not found!"
    fi
    echo ""
fi

if [ "$RUN_E2E" = true ] && [ "$E2E_EXIT" -ne 0 ]; then
    echo ""
    print_error "E2E tests failed!"
    echo ""
    print_status "=== E2E Test Output ==="
    if [ -f "$E2E_OUTPUT" ]; then
        cat "$E2E_OUTPUT"
    else
        print_error "E2E output file not found!"
    fi
    echo ""
fi

# Display summary (always show all three, mark skipped ones)
echo ""
print_status "=== Test Summary ==="

# Backend status
if [ "$RUN_BACKEND" = false ]; then
    echo -e "${BLUE}[INFO]${NC} Backend:  ⏭️  SKIPPED (no backend files changed)"
elif [ "$BACKEND_EXIT" -eq 0 ]; then
    print_success "Backend:  ✅ PASSED"
else
    print_error "Backend:  ❌ FAILED"
fi

# Frontend status
if [ "$RUN_FRONTEND" = false ]; then
    echo -e "${BLUE}[INFO]${NC} Frontend: ⏭️  SKIPPED (no frontend files changed)"
elif [ "$FRONTEND_EXIT" -eq 0 ]; then
    print_success "Frontend: ✅ PASSED"
else
    print_error "Frontend: ❌ FAILED"
fi

# E2E status
if [ "$RUN_E2E" = false ]; then
    echo -e "${BLUE}[INFO]${NC} E2E:      ⏭️  SKIPPED (no frontend files changed)"
elif [ "$E2E_EXIT" -eq 0 ]; then
    print_success "E2E:      ✅ PASSED"
else
    print_error "E2E:      ❌ FAILED"
fi
echo ""

# Exit with error if any failed
HAS_FAILURES=false
if [ "$RUN_BACKEND" = true ] && [ "$BACKEND_EXIT" -ne 0 ]; then
    HAS_FAILURES=true
fi
if [ "$RUN_FRONTEND" = true ] && [ "$FRONTEND_EXIT" -ne 0 ]; then
    HAS_FAILURES=true
fi
if [ "$RUN_E2E" = true ] && [ "$E2E_EXIT" -ne 0 ]; then
    HAS_FAILURES=true
fi

if [ "$HAS_FAILURES" = true ]; then
    exit 1
fi

# Final success message
print_success "🎉 All Tests Passed Successfully!"
if [ "$NO_CACHE" = true ]; then
    print_success "📁 Coverage report: backend/htmlcov/index.html"
fi
exit 0

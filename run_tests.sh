#!/bin/bash

# Clinic Bot Test Runner
# Orchestrates backend and frontend test runners
#
# Usage:
#   ./run_tests.sh           - Run tests based on changed files (smart incremental)
#   ./run_tests.sh --full    - Run all tests with coverage/full suites

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
for arg in "$@"; do
    case $arg in
        --full)
            FULL=true
            ;;
        --help|-h)
            echo "Usage: $0 [--full]"
            echo ""
            echo "Options:"
            echo "  (no flags)   Run tests based on changed files (smart incremental)"
            echo "  --full       Run all tests with coverage/full suites"
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

# Build backend test command
BACKEND_SCRIPT="$PROJECT_ROOT/backend/run_backend_tests.sh"
BACKEND_CMD="$BACKEND_SCRIPT"
if [ "$FULL" = true ]; then
    BACKEND_CMD="$BACKEND_CMD --full"
fi

# Frontend test command
FRONTEND_SCRIPT="$PROJECT_ROOT/frontend/run_frontend_tests.sh"
FRONTEND_CMD="$FRONTEND_SCRIPT"
if [ "$FULL" = true ]; then
    FRONTEND_CMD="$FRONTEND_CMD --full"
fi

# E2E test command
E2E_SCRIPT="$PROJECT_ROOT/run_e2e_tests.sh"
E2E_CMD="$E2E_SCRIPT"
if [ "$FULL" = true ]; then
    E2E_CMD="$E2E_CMD --full"
fi

# Verify test scripts exist
if [ ! -f "$BACKEND_SCRIPT" ]; then
    print_error "Backend test script not found: $BACKEND_SCRIPT"
    exit 1
fi
if [ ! -f "$FRONTEND_SCRIPT" ]; then
    print_error "Frontend test script not found: $FRONTEND_SCRIPT"
    exit 1
fi
if [ ! -f "$E2E_SCRIPT" ]; then
    print_error "E2E test script not found: $E2E_SCRIPT"
    exit 1
fi

# Detect changed files to determine which tests to run
if [ "$FULL" = true ]; then
    print_status "Running all tests (--full mode)"
    RUN_BACKEND=true
    RUN_FRONTEND=true
    RUN_E2E=true
else
    print_status "Detecting changed files to determine which tests to run..."

    # Get changed files since last commit
    CHANGED_FILES=$(git diff --name-only HEAD~1 2>/dev/null || echo "")

    # Check if backend files changed
    BACKEND_CHANGED=false
    if echo "$CHANGED_FILES" | grep -q "^backend/"; then
        BACKEND_CHANGED=true
        print_status "Backend files changed - will run backend tests"
    fi

    # Check if frontend files changed
    FRONTEND_CHANGED=false
    if echo "$CHANGED_FILES" | grep -q "^frontend/"; then
        FRONTEND_CHANGED=true
        print_status "Frontend files changed - will run frontend tests"
    fi

    # Always run E2E tests (they test the full system)
    RUN_BACKEND=$BACKEND_CHANGED
    RUN_FRONTEND=$FRONTEND_CHANGED
    RUN_E2E=true

    print_status "E2E tests will always run (full system testing)"
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

# Start tests in background based on what needs to run
print_status "Running tests in parallel..."

BACKEND_PID=""
FRONTEND_PID=""
E2E_PID=""

if [ "$RUN_BACKEND" = true ]; then
    (
        set +e  # Don't exit on error in subshell
        pushd "$PROJECT_ROOT/backend" > /dev/null
        if [ "$FULL" = true ]; then
            bash ./run_backend_tests.sh --full > "$BACKEND_OUTPUT" 2>&1
            TEST_EXIT_CODE=$?
        else
            bash ./run_backend_tests.sh > "$BACKEND_OUTPUT" 2>&1
            TEST_EXIT_CODE=$?
        fi
        echo $TEST_EXIT_CODE > "$BACKEND_EXIT_FILE"
        popd > /dev/null
    ) &
    BACKEND_PID=$!
    print_status "Started backend tests (PID: $BACKEND_PID)"
fi

if [ "$RUN_FRONTEND" = true ]; then
    (
        set +e  # Don't exit on error in subshell
        pushd "$PROJECT_ROOT/frontend" > /dev/null
        if [ "$FULL" = true ]; then
            bash ./run_frontend_tests.sh --full > "$FRONTEND_OUTPUT" 2>&1
            TEST_EXIT_CODE=$?
        else
            bash ./run_frontend_tests.sh > "$FRONTEND_OUTPUT" 2>&1
            TEST_EXIT_CODE=$?
        fi
        echo $TEST_EXIT_CODE > "$FRONTEND_EXIT_FILE"
        popd > /dev/null
    ) &
    FRONTEND_PID=$!
    print_status "Started frontend tests (PID: $FRONTEND_PID)"
fi

if [ "$RUN_E2E" = true ]; then
    (
        bash $E2E_CMD > "$E2E_OUTPUT" 2>&1
        echo $? > "$E2E_EXIT_FILE"
    ) &
    E2E_PID=$!
    print_status "Started E2E tests (PID: $E2E_PID)"
fi

# Wait for processes to complete
set +e

if [ -n "$BACKEND_PID" ]; then
    wait $BACKEND_PID
    BACKEND_WAIT_EXIT=$?
fi

if [ -n "$FRONTEND_PID" ]; then
    wait $FRONTEND_PID
    FRONTEND_WAIT_EXIT=$?
fi

if [ -n "$E2E_PID" ]; then
    wait $E2E_PID
    E2E_WAIT_EXIT=$?
fi

set -e

# Give processes a moment to write exit codes to files
sleep 0.1

# Read exit codes from files
BACKEND_EXIT=0
FRONTEND_EXIT=0
E2E_EXIT=1  # Default to 1 for E2E since it's always run

if [ "$RUN_BACKEND" = true ] && [ -f "$BACKEND_EXIT_FILE" ] && [ -s "$BACKEND_EXIT_FILE" ]; then
    BACKEND_EXIT=$(cat "$BACKEND_EXIT_FILE" 2>/dev/null)
    case "$BACKEND_EXIT" in
        ''|*[!0-9]*) BACKEND_EXIT=1 ;;
    esac
fi

if [ "$RUN_FRONTEND" = true ] && [ -f "$FRONTEND_EXIT_FILE" ] && [ -s "$FRONTEND_EXIT_FILE" ]; then
    FRONTEND_EXIT=$(cat "$FRONTEND_EXIT_FILE" 2>/dev/null)
    case "$FRONTEND_EXIT" in
        ''|*[!0-9]*) FRONTEND_EXIT=1 ;;
    esac
fi

if [ "$RUN_E2E" = true ] && [ -f "$E2E_EXIT_FILE" ] && [ -s "$E2E_EXIT_FILE" ]; then
    E2E_EXIT=$(cat "$E2E_EXIT_FILE" 2>/dev/null)
    case "$E2E_EXIT" in
        ''|*[!0-9]*) E2E_EXIT=1 ;;
    esac
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

# Display summary with passed/skipped/failed status
echo ""
print_status "=== Test Summary ==="

if [ "$RUN_BACKEND" = true ]; then
    if [ "$BACKEND_EXIT" -eq 0 ]; then
        print_success "Backend:  ✅ PASSED"
    else
        print_error "Backend:  ❌ FAILED"
    fi
else
    print_warning "Backend:  ⏭️  SKIPPED (no backend changes)"
fi

if [ "$RUN_FRONTEND" = true ]; then
    if [ "$FRONTEND_EXIT" -eq 0 ]; then
        print_success "Frontend: ✅ PASSED"
    else
        print_error "Frontend: ❌ FAILED"
    fi
else
    print_warning "Frontend: ⏭️  SKIPPED (no frontend changes)"
fi

if [ "$RUN_E2E" = true ]; then
    if [ "$E2E_EXIT" -eq 0 ]; then
        print_success "E2E:      ✅ PASSED"
    else
        print_error "E2E:      ❌ FAILED"
    fi
else
    print_warning "E2E:      ⏭️  SKIPPED"
fi

echo ""

# Exit with error if any test that ran failed
FAILED_TESTS=false
if [ "$RUN_BACKEND" = true ] && [ "$BACKEND_EXIT" -ne 0 ]; then
    FAILED_TESTS=true
fi
if [ "$RUN_FRONTEND" = true ] && [ "$FRONTEND_EXIT" -ne 0 ]; then
    FAILED_TESTS=true
fi
if [ "$RUN_E2E" = true ] && [ "$E2E_EXIT" -ne 0 ]; then
    FAILED_TESTS=true
fi

if [ "$FAILED_TESTS" = true ]; then
    exit 1
fi

# Final success message
print_success "🎉 All Tests Passed Successfully!"
if [ "$FULL" = true ]; then
    print_success "📁 Coverage report: backend/htmlcov/index.html"
fi
exit 0

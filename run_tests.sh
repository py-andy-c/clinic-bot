#!/bin/bash

# Clinic Bot Test Runner
# Orchestrates backend and frontend test runners
#
# Usage:
#   ./run_tests.sh           - Run tests with testmon (fast, incremental, no coverage)
#   ./run_tests.sh --no-cache - Run all backend tests with coverage check

set -e  # Exit on any error

# Permission guard to prevent sandbox execution
source "$(dirname "$0")/scripts/test_permission_guard.sh"
enforce_permissions

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
            echo "  --no-cache   Run all backend tests with coverage check"
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
if [ "$NO_CACHE" = true ]; then
    BACKEND_CMD="$BACKEND_CMD --no-cache"
fi

# Frontend test command
FRONTEND_SCRIPT="$PROJECT_ROOT/frontend/run_frontend_tests.sh"
FRONTEND_CMD="$FRONTEND_SCRIPT"
if [ "$NO_CACHE" = true ]; then
    FRONTEND_CMD="$FRONTEND_CMD --no-cache"
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

# Create temporary files for capturing output and exit codes
BACKEND_OUTPUT=$(mktemp)
FRONTEND_OUTPUT=$(mktemp)
BACKEND_EXIT_FILE=$(mktemp)
FRONTEND_EXIT_FILE=$(mktemp)

# Function to cleanup temp files
cleanup_temp_files() {
    rm -f "$BACKEND_OUTPUT" "$FRONTEND_OUTPUT" "$BACKEND_EXIT_FILE" "$FRONTEND_EXIT_FILE"
}
trap cleanup_temp_files EXIT

# Start backend tests in background
print_status "Running backend and frontend tests in parallel..."
(
    bash $BACKEND_CMD > "$BACKEND_OUTPUT" 2>&1
    echo $? > "$BACKEND_EXIT_FILE"
) &
BACKEND_PID=$!

# Start frontend tests in background
(
    bash $FRONTEND_CMD > "$FRONTEND_OUTPUT" 2>&1
    echo $? > "$FRONTEND_EXIT_FILE"
) &
FRONTEND_PID=$!

# Wait for both processes to complete
# Temporarily disable set -e to allow wait to return non-zero exit codes
# (which is expected when background processes fail)
set +e
wait $BACKEND_PID
BACKEND_WAIT_EXIT=$?
wait $FRONTEND_PID
FRONTEND_WAIT_EXIT=$?
set -e

# Give processes a moment to write exit codes to files
# Note: This is a small delay to ensure file I/O completes. In practice,
# the wait above should be sufficient, but this provides a safety margin.
sleep 0.1

# Read exit codes from files
BACKEND_EXIT=1
FRONTEND_EXIT=1
if [ -f "$BACKEND_EXIT_FILE" ] && [ -s "$BACKEND_EXIT_FILE" ]; then
    BACKEND_EXIT=$(cat "$BACKEND_EXIT_FILE" 2>/dev/null)
    # Ensure it's a valid integer, default to 1 if not
    case "$BACKEND_EXIT" in
        ''|*[!0-9]*) BACKEND_EXIT=1 ;;
    esac
fi
if [ -f "$FRONTEND_EXIT_FILE" ] && [ -s "$FRONTEND_EXIT_FILE" ]; then
    FRONTEND_EXIT=$(cat "$FRONTEND_EXIT_FILE" 2>/dev/null)
    # Ensure it's a valid integer, default to 1 if not
    case "$FRONTEND_EXIT" in
        ''|*[!0-9]*) FRONTEND_EXIT=1 ;;
    esac
fi

# Display results only if they failed
if [ "$BACKEND_EXIT" -ne 0 ]; then
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

if [ "$FRONTEND_EXIT" -ne 0 ]; then
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

# Display summary
echo ""
print_status "=== Test Summary ==="
if [ "$BACKEND_EXIT" -eq 0 ]; then
    print_success "Backend:  ✅ PASSED"
else
    print_error "Backend:  ❌ FAILED"
fi

if [ "$FRONTEND_EXIT" -eq 0 ]; then
    print_success "Frontend: ✅ PASSED"
else
    print_error "Frontend: ❌ FAILED"
fi
echo ""

# Exit with error if either failed
if [ "$BACKEND_EXIT" -ne 0 ] || [ "$FRONTEND_EXIT" -ne 0 ]; then
    exit 1
fi

# Final success message
print_success "🎉 All Tests Passed Successfully!"
if [ "$NO_CACHE" = true ]; then
    print_success "📁 Coverage report: backend/htmlcov/index.html"
fi
exit 0

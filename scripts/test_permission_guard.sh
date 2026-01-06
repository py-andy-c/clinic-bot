#!/bin/bash
# Shared permission guard for test scripts
# Prevents execution in sandbox environment
#
# Usage in test scripts:
#   source "$(dirname "$0")/../scripts/test_permission_guard.sh"
#   enforce_permissions

RED='\033[0;31m'
NC='\033[0m'

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Detect if running in sandbox environment
detect_sandbox() {
    # Test system commands that are blocked in Cursor sandbox
    if ! ps aux >/dev/null 2>&1 || ! netstat -tuln >/dev/null 2>&1 || ! whoami >/dev/null 2>&1; then
        return 0  # In sandbox
    fi
    return 1  # Not in sandbox
}

# Main guard function - blocks execution if in sandbox
enforce_permissions() {
    if detect_sandbox; then
        print_error "SANDBOX ENVIRONMENT DETECTED. Request full permission to run the command: required_permissions: ['all']"
        exit 1
    fi
}

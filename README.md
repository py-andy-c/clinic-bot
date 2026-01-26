# Clinic Bot

A comprehensive clinic management system with LINE integration.

## Testing Architecture

### Test Scripts Overview

| Script | Purpose | Default Mode | `--full` Mode |
|--------|---------|--------------|---------------|
| `run_tests.sh` | Main orchestrator | Parallel incremental | Parallel full coverage |
| `run_backend_tests.sh` | Python backend tests | Incremental (pytest-testmon) | Full coverage (65% min) |
| `run_frontend_tests.sh` | TypeScript/React tests | Changed files only | Full test suite |
| `run_e2e_tests.sh` | Playwright E2E tests | Incremental (only changed) | Full E2E suite |

### Execution Strategy

- **`run_tests.sh`**: Runs backend, frontend, and E2E tests in parallel
  - Detects changed files via git diff
  - Skips backend/frontend tests if no relevant changes
  - E2E tests always run (full system testing)
  - Passes `--full` flag through to all scripts

- **Fail-Early Behavior**: Each script fails early internally
  - Backend: Pyright → Schema validation → Pytest
  - Frontend: TypeScript → ESLint → Vitest
  - E2E: Environment setup → Playwright tests

- **Incremental Testing**:
  - Backend uses `pytest-testmon` for dependency-aware test selection
  - Frontend uses `--changed` flag for changed file detection
  - E2E uses `--only-changed` for incremental Playwright runs

### Quick Start

```bash
# Run all tests (incremental based on changes)
./run_tests.sh

# Run full test suite with coverage
./run_tests.sh --full

# Run individual test suites
./backend/run_backend_tests.sh        # Incremental backend tests
./frontend/run_frontend_tests.sh      # Incremental frontend tests
./run_e2e_tests.sh                    # Incremental E2E tests

# Full individual suites
./backend/run_backend_tests.sh --full
./frontend/run_frontend_tests.sh --full
./run_e2e_tests.sh --full
```

### Database Safety & Production Guards

The test suite includes a "fail-fast" security guard to prevent accidental destructive operations (like `Base.metadata.drop_all()`) on sensitive databases.

**Safety Criteria:**
1.  **Railway Production:** Tests will always block if `RAILWAY_ENVIRONMENT_NAME` is set to `production`.
2.  **Naming Convention:** PostgreSQL database names **must** contain the substring "test" (e.g., `clinic_bot_test`). Local development databases (e.g., `clinic_bot_dev`) are protected from accidental wipes.
3.  **Production Indicators:** URLs containing `railway.app` or `production` patterns are automatically blocked.

**Emergency Override:**
In extremely rare scenarios where you intentionally need to run tests against a non-standard database name (e.g., during complex E2E migrations), you can bypass these guards by setting:
```bash
export ALLOW_DANGEROUS_TEST_CLEANUP=true
```
*USE WITH EXTREME CAUTION. Data loss in targeted databases will be permanent.*

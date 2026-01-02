# Testing Infrastructure Documentation

This document provides a comprehensive overview of the testing infrastructure for the Clinic Bot project, including all test types, change detection mechanisms, and recommended development workflows.

## Table of Contents

1. [Overview](#overview)
2. [Backend Tests](#backend-tests)
3. [Frontend Unit Tests](#frontend-unit-tests)
4. [Frontend E2E Tests](#frontend-e2e-tests)
5. [Type Checking & Linting](#type-checking--linting)
6. [Test Scripts](#test-scripts)
7. [Pre-commit Hooks](#pre-commit-hooks)
8. [CI/CD Pipeline](#cicd-pipeline)
9. [Development Workflow](#development-workflow)

---

## Overview

The Clinic Bot project uses a multi-layered testing strategy:

- **Backend**: Python (pytest) with testmon for incremental testing
- **Frontend Unit**: TypeScript/React (Vitest) with change detection
- **Frontend E2E**: Playwright with custom file-to-test mapping
- **Type Safety**: Pyright (backend) and TypeScript (frontend)
- **Code Quality**: ESLint (frontend), pytest markers (backend)

All test runners support two modes:
- **Incremental** (default): Run only tests affected by changed files
- **Full Suite** (`--no-cache`): Run all tests with coverage

---

## Backend Tests

### Test Framework
- **Framework**: pytest
- **Type Checking**: pyright
- **Incremental Testing**: pytest-testmon (file hash-based)

### Running Tests

```bash
# Incremental mode (default) - runs only tests for changed files
cd backend
./run_backend_tests.sh

# Full suite with coverage
./run_backend_tests.sh --no-cache
```

### Change Detection: pytest-testmon

**How it works:**
- Uses file hash-based tracking (`.testmondata` file)
- Tracks which tests depend on which source files
- On each run, compares file hashes to determine which tests to run
- First run builds the dependency cache (may be slow)

**What gets tested:**
- Only tests that depend on changed files
- If a file's hash changes, all dependent tests run
- More accurate than git-based detection (catches refactoring)

**Test Structure:**
```
backend/
├── tests/
│   ├── unit/          # Unit tests (fast, isolated)
│   └── integration/   # Integration tests (slower, with DB)
├── run_backend_tests.sh
└── .testmondata       # Testmon cache (git-ignored)
```

### Test Execution Flow

1. **Type Checking**: Pyright validates Python types
2. **Schema Contract Validation**: Validates API contracts
3. **Unit Tests**: Fast, isolated tests
4. **Integration Tests**: Tests with database interactions

### Coverage Requirements

- **Full suite mode**: Minimum 65% coverage required
- **Incremental mode**: No coverage check (faster)

---

## Frontend Unit Tests

### Test Framework
- **Framework**: Vitest
- **Type Checking**: TypeScript compiler (`tsc --noEmit`)
- **Incremental Testing**: Vitest `--changed` flag (git-based)

### Running Tests

```bash
# Incremental mode (default) - runs only tests for changed files
cd frontend
./run_frontend_tests.sh

# Full suite
./run_frontend_tests.sh --no-cache
```

### Change Detection: Vitest --changed

**How it works:**
- Uses git to detect changed files
- Compares working directory against HEAD
- Runs tests for files that have changed
- Fast but less accurate than hash-based (may miss some dependencies)

**What gets tested:**
- Tests for files that have changed (git diff)
- Tests that import changed modules
- Vitest automatically tracks test dependencies

### Test Execution Flow

1. **Type Checking**: TypeScript compiler with incremental mode
2. **Linting**: ESLint (includes custom rules)
3. **Unit Tests**: Vitest test suite
4. **E2E Tests**: Playwright (see next section)

### Test Structure

```
frontend/
├── src/
│   ├── components/
│   │   └── __tests__/    # Component tests
│   └── utils/
│       └── __tests__/     # Utility tests
├── tests/
│   └── e2e/              # E2E tests (separate)
└── run_frontend_tests.sh
```

---

## Frontend E2E Tests

### Test Framework
- **Framework**: Playwright
- **Browsers**: Chromium, Firefox, WebKit, Mobile Chrome, Mobile Safari
- **Incremental Testing**: Custom script with file-to-test mapping

### Database Configuration

E2E tests use a **separate test database** to avoid polluting your development database.

**Default Test Database URL**: `postgresql://postgres:postgres@localhost:5432/test_db`

**Configuration Options:**
- Set `E2E_DATABASE_URL` environment variable to use a custom test database
- Example: `E2E_DATABASE_URL=postgresql://user:password@localhost:5432/my_test_db npm run test:e2e`

**Setting Up the Test Database:**

1. **Ensure PostgreSQL is running:**
   ```bash
   brew services start postgresql@14
   # or
   pg_ctl -D /usr/local/var/postgresql@14 start
   ```

2. **Create the test database** (if using default URL):
   ```bash
   createdb -U postgres test_db
   # or
   psql -U postgres -c "CREATE DATABASE test_db;"
   ```

3. **The backend will run migrations automatically** when starting for E2E tests

**Note**: The test database is separate from your development database (`clinic_bot`). This ensures E2E tests don't interfere with your development data.

### Running Tests

```bash
# Full E2E suite (all browsers)
cd frontend
npm run test:e2e

# Incremental (only relevant tests based on changed files)
npm run test:e2e:changed

# Quick sanity check (no servers needed)
npm run test:e2e:check

# Tag-based filtering
npm run test:e2e:auth      # Only @auth tests
npm run test:e2e:calendar  # Only @calendar tests
npm run test:e2e:settings  # Only @settings tests
npm run test:e2e:clinic    # Only @clinic tests
```

### Change Detection: Custom File-to-Test Mapping

**How it works:**
- Custom script: `frontend/scripts/run-changed-e2e-tests.js`
- Uses git diff to detect changed files
- Maps file paths to test tags using `FILE_TO_TAG_MAPPINGS`
- Runs only tests with relevant tags

**File-to-Tag Mapping:**

The mapping is defined in `frontend/scripts/run-changed-e2e-tests.js`:

```javascript
const FILE_TO_TAG_MAPPINGS = {
  // Calendar-related files
  'src/components/CalendarView.tsx': ['@calendar', '@auth'],
  'src/components/calendar/': ['@calendar'],
  
  // Authentication files
  'src/pages/LoginPage.tsx': ['@auth'],
  'src/hooks/useAuth.tsx': ['@auth'],
  
  // Settings files
  'src/pages/settings/': ['@settings'],
  
  // Clinic switching
  'src/components/ClinicSwitcher.tsx': ['@clinic'],
  
  // API services (affect all features)
  'src/services/api.ts': ['@auth', '@settings', '@calendar', '@clinic'],
  
  // General component changes
  'src/components/': ['@basic'],  // Fallback for any component
  'src/pages/': ['@basic'],       // Fallback for any page
};
```

**Tag-to-Test Mapping:**

```javascript
const TAG_TO_TESTS = {
  '@auth': ['appointment-creation.spec.ts', 'appointment-editing.spec.ts'],
  '@settings': ['settings-save.spec.ts'],
  '@calendar': ['calendar-navigation.spec.ts'],
  '@clinic': ['clinic-switching.spec.ts'],
  '@basic': ['basic-test.spec.ts'],
};
```

**Example:**
- Change `src/components/CalendarView.tsx`
- Triggers: `@calendar`, `@auth`, `@basic` tags
- Runs: `calendar-navigation.spec.ts`, `appointment-creation.spec.ts`, `appointment-editing.spec.ts`, `basic-test.spec.ts`

**Maintenance:**
When adding new components or features, update `FILE_TO_TAG_MAPPINGS` in `frontend/scripts/run-changed-e2e-tests.js` to ensure relevant E2E tests run when those files change. More specific paths should come before general ones in the mapping object.

### Test Structure

```
frontend/tests/e2e/
├── basic-test.spec.ts           # @basic - Smoke tests
├── appointment-creation.spec.ts # @auth - Appointment flows
├── appointment-editing.spec.ts  # @auth - Appointment flows
├── calendar-navigation.spec.ts  # @calendar - Calendar UI
├── settings-save.spec.ts        # @settings - Settings UI
├── clinic-switching.spec.ts     # @clinic - Clinic switching
├── helpers/
│   ├── auth.ts                  # Authentication helpers
│   └── calendar.ts              # Calendar helpers
├── global-setup.ts              # Test suite setup
└── global-teardown.ts          # Test suite cleanup
```

### Server Management

Playwright automatically manages servers:
- **Backend**: Started via `cd ../backend && ./launch_dev.sh`
- **Frontend**: Started via `NODE_ENV=test npm run dev` (port 3000)
- **Reuse**: Existing servers are reused in development (not CI)

### Configuration

- **Main Config**: `frontend/playwright.config.ts`
- **No-Server Config**: `frontend/playwright-no-server.config.ts` (for quick checks)

---

## Type Checking & Linting

### Backend

**Type Checking:**
- **Tool**: Pyright
- **Runs**: Automatically in `run_backend_tests.sh`
- **Mode**: Full type checking (no incremental mode)

**Linting:**
- **Tool**: pytest markers (for test organization)
- **Markers**: `@pytest.mark.unit`, `@pytest.mark.integration`, `@pytest.mark.slow`

### Frontend

**Type Checking:**
- **Tool**: TypeScript compiler (`tsc`)
- **Runs**: Automatically in `run_frontend_tests.sh`
- **Mode**: Incremental (`--incremental` flag for faster subsequent runs)

**Linting:**
- **Tool**: ESLint
- **Runs**: Automatically in `run_frontend_tests.sh`
- **Custom Rules**: Includes custom `clinic-cache` rule
- **Command**: `npm run lint`

---

## Test Scripts

### Top-Level: `run_tests.sh`

Orchestrates all tests across the project.

```bash
# Run backend and frontend tests in parallel (incremental)
./run_tests.sh

# Run full test suite
./run_tests.sh --no-cache

# Include E2E tests
./run_tests.sh --e2e
```

**Features:**
- Runs backend and frontend tests in parallel
- Optional E2E tests (opt-in with `--e2e`)
- Captures output and displays results
- Exits with error if any test suite fails

### Backend: `backend/run_backend_tests.sh`

```bash
cd backend
./run_backend_tests.sh          # Incremental (testmon)
./run_backend_tests.sh --no-cache  # Full suite with coverage
```

**Executes:**
1. Pyright type checking
2. Schema contract validation
3. Pytest tests (incremental or full)

### Frontend: `frontend/run_frontend_tests.sh`

```bash
cd frontend
./run_frontend_tests.sh          # Incremental
./run_frontend_tests.sh --no-cache  # Full suite
```

**Executes:**
1. TypeScript type checking
2. ESLint
3. Vitest unit tests
4. Playwright E2E tests (incremental or full)

---

## Pre-commit Hooks

**Location**: `.git/hooks/pre-commit`

**Behavior:**
- Automatically runs before each commit
- Only runs tests for changed files (incremental mode)
- Skips if no relevant files changed
- Aborts commit if tests fail

**What it does:**
1. Detects changed files in staged commit
2. If frontend files changed → runs `frontend/run_frontend_tests.sh`
3. If backend files changed → runs `backend/run_backend_tests.sh`
4. Only runs incremental tests (not full suite)

**Why incremental:**
- Fast feedback during development
- Prevents committing broken code
- Full suite runs in CI/CD

---

## CI/CD Pipeline

**Location**: `.github/workflows/ci.yml`

**Triggers:**
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop`

**Environment:**
- **OS**: Ubuntu latest
- **Python**: 3.12
- **Node.js**: 20
- **Database**: PostgreSQL 15 (Docker container)

**Test Execution:**

1. **Setup**
   - Checkout code
   - Install Python dependencies
   - Install Node.js dependencies
   - Install Playwright browsers

2. **Backend Tests**
   ```bash
   cd backend
   ./run_backend_tests.sh --no-cache
   ```
   - Full test suite with coverage
   - Uses PostgreSQL service container

3. **Frontend Tests**
   ```bash
   cd frontend
   ./run_frontend_tests.sh --no-cache
   ```
   - Type checking
   - Linting
   - Unit tests
   - E2E tests (full suite, all browsers)

4. **Artifacts**
   - Test results uploaded
   - Playwright HTML reports
   - Coverage reports

**Key Differences from Local:**
- Always runs full suite (`--no-cache`)
- PostgreSQL provided as service
- Playwright browsers installed with system dependencies
- All tests run sequentially (not parallel)

---

## Development Workflow

### Recommended Daily Workflow

#### 1. **During Development (Incremental Testing)**

```bash
# Make changes to code
# ...

# Quick check - run incremental tests
./run_tests.sh

# Or run specific test suite
cd backend && ./run_backend_tests.sh
cd frontend && ./run_frontend_tests.sh
```

**Benefits:**
- Fast feedback (only runs relevant tests)
- Catches issues early
- Doesn't slow down development

#### 2. **Before Committing**

Pre-commit hook automatically runs, but you can manually verify:

```bash
# Run incremental tests (what pre-commit will run)
./run_tests.sh

# If you want to be extra sure, run full suite
./run_tests.sh --no-cache
```

#### 3. **Before Pushing**

```bash
# Run full test suite to catch any issues
./run_tests.sh --no-cache

# Optionally include E2E tests
./run_tests.sh --no-cache --e2e
```

#### 4. **When Tests Fail**

**Incremental mode failed:**
- Fix the issue
- Re-run incremental tests
- If still failing, try full suite to see if other tests are affected

**Full suite failed:**
- Check which specific tests failed
- Fix issues
- Re-run full suite to verify

### Workflow Patterns

#### Pattern 1: Feature Development

```bash
# 1. Start feature branch
git checkout -b feature/new-feature

# 2. Make changes, test incrementally
./run_tests.sh

# 3. Before commit, verify
./run_tests.sh --no-cache

# 4. Commit (pre-commit runs incremental tests)
git commit -m "Add new feature"

# 5. Push (CI runs full suite)
git push
```

#### Pattern 2: Bug Fix

```bash
# 1. Reproduce bug
# 2. Write test that fails
# 3. Fix bug
# 4. Run tests
./run_tests.sh --no-cache

# 5. Commit and push
```

#### Pattern 3: Refactoring

```bash
# 1. Run full suite to establish baseline
./run_tests.sh --no-cache

# 2. Make refactoring changes
# 3. Run incremental tests (may miss some dependencies)
./run_tests.sh

# 4. Always run full suite before committing
./run_tests.sh --no-cache
```

### When to Use Each Mode

**Use Incremental Mode (`./run_tests.sh`):**
- ✅ During active development
- ✅ Quick feedback loop
- ✅ Pre-commit verification
- ✅ When you know what you changed

**Use Full Suite (`./run_tests.sh --no-cache`):**
- ✅ Before pushing to remote
- ✅ After major refactoring
- ✅ When tests fail unexpectedly
- ✅ Before creating PR
- ✅ In CI/CD (automatic)

**Use E2E Tests (`--e2e`):**
- ✅ Before major releases
- ✅ When changing UI flows
- ✅ When changing authentication
- ✅ Periodic verification (not every commit)

### Troubleshooting

#### Testmon cache issues (backend)
```bash
cd backend
rm .testmondata  # Clear cache
./run_backend_tests.sh  # Rebuild cache
```

#### Vitest cache issues (frontend)
```bash
cd frontend
rm -rf node_modules/.vite  # Clear cache
npm test -- --run  # Rebuild cache
```

#### Playwright server issues
```bash
cd frontend
# Kill any running servers
pkill -f "uvicorn"  # Backend
pkill -f "vite"     # Frontend

# Run E2E tests (servers will restart)
npm run test:e2e
```

#### Pre-commit hook not running
```bash
# Make sure hook is executable
chmod +x .git/hooks/pre-commit

# Test manually
.git/hooks/pre-commit
```

---

## Summary

### Test Types

| Type | Framework | Change Detection | Speed | Coverage |
|------|-----------|------------------|-------|----------|
| Backend Unit/Integration | pytest | testmon (hash-based) | Fast (incremental) | 65% required |
| Frontend Unit | Vitest | `--changed` (git-based) | Fast (incremental) | Not required |
| Frontend E2E | Playwright | Custom mapping (git-based) | Slow (full suite) | Not required |
| Type Checking | Pyright/TS | Always full | Fast | Always runs |

### Test Scripts

| Script | Incremental | Full Suite | E2E |
|--------|-------------|-------------|-----|
| `./run_tests.sh` | ✅ | `--no-cache` | `--e2e` |
| `backend/run_backend_tests.sh` | ✅ | `--no-cache` | N/A |
| `frontend/run_frontend_tests.sh` | ✅ | `--no-cache` | Included |

### When Tests Run

| Event | Backend | Frontend Unit | Frontend E2E |
|------|---------|---------------|---------------|
| During development | Incremental | Incremental | Manual |
| Pre-commit | Incremental | Incremental | No |
| Before push | Full | Full | Optional |
| CI/CD | Full | Full | Full |

---

## Additional Resources

- **Backend Tests**: `backend/run_backend_tests.sh --help`
- **Frontend Tests**: `frontend/run_frontend_tests.sh --help`
- **E2E Tests**: `frontend/scripts/run-changed-e2e-tests.js` (see file comments)
- **Playwright Docs**: https://playwright.dev
- **Vitest Docs**: https://vitest.dev
- **pytest-testmon Docs**: https://pytest-testmon.readthedocs.io


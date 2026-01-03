# Week 2: E2E Testing Foundation - Design Document

**Date:** January 2025  
**Status:** Phase 1 Complete ✅ | Phase 2 Complete ✅ | Phase 3+ Ready for Implementation  
**Related:** `docs/design_doc/ai_frontend_dev.md` - Week 2 Implementation

## Executive Summary

This document provides a comprehensive plan for implementing E2E testing with Playwright to establish a robust testing foundation that enables AI autonomous debugging. The implementation will integrate seamlessly with existing development workflows while meeting performance targets (<3s per test realistic, <2s stretch goal, <60s full suite, <15s incremental).

**Note:** This document has been updated to address critical feedback on transaction isolation, authentication strategy, and performance targets.

**Key Objectives:**
- Enable AI autonomous debugging through automated test feedback
- Achieve performance targets: <3s per test (realistic), <2s (stretch goal), <60s full suite, <15s incremental
- Ensure test isolation and parallel execution
- Maintain zero interference with manual development workflow
- Support incremental testing similar to existing patterns (`pytest-testmon`, `vitest --changed`, `playwright --only-changed`)

---

## 1. Test Environment Configuration

### 1.1 Environment Isolation

**Separate Test Environment:**
- **Database:** `clinic_bot_e2e` (separate from `clinic_bot` dev and `clinic_bot_test` unit tests)
- **Backend Port:** `8001` (dev uses `8000`)
- **Frontend Port:** `5174` (dev uses `5173`)
- **Environment File:** `.env.e2e` (loaded via `dotenv`)

**Port Strategy:**
- E2E tests use different ports to avoid conflicts with active dev servers
- Tests can run concurrently with manual development
- No modification to existing `backend/launch_dev.sh` or development workflow

### 1.2 Playwright Configuration

**Base Configuration:**
```typescript
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.e2e' });

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined, // Auto-detect locally
  reporter: [
    ['html'],
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'cd backend && source venv/bin/activate && python -m uvicorn main:app --port 8001',
      url: 'http://localhost:8001/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120000, // 120s for backend (includes migrations)
      retries: 3, // Retry health check 3 times with exponential backoff
      env: {
        DATABASE_URL: process.env.E2E_DATABASE_URL || 'postgresql://user:password@localhost/clinic_bot_e2e',
        E2E_TEST_MODE: 'true',
      },
    },
    {
      command: 'cd frontend && npm run dev -- --port 5174',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 60000, // 60s for frontend
      retries: 3, // Retry health check 3 times
      env: {
        VITE_API_BASE_URL: 'http://localhost:8001/api',
      },
    },
  ],
});
```

**Key Decisions:**
- **Workers:** Auto-detect locally (optimal resource usage), fixed 4 in CI (consistency)
- **Retries:** 0 locally (fail fast), 2 in CI (handle transient issues)
- **Web Server:** Automatic lifecycle management via Playwright's `webServer` config
- **Reuse Servers:** Reuse existing servers locally, always start fresh in CI
- **Health Checks:** 3 retries with exponential backoff, 120s timeout for backend, 60s for frontend
- **Server Cleanup:** Document manual cleanup process for stuck servers (see Troubleshooting section)

---

## 2. Test Data Management

### 2.1 Database Isolation Strategy

**Transaction-Based Isolation (Recommended):**
All analyses strongly recommend transaction-based isolation for speed and perfect isolation, similar to backend tests. However, implementation requires careful consideration of HTTP statelessness and session management.

**Implementation Strategy: Session-Scoped Transactions via Middleware (Recommended)**

**Backend Implementation:**
Create FastAPI middleware that wraps all requests in a transaction when `E2E_TEST_MODE=true`:

```python
# backend/src/api/test/transaction_middleware.py
from fastapi import Request, HTTPException
from sqlalchemy.orm import Session
from core.database import get_db

class E2ETransactionMiddleware:
    """Middleware for E2E test transaction isolation."""
    
    async def __call__(self, request: Request, call_next):
        if not os.getenv('E2E_TEST_MODE'):
            return await call_next(request)
        
        # Get transaction ID from header or session
        transaction_id = request.headers.get('X-Test-Transaction-ID')
        
        if request.url.path == '/api/test/begin-transaction':
            # Create new transaction, return transaction ID
            db = next(get_db())
            transaction = db.begin_nested()  # Savepoint
            transaction_id = str(uuid.uuid4())
            # Store transaction in session/cache
            return JSONResponse({'transaction_id': transaction_id})
        
        if request.url.path == '/api/test/rollback-transaction':
            # Rollback transaction
            # Retrieve and rollback transaction
            return JSONResponse({'status': 'rolled_back'})
        
        # For all other requests, use existing transaction
        # Wrap request in transaction context
        return await call_next(request)
```

**Alternative: Database Savepoints (Similar to Backend Tests)**
- Use nested transactions with savepoints (like `backend/tests/conftest.py`)
- Disable connection pooling for test mode
- Each test gets its own connection with savepoint
- **Pros:** Proven pattern, matches backend tests
- **Cons:** Connection management complexity

**Fallback: Unique Data with Cleanup**
- Use unique identifiers per test (UUIDs, timestamps)
- Clean up test-specific data in `afterEach`
- **When to use:** If transaction implementation is not ready, or for tests that verify transaction behavior itself
- **Pros:** No backend changes needed, can start immediately
- **Cons:** Slower than transactions (~2-3x slower)

**Recommended Approach:**
- **Phase 1:** Start with unique data + cleanup (can begin immediately)
- **Phase 2:** Implement session-scoped transactions via middleware
- **Phase 3:** Migrate tests to use transactions for performance

**Test Implementation (Transaction-Based):**
```typescript
// tests/e2e/fixtures/database.ts
export const test = base.extend({
  dbTransaction: async ({ request }, use) => {
    // Begin transaction
    const response = await request.post('/api/test/begin-transaction');
    const { transaction_id } = await response.json();
    
    // Set transaction ID in headers for subsequent requests
    const context = await request.newContext({
      extraHTTPHeaders: {
        'X-Test-Transaction-ID': transaction_id,
      },
    });
    
    await use(context);
    
    // Always rollback, even on failure
    await request.post('/api/test/rollback-transaction', {
      headers: { 'X-Test-Transaction-ID': transaction_id },
    });
  },
});
```

**Test Implementation (Unique Data - Fallback):**
```typescript
test('create appointment', async ({ page }) => {
  const uniqueId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const patientName = `Test Patient ${uniqueId}`;
  
  // Create test data with unique identifier
  await createTestPatient({ name: patientName });
  
  // Run test...
  
  // Cleanup
  await deleteTestPatient(patientName);
});
```

### 2.2 Test Data Seeding

**Base Data (Session-Scoped):**
- Test clinics with settings
- Test users (admin, practitioner, staff)
- Common appointment types
- Common resource types

**Test-Specific Data (Test-Scoped):**
- Patients (unique names/IDs per test)
- Appointments (unique timestamps)
- Service items, billing scenarios
- Resource allocations

**Seeding Implementation:**
```typescript
// tests/e2e/global-setup.ts
async function globalSetup() {
  // Run migrations (idempotent - Alembic handles this)
  execSync('cd backend && alembic upgrade head', {
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL },
  });
  
  // Seed base data (idempotent, with database locks for parallel safety)
  await seedBaseData();
}

// backend/scripts/seed_e2e_data.py
async def seed_base_data():
    """Seed base test data with idempotency guarantees."""
    # Use database-level locks to prevent race conditions
    # Use INSERT ... ON CONFLICT DO NOTHING for idempotency
    async with db.begin():
        # Lock table to prevent concurrent seeding
        await db.execute(text("LOCK TABLE clinics IN EXCLUSIVE MODE"))
        
        # Idempotent inserts
        await db.execute(
            text("""
                INSERT INTO clinics (name, line_channel_id, settings)
                VALUES ('Test Clinic', 'test_channel', '{}')
                ON CONFLICT (line_channel_id) DO NOTHING
            """)
        )
        
        # Similar for users, appointment_types, etc.
```

**Seeding Strategy:**
- **Idempotency:** All seed operations use `INSERT ... ON CONFLICT DO NOTHING`
- **Parallel Safety:** Use database-level locks (`LOCK TABLE ... IN EXCLUSIVE MODE`) during seeding
- **Timing:** Seed in `global-setup.ts` before parallel test execution begins
- **Dependencies:** Document seed data dependencies clearly (e.g., clinics before users)

---

## 3. Test Setup and Teardown

### 3.1 Playwright Hooks

**Global Setup:**
- Run database migrations
- Seed base test data
- Start test servers (handled by `webServer` config)

**Global Teardown:**
- Optional cleanup (transactions handle most cleanup)
- Stop test servers (automatic via `webServer`)

**Test-Level Setup (`beforeEach`):**
- Navigate to base URL
- Set up authentication (if needed)
- Begin database transaction (if using transaction isolation)

**Test-Level Teardown (`afterEach`):**
- Rollback database transaction
- Clean up test-specific data (if not using transactions)
- Screenshots/videos captured automatically on failure

### 3.2 Authentication Fixtures

**Authentication Strategy:**
The codebase uses Google OAuth, not form-based authentication. For E2E tests, we use a test-only authentication endpoint that bypasses OAuth.

**Backend: Test-Only Auth Endpoint**
```python
# backend/src/api/test/auth.py
@router.post("/login", dependencies=[Depends(require_e2e_mode)])
async def test_login(request: TestLoginRequest):
    """Test-only endpoint that returns JWT tokens directly (bypasses OAuth)."""
    # Only available when E2E_TEST_MODE=true
    # Endpoint path: /api/test/login (router prefix: /api/test)
    # Creates user if they don't exist
    user = get_or_create_user(request.email, request.user_type)
    access_token = create_access_token(user)
    refresh_token = create_refresh_token(user)
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": user,
    }
```

**Playwright Fixture with Token Caching:**
```typescript
// tests/e2e/fixtures/auth.ts
import { test as base } from '@playwright/test';

// Cache authentication tokens to avoid repeated logins
let cachedAuthState: { cookies: any[], storageState: any } | null = null;

export const test = base.extend({
  authenticatedPage: async ({ page, request }, use) => {
    // Use cached auth state if available
    if (cachedAuthState) {
      await page.context().addCookies(cachedAuthState.cookies);
      await use(page);
      return;
    }
    
    // Authenticate via test-only endpoint
    const response = await request.post('/api/test/login', {
      data: { 
        email: 'test@example.com',
        user_type: 'system_admin' // or 'clinic_user'
      },
    });
    const { access_token, refresh_token } = await response.json();
    
    // Set tokens in localStorage
    await page.goto('/');
    await page.evaluate(({ access_token, refresh_token }) => {
      localStorage.setItem('access_token', access_token);
      localStorage.setItem('refresh_token', refresh_token);
    }, { access_token, refresh_token });
    
    // Save auth state for reuse
    const cookies = await page.context().cookies();
    cachedAuthState = { cookies, storageState: null };
    
    await use(page);
  },
});
```

**Alternative: Playwright storageState (For OAuth Flow Testing)**
```typescript
// If testing OAuth flow is required, use storageState
// tests/e2e/global-setup.ts
async function globalSetup() {
  // Authenticate once and save state
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Complete OAuth flow (or use mocked OAuth)
  await page.goto('/admin/login');
  // ... OAuth flow ...
  
  // Save authenticated state
  await context.storageState({ path: 'auth-state.json' });
  await browser.close();
}

// playwright.config.ts
use: {
  storageState: 'auth-state.json', // Reuse across all tests
}
```

**Recommendation:**
- **Primary:** Use test-only auth endpoint (fastest, <0.5s setup)
- **Alternative:** Use `storageState` if OAuth flow testing is required
- **Note:** OAuth flow testing should be separate integration tests, not E2E tests

---

## 4. Test Isolation

### 4.1 Isolation Strategies

**Browser Context Isolation:**
- Playwright automatically creates new browser context per test
- Isolated cookies, localStorage, sessionStorage
- No shared state between tests

**Database Isolation:**
- **Primary:** Transaction-based rollback (fastest, perfect isolation)
- **Fallback:** Unique data with cleanup (slower, more explicit)

**State Isolation:**
- No shared mutable state between tests
- Use fixtures for read-only base data only
- Each test creates its own test-specific data

### 4.2 Parallel Execution Safety

**Requirements:**
- Tests must be truly independent (no shared state)
- Use transactions or unique data to prevent conflicts
- Avoid shared resources (files, external services)
- Mock external APIs to prevent rate limiting

**Verification:**
- Run tests multiple times in parallel
- Use Playwright's `--repeat-each` flag for flakiness detection: `npx playwright test --repeat-each=5`
- Monitor for flaky failures (indicates isolation issues)
- Track test execution times (should be consistent across runs)
- Run same test suite twice in parallel simultaneously to detect conflicts

---

## 5. Incremental Testing

### 5.1 Test Selection Strategies

**Option 1: Playwright's `--only-changed` Flag (Recommended)**
```bash
# Simplest approach, built-in
npx playwright test --only-changed
```

**Option 2: Tag-Based Filtering**
```typescript
test('create appointment @smoke @appointment', async ({ page }) => {
  // Test code
});

// Run only smoke tests
npx playwright test --grep @smoke
```

**Option 3: Custom File-Based Filtering**
```bash
# Detect changed test files
CHANGED_TESTS=$(git diff --name-only HEAD | grep 'tests/e2e.*\.spec\.ts' || true)

if [ -n "$CHANGED_TESTS" ]; then
  npx playwright test $CHANGED_TESTS
else
  npx playwright test --grep @smoke
fi
```

**Recommended Approach:**
- **Phase 1:** ✅ Use Playwright's `--only-changed` flag (implemented)
- **Phase 2:** Add tag-based filtering for test categories
- **Phase 3:** Implement custom filtering if needed

### 5.2 Test Organization

**Directory Structure:**
```
tests/e2e/
├── smoke/           # Critical smoke tests (run first)
├── appointments/    # Appointment-related tests
├── settings/        # Settings tests
├── calendar/        # Calendar tests
├── fixtures/        # Shared fixtures
└── helpers/         # Test helpers
```

**Test Tags:**
- `@smoke`: Critical tests (run in incremental mode)
- `@critical`: Tests that must pass before deployment (subset of @smoke)
- `@appointment`: Appointment-related tests
- `@settings`: Settings-related tests
- `@calendar`: Calendar-related tests
- `@slow`: Slow tests (skip in quick runs)

---

## 6. Wait & Timeout Strategy

### 6.1 Playwright Auto-Waiting

**Built-in Auto-Waiting:**
- Playwright automatically waits for elements to be:
  - Attached to DOM
  - Visible
  - Stable (not animating)
  - Enabled
  - Receiving events
- No manual waits needed for most cases

**Best Practices:**
- Use `page.getByRole()`, `page.getByTestId()`, `page.getByText()` (include auto-waiting)
- Avoid `$()` and `$$()` (no auto-waiting)
- Never use fixed delays (`waitForTimeout()`)

### 6.2 Timeout Configuration

```typescript
// playwright.config.ts
export default defineConfig({
  timeout: 30000, // 30s per test
  expect: {
    timeout: 5000, // 5s for assertions
  },
  use: {
    actionTimeout: 10000, // 10s for actions
    navigationTimeout: 30000, // 30s for navigation
  },
});
```

### 6.3 Custom Waits (When Needed)

```typescript
// Wait for API response
await page.waitForResponse(response => 
  response.url().includes('/api/appointments') && response.status() === 200
);

// Wait for navigation
await page.waitForURL('/appointments/**');

// Wait for custom condition
await page.waitForFunction(() => 
  document.querySelector('[data-testid="appointment"]') !== null
);
```

---

## 7. Best Practices

### 7.1 Selector Strategy

**Stable Selectors:**
- Prefer `data-testid` attributes over CSS selectors
- Use Playwright's semantic locators (`getByRole`, `getByText`, `getByLabel`)
- Avoid XPath and complex CSS selectors

**Example:**
```typescript
// Good: Stable selector
await page.getByTestId('create-appointment-button').click();

// Bad: Brittle selector
await page.click('.btn-primary:nth-child(2)');
```

### 7.2 Page Object Model (POM)

**Structure:**
```typescript
// tests/e2e/pages/AppointmentPage.ts
export class AppointmentPage {
  constructor(private page: Page) {}
  
  async goto() {
    await this.page.goto('/appointments');
  }
  
  async createAppointment(patientName: string) {
    await this.page.getByTestId('create-appointment-button').click();
    await this.page.getByTestId('patient-selector').fill(patientName);
    await this.page.getByTestId('submit-button').click();
  }
}
```

**Benefits:**
- Reusable page interactions
- Easier maintenance when UI changes
- Clear separation of concerns

### 7.3 Network Interception

**Scope: External APIs Only**
- **DO NOT mock:** Internal API calls to backend on port 8001 (these are part of the test)
- **DO mock:** Truly external services (LINE API, Google OAuth, payment gateways, etc.)

**External Services to Mock:**
- LINE Messaging API (`https://api.line.me/**`)
- Google OAuth (`https://accounts.google.com/**`)
- Payment gateways (if applicable)
- Any third-party webhooks

**Mock External APIs:**
```typescript
test('appointment creation', async ({ page }) => {
  // Mock LINE API (external service)
  await page.route('https://api.line.me/**', route => {
    route.fulfill({
      status: 200,
      body: JSON.stringify({ success: true }),
      headers: { 'Content-Type': 'application/json' },
    });
  });
  
  // DO NOT mock internal API calls
  // Internal calls to http://localhost:8001/api/** should go through normally
  
  // Test code - external API is mocked, internal API is real
  await page.goto('/appointments');
});
```

**Benefits:**
- Faster tests (no external API calls)
- Deterministic results
- No rate limiting issues
- Tests work offline
- Internal API behavior is tested (not mocked)

### 7.4 Flakiness Prevention

**Strategies:**
1. Use stable selectors (`data-testid`)
2. Leverage auto-waiting (no fixed delays)
3. Ensure test independence (no shared state)
4. Mock external services
5. Use proper assertions (Playwright's assertion API)
6. Enable retries in CI only (2 retries)

**Monitoring:**
- Track test failure rates over time
- Identify flaky tests (failures that don't reproduce)
- Fix flaky tests immediately (don't ignore)

---

## 8. Performance Targets

### 8.1 Individual Test Performance

**Target:** <3 seconds per test (realistic), <2 seconds (stretch goal after optimization)

**Reality Check:**
- Browser startup: ~0.5-1s
- Page navigation: ~0.5-1s
- Database operations: ~0.1-0.3s per query
- Network requests: ~0.1-0.5s each
- **Total realistic:** ~2-3s per test

**Breakdown:**
- Setup: <0.5s (authentication with caching, navigation)
- Test execution: <1.5s (user interactions, assertions, API calls)
- Teardown: <0.5s (cleanup, transaction rollback)

**Optimization:**
- Fast authentication (cache tokens, use test-only endpoint)
- Efficient selectors (data-testid)
- Minimal waits (rely on auto-waiting)
- Mock external services (LINE API, OAuth)
- Use transaction rollback (faster than cleanup)

**Performance Monitoring:**
- Track actual vs. target times per test
- Identify slow tests (>3s) and optimize
- Use Playwright's built-in timing reports
- Set up alerts for performance regressions

### 8.2 Full Suite Performance

**Target:** <60 seconds for full suite (with parallel execution)

**Assumptions:**
- ~30-40 tests in full suite
- 4 parallel workers
- Average test time: 2.5s (realistic, accounting for cold starts)
- Calculation: (30 tests / 4 workers) * 2.5s = ~19s + overhead (~40s for server startup, migrations) = <60s

**Optimization:**
- Parallel execution (4 workers)
- Efficient test design
- Fast setup/teardown
- Minimal database operations

### 8.3 Incremental Suite Performance

**Target:** <15 seconds for typical incremental run

**Assumptions:**
- 3-5 tests run in incremental mode
- 2 parallel workers
- Average test time: 2.5s (realistic)
- Calculation: (5 tests / 2 workers) * 2.5s = ~6s + overhead (~9s for server startup if needed) = <15s

**Optimization:**
- Run only changed tests
- Fast test selection (Playwright `--only-changed` or git diff)
- Parallel execution (2 workers)

---

## 9. Integration with Development Workflow

### 9.1 Non-Interference Strategy

**Separate Resources:**
- **Ports:** E2E (8001, 5174) vs. Dev (8000, 5173)
- **Database:** E2E (`clinic_bot_e2e`) vs. Dev (`clinic_bot`)
- **Environment:** `.env.e2e` vs. `.env`

**Guarantees:**
- E2E tests don't interfere with `backend/launch_dev.sh`
- E2E tests can run while dev server is active
- E2E tests don't require dev server to be running

### 9.2 Test Scripts

**Script Structure:**
```bash
# run_e2e_tests.sh
# Usage:
#   ./run_e2e_tests.sh           - Run E2E tests incrementally (--only-changed)
#   ./run_e2e_tests.sh --all     - Run full E2E test suite
#   ./run_e2e_tests.sh --ui      - Run with UI mode (headed browser)
```

**Integration with `run_tests.sh`:**
- Optionally add E2E tests as a step
- Run after backend/frontend unit tests pass
- Use incremental mode by default

### 9.3 CI/CD Integration

**GitHub Actions Workflow:**
```yaml
name: E2E Tests

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_DB: clinic_bot_e2e
          POSTGRES_USER: user
          POSTGRES_PASSWORD: password
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - uses: actions/setup-python@v4
      - name: Install dependencies
        run: |
          cd backend && pip install -r requirements.txt
          cd ../frontend && npm ci
      - name: Install Playwright
        run: npx playwright install --with-deps
      - name: Run migrations
        run: |
          cd backend
          DATABASE_URL=postgresql://user:password@localhost/clinic_bot_e2e alembic upgrade head
      - name: Run E2E tests
        run: npx playwright test
      - name: Upload test results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```

**CI Considerations:**
- Use PostgreSQL service in CI
- Run migrations before tests
- Cache Playwright browsers (large download)
- Upload test artifacts (screenshots, videos, traces)
- Run in parallel workers for speed

---

## 10. Implementation Plan

### 10.1 Phase 1: Foundation Setup (Days 1-2) ✅ **COMPLETED**

**Tasks:**
1. ✅ Install Playwright: `npm install -D @playwright/test`
2. ✅ Install browsers: `npx playwright install`
3. ✅ Create `playwright.config.ts` with base configuration
4. ✅ Create test directory structure: `tests/e2e/`
5. ✅ Set up test database: `clinic_bot_e2e`
6. ✅ Create `.env.e2e.example` file with test environment variables
7. ✅ Create `run_e2e_tests.sh` script with `--only-changed` support
8. ✅ Test server startup (webServer config)
9. ✅ Create initial smoke tests
10. ✅ Implement incremental testing with `--only-changed`

**Deliverables:**
- ✅ Playwright installed and configured
- ✅ Test environment isolated from dev (ports 8001/5174, database `clinic_bot_e2e`)
- ✅ Basic test infrastructure ready
- ✅ Incremental testing working (`--only-changed` flag)
- ✅ Smoke tests passing
- ✅ All feedback addressed

### 10.2 Phase 2: First E2E Test (Day 3)

**Tasks:**
1. ✅ Implement test-only auth endpoint (`POST /api/test/login`) or use `storageState`
2. ✅ Create authentication helper/fixture with token caching
3. ✅ Create first E2E test (appointment creation) - **Note:** Full appointment creation flow deferred to Phase 3 (requires test data setup: patients, appointment types, practitioners)
4. ✅ Add `data-testid` attributes to critical UI elements
5. ✅ Test test execution and debugging
6. ✅ Verify test isolation

**Deliverables:**
- ✅ First E2E test passing (navigation and authentication verification)
- ✅ Authentication helper working (test-only endpoint with token caching)
- ✅ Test debugging workflow established
- ✅ Modal opening test added (verifies appointment creation UI is accessible)
- **Note:** Full appointment creation E2E test (filling form, submitting, verifying in calendar) deferred to Phase 3 as it requires comprehensive test data setup (patients, appointment types, practitioners, resources)

### 10.3 Phase 3: Test Suite Expansion (Days 4-5)

**Tasks:**
1. Create 3-5 more E2E tests (critical flows):
   - Appointment creation
   - Appointment editing
   - Settings save
   - Clinic switching
   - Calendar navigation
2. Create test fixtures for common data
3. Implement test data cleanup:
   - Start with unique data + cleanup (can begin immediately)
   - Or implement transaction-based isolation if backend endpoints are ready
4. Add test tags (`@smoke`, `@appointment`, `@critical`, etc.)
5. Optimize test performance (<3s per test realistic, <2s stretch goal)

**Deliverables:**
- 3-5 E2E tests covering critical flows
- Test fixtures and helpers
- Performance targets met

### 10.4 Phase 4: Integration & Optimization (Days 6-7)

**Tasks:**
1. Integrate into development workflow (`run_e2e_tests.sh`)
2. ✅ Implement incremental testing (Playwright `--only-changed` flag) - **COMPLETED in Phase 1**
3. Add CI/CD configuration (GitHub Actions)
4. Optimize test execution time
5. Document test patterns and conventions
6. Test AI autonomous debugging (run failing test, AI fixes)

**Deliverables:**
- E2E tests integrated into workflow
- Incremental testing working
- CI/CD integration complete
- Documentation complete

---

## 11. Success Criteria

### 11.1 Technical Criteria

**Must Have:**
- ✅ Playwright installed and configured
- ✅ Test environment isolated from dev
- ✅ 3-5 E2E tests covering critical flows
- ✅ Tests run in <3s each (realistic), <2s (stretch goal)
- ✅ Full suite runs in <60s
- ✅ Incremental suite runs in <15s
- ✅ Tests are non-flaky (<1% failure rate)
- ✅ Tests can run in parallel
- ✅ CI/CD integration working
- ✅ Error reporting format supports AI debugging

**Nice to Have:**
- ✅ 10+ E2E tests covering major flows
- ✅ Page Object Model implemented
- ✅ Comprehensive test fixtures
- ✅ Test dependency tracking (future)

### 11.2 Workflow Criteria

**Must Have:**
- ✅ E2E tests don't interfere with dev server
- ✅ E2E tests can run while dev server is active
- ✅ Incremental testing works (Playwright `--only-changed`)
- ✅ Test execution is fast (<15s typical)
- ✅ Test debugging is easy (inspector, traces)

### 11.3 AI Autonomous Debugging Criteria

**Must Have:**
- ✅ AI can run E2E tests
- ✅ AI can see test failures
- ✅ AI can fix issues based on test failures
- ✅ Test failures provide clear feedback

**Error Reporting Format for AI:**
Test failures must include:
- **Clear error messages** with context (what action failed, expected vs. actual)
- **Screenshots/videos** on failure (already configured in Playwright)
- **Network request/response logs** (enable via `trace: 'on-first-retry'`)
- **DOM snapshots** on failure (Playwright's trace viewer)
- **Stack traces** with file locations and line numbers
- **Test execution timeline** (when each action occurred)

**Example Error Format:**
```
Test: create appointment flow @smoke @appointment
Failed at: Clicking submit button
Expected: Success message visible
Actual: Validation error visible
Screenshot: test-results/create-appointment-1.png
Trace: test-results/trace.zip
Network Log: POST /api/appointments - 400 Bad Request
  Request: { patient_id: null, ... }
  Response: { error: "Patient is required" }
```

**Success Metric:**
- AI can autonomously debug frontend issues using E2E test failures
- Similar to backend: AI runs tests → sees failures → fixes → re-runs
- Error messages are clear enough for AI to understand and fix issues

---

## 12. Risk Mitigation

### 12.1 Technical Risks

**Risk: Flaky Tests**
- **Impact:** High (reduces confidence in tests)
- **Mitigation:** Use stable selectors, auto-waiting, test isolation, retries in CI

**Risk: Slow Test Execution**
- **Impact:** Medium (reduces developer productivity)
- **Mitigation:** Optimize test design, parallel execution, incremental testing

**Risk: Test Maintenance Burden**
- **Impact:** Medium (tests become outdated)
- **Mitigation:** Use stable selectors (data-testid), Page Object Model, regular review

**Risk: Environment Conflicts**
- **Impact:** Low (tests interfere with dev)
- **Mitigation:** Separate ports, separate database, isolated environment

### 12.2 Process Risks

**Risk: Tests Not Run Regularly**
- **Impact:** High (tests become outdated, issues not caught)
- **Mitigation:** Integrate into CI/CD, make tests fast, incremental testing

**Risk: Test Coverage Gaps**
- **Impact:** Medium (some issues not caught)
- **Mitigation:** Start with critical flows, expand coverage over time

**Risk: AI Can't Use Tests Effectively**
- **Impact:** High (defeats purpose of E2E tests)
- **Mitigation:** Clear test failures, good error messages, documentation

---

## 13. File Structure

```
clinic-bot/
├── tests/
│   └── e2e/
│       ├── fixtures/
│       │   ├── auth.ts          # Authentication helpers
│       │   ├── test-data.ts     # Test data fixtures
│       │   ├── database.ts      # Database transaction helpers
│       │   └── pages/           # Page Object Model
│       ├── helpers/
│       │   ├── api.ts           # API helpers for test data
│       │   └── database.ts      # Database helpers
│       ├── smoke/               # Critical smoke tests
│       │   └── app-availability.spec.ts
│       ├── appointments/        # Appointment-related tests
│       │   ├── create.spec.ts
│       │   └── edit.spec.ts
│       ├── settings/            # Settings tests
│       │   └── save.spec.ts
│       ├── calendar/             # Calendar tests
│       │   └── navigation.spec.ts
│       ├── global-setup.ts       # Global setup (migrations, seeding)
│       └── global-teardown.ts    # Global teardown
├── playwright.config.ts
├── .env.e2e                     # E2E test environment variables
├── run_e2e_tests.sh             # E2E test runner script
└── .github/
    └── workflows/
        └── e2e.yml              # CI/CD configuration
```

---

## 14. Example Test

```typescript
// tests/e2e/appointments/create.spec.ts
import { test, expect } from '@playwright/test';
import { AppointmentPage } from '../pages/AppointmentPage';

test.describe('Appointment Creation', () => {
  test('create appointment flow @smoke @appointment', async ({ authenticatedPage, request }) => {
    // Option 1: Using transaction-based isolation (if implemented)
    const response = await request.post('/api/test/begin-transaction');
    const { transaction_id } = await response.json();
    const context = await request.newContext({
      extraHTTPHeaders: {
        'X-Test-Transaction-ID': transaction_id,
      },
    });
    
    try {
      // authenticatedPage fixture handles authentication (test-only endpoint)
      const appointmentPage = new AppointmentPage(authenticatedPage);
      await appointmentPage.goto();
      
      // Create appointment with unique patient name
      const uniqueId = `test-${Date.now()}`;
      const patientName = `Test Patient ${uniqueId}`;
      
      await appointmentPage.createAppointment({
        patient: patientName,
        type: '一般治療',
        practitioner: 'Dr. Smith',
        date: '2025-01-15',
        time: '10:00',
        notes: 'Test appointment',
      });
      
      // Verify success
      await expect(authenticatedPage.getByTestId('success-message')).toBeVisible();
      await expect(authenticatedPage.getByTestId('success-message')).toContainText('預約已建立');
      
      // Verify appointment appears in calendar
      await expect(appointmentPage.getAppointment(patientName)).toBeVisible();
    } finally {
      // Always rollback transaction
      await request.post('/api/test/rollback-transaction', {
        headers: { 'X-Test-Transaction-ID': transaction_id },
      });
    }
  });
  
  // Option 2: Using unique data + cleanup (fallback, no transactions)
  test('create appointment with cleanup @appointment', async ({ authenticatedPage }) => {
    const uniqueId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const patientName = `Test Patient ${uniqueId}`;
    
    try {
      const appointmentPage = new AppointmentPage(authenticatedPage);
      await appointmentPage.goto();
      
      await appointmentPage.createAppointment({
        patient: patientName,
        type: '一般治療',
        practitioner: 'Dr. Smith',
        date: '2025-01-15',
        time: '10:00',
        notes: 'Test appointment',
      });
      
      // Verify success
      await expect(authenticatedPage.getByTestId('success-message')).toBeVisible();
    } finally {
      // Cleanup test data
      await deleteTestPatient(patientName);
    }
  });
});
```

---

## 15. Environment Variables

**`.env.e2e` Template:**
```bash
# Database
DATABASE_URL=postgresql://user:password@localhost/clinic_bot_e2e

# API Configuration
VITE_API_BASE_URL=http://localhost:8001/api

# Test Configuration
E2E_TEST_MODE=true
JWT_SECRET_KEY=test-jwt-secret-key-for-e2e-tests
ENCRYPTION_KEY=YyD8O45QlfRZUXT9kzjW3xEf6iNqz5EtF_OB8WEOBqw=
SYSTEM_ADMIN_EMAILS=test@example.com
LINE_CHANNEL_SECRET=test-channel-secret
LINE_CHANNEL_ACCESS_TOKEN=test-access-token
```

---

## 16. Conclusion

This design document provides a comprehensive plan for implementing E2E testing with Playwright. The foundation will:

1. **Enable AI Autonomous Debugging:** Tests provide automated feedback for AI to fix issues
2. **Integrate Seamlessly:** Tests don't interfere with development workflow
3. **Meet Performance Targets:** <3s per test (realistic), <2s (stretch goal), <60s full suite, <15s incremental
4. **Ensure Reliability:** Non-flaky tests with proper isolation
5. **Support Efficiency:** Incremental testing, parallel execution

The implementation follows industry best practices and integrates with existing project patterns (similar to backend `pytest-testmon` and frontend `vitest --changed`). Phase 1 is complete with incremental testing via `playwright --only-changed`.

**Next Steps:**
1. Review and approve this design document
2. Begin Phase 1: Foundation Setup
3. Iterate based on implementation experience
4. Expand test coverage over time

---

---

## 17. Troubleshooting

### 17.1 Server Startup Issues

**Problem: Servers fail to start or health checks timeout**

**Solutions:**
1. **Check port availability:**
   ```bash
   lsof -i :8001  # Backend port
   lsof -i :5174  # Frontend port
   ```

2. **Kill stuck processes:**
   ```bash
   pkill -f "uvicorn.*8001"  # Kill backend
   pkill -f "vite.*5174"     # Kill frontend
   ```

3. **Manual server cleanup:**
   ```bash
   # Kill all test servers
   pkill -f "uvicorn.*8001"
   pkill -f "vite.*5174"
   
   # Wait a moment
   sleep 2
   
   # Retry tests
   npx playwright test
   ```

4. **Increase timeouts in `playwright.config.ts`:**
   ```typescript
   webServer: [{
     timeout: 180000, // Increase to 180s if needed
     // ...
   }]
   ```

### 17.2 Database Connection Issues

**Problem: Tests fail with database connection errors**

**Solutions:**
1. **Verify PostgreSQL is running:**
   ```bash
   pg_isready -h localhost
   ```

2. **Check test database exists:**
   ```bash
   psql -h localhost -l | grep clinic_bot_e2e
   ```

3. **Create test database if missing:**
   ```bash
   createdb clinic_bot_e2e
   ```

4. **Run migrations manually:**
   ```bash
   cd backend
   DATABASE_URL=postgresql://user:password@localhost/clinic_bot_e2e alembic upgrade head
   ```

### 17.3 Flaky Test Detection

**Problem: Tests pass sometimes but fail other times**

**Solutions:**
1. **Run tests multiple times:**
   ```bash
   npx playwright test --repeat-each=10
   ```

2. **Check for timing issues:**
   - Review test for fixed delays (`waitForTimeout`)
   - Ensure proper use of auto-waiting
   - Check for race conditions

3. **Verify test isolation:**
   - Ensure tests don't share state
   - Check for unique data conflicts
   - Verify transaction rollback is working

4. **Review test logs:**
   - Check screenshots/videos on failure
   - Review trace files: `npx playwright show-trace trace.zip`
   - Check network logs for API issues

---

**Document Version:** 1.2 (Phase 1 Complete)  
**Last Updated:** January 2025  
**Status:** Phase 1 ✅ Complete | Phase 2+ Ready for Implementation


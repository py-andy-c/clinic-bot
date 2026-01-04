# E2E Tests

This directory contains end-to-end tests using Playwright.

## Structure

- `smoke/` - Critical smoke tests (run first)
- `appointments/` - Appointment-related tests
- `settings/` - Settings tests
- `calendar/` - Calendar tests
- `fixtures/` - Shared fixtures (auth, database, etc.)
- `helpers/` - Test helpers (API helpers, database helpers)

## Running Tests

### Quick Start

```bash
# Run E2E tests
./run_e2e_tests.sh

# Run full test suite (same as default)
./run_e2e_tests.sh --all

# Run with UI mode (headed browser)
./run_e2e_tests.sh --ui
```

### Manual Playwright Commands

```bash
# Run all tests
npx playwright test

# Run only changed tests (incremental testing)
npx playwright test --only-changed

# Run specific test file
npx playwright test tests/e2e/smoke/app-availability.spec.ts

# Run tests with specific tag
npx playwright test --grep @smoke

# Run in UI mode
npx playwright test --ui

# Show test report
npx playwright show-report
```

## Environment Setup

1. Copy `.env.e2e.example` to `.env.e2e`:
   ```bash
   cp .env.e2e.example .env.e2e
   ```

2. Update `.env.e2e` with your actual database credentials and configuration.

3. Ensure the test database exists:
   ```bash
   createdb clinic_bot_e2e
   ```

4. Run migrations (handled automatically by Playwright webServer, but can be run manually):
   ```bash
   cd backend
   DATABASE_URL=postgresql://user:password@localhost/clinic_bot_e2e alembic upgrade head
   ```

## Test Isolation

Tests use unique data with cleanup to ensure isolation. Each test:
- Creates data with unique identifiers (timestamps, UUIDs)
- Cleans up test-specific data in `afterEach` hooks
- Does not share state with other tests

## Authentication

E2E tests use a test-only authentication endpoint that bypasses OAuth for faster test execution.

**Default Behavior:**
- All tests run as `clinic_user` with roles `['admin', 'practitioner']` (full access)
- Email can be configured via `E2E_TEST_EMAIL` environment variable (default: `test@example.com`)

**Future: Role-Based Testing**
When testing role-based access control is needed, the fixture can be extended to support per-test roles. For example:
- Test admin-only functionality
- Test practitioner-only functionality
- Test access restrictions

## Writing Tests

See the design document for best practices:
- Use `data-testid` attributes for stable selectors
- Use Playwright's auto-waiting (avoid fixed delays)
- Mock external services (LINE API, OAuth)
- Keep tests independent and parallelizable

## Troubleshooting

See the design document's troubleshooting section for common issues:
- Server startup problems
- Database connection issues
- Flaky test detection


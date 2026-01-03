# E2E Test Implementation: Lessons Learned

**Date:** 2026-01-03  
**Context:** Pre-reimplementation summary of issues and learnings from initial E2E test implementation

## Executive Summary

This document summarizes critical issues and learnings from the initial E2E test implementation (commits since `00f3c1b`). The test suite will be re-implemented, and these learnings should guide the new implementation.

## Key Issues Encountered

### 1. Configuration & Environment Issues

**Problem:** API requests failing due to environment misconfiguration
- `.env` file contained ngrok URL (`https://clinic-bot-api.ngrok.io/api`)
- E2E tests need localhost (`http://localhost:8000/api`)
- CORS configuration didn't allow requests from test port (`http://localhost:3000`)

**Impact:** 
- Tests timing out (10s+)
- All API requests failing with `ERR_NETWORK`
- Tests "passing" but not actually testing functionality (early exit on error)

**Learning:**
- E2E test environment must be isolated from development environment
- Environment variables must be explicitly set for test execution
- CORS configuration must include test ports
- Tests should fail fast when configuration is wrong (not silently pass)

### 2. Test Data Management

**Problem:** No test data isolation or cleanup
- Tests created data with unique IDs but never cleaned up
- Database state persisted across test runs
- Tests shared a single clinic, limiting test scenarios
- No way to test multi-clinic scenarios (e.g., clinic switching)

**Impact:**
- Data accumulation over time
- Test interdependencies
- Flaky tests due to state pollution
- Limited test coverage (can't test clinic switching without multiple clinics)

**Learning:**
- Implement test data factories for programmatic data creation
- Add automatic cleanup in `afterEach` hooks
- Use test-only API endpoints for efficient data setup
- Ensure each test can create its own isolated test data
- Consider database transactions for perfect isolation (if feasible)

### 3. Test Isolation & State Pollution

**Problem:** Tests affecting each other's state
- Browser state (localStorage, sessionStorage, cookies) persisted between tests
- React Query cache persisted between tests
- Component state from previous tests affected subsequent tests
- Tests passed individually but failed in full suite

**Impact:**
- `clinic-switching` tests failed when run after other tests
- `aria-expanded` attribute not updating due to stale component state
- Tests timing out in parallel execution

**Learning:**
- Always clear browser state in `beforeEach` hooks
- Clear React Query cache (indexedDB) between tests
- Use separate browser contexts per test (Playwright default, but verify)
- Test isolation is critical for parallel execution
- Serial mode (`test.describe.configure({ mode: 'serial' })`) helps but doesn't solve root cause

### 4. Parallel Execution Issues

**Problem:** Tests failing in parallel but passing individually
- React component state not updating in parallel execution
- Resource contention (backend/frontend servers)
- Tests hanging on `waitForFunction` calls
- 2 workers slower than 1 worker

**Impact:**
- Full test suite timing out
- Some tests hanging indefinitely
- Performance degradation with parallel execution

**Learning:**
- `fullyParallel: false` runs tests serially within each browser project
- Parallel across browsers, serial within each browser is the right pattern
- React state updates can be delayed in parallel execution
- Need better wait strategies (`waitForFunction` vs direct checks)
- Consider increasing timeouts for parallel execution
- Test-specific issues (e.g., user only has one clinic) can cause failures

### 5. Server Lifecycle Management

**Problem:** Stuck backend processes causing test hangs
- Playwright's `reuseExistingServer` checks if server is running
- If process is bound to port but not responding, health check hangs indefinitely
- No cleanup before test execution

**Impact:**
- Tests hanging before execution starts
- Manual intervention required (kill processes)
- Unreliable test runs

**Learning:**
- Use npm pre-scripts (`pretest:e2e`) for cleanup before Playwright initializes
- Kill processes bound to ports before health checks
- Use `lsof + kill` for reliable process cleanup
- Wait for kill commands to complete (not fire-and-forget)
- `reuseExistingServer: true` is efficient but requires clean ports

### 6. Wait Strategies & Timeouts

**Problem:** Inconsistent wait strategies causing hangs
- `waitForFunction` sometimes blocking indefinitely
- Timeouts too long (10s+) or too short for CI
- Waiting for wrong conditions (error states vs success states)

**Impact:**
- Tests hanging on wait conditions
- Tests timing out in CI but passing locally
- Tests passing despite failures (lenient fallback logic)

**Learning:**
- Prefer direct checks (`page.textContent()`, `page.locator().count()`) over `waitForFunction`
- Use environment-aware timeouts (shorter for local, longer for CI)
- Wait for API responses before checking UI state
- Wait for loading spinners to disappear
- Fail fast on error states (don't silently continue)

### 7. Validation & Schema Mismatches

**Problem:** Backend returning `null` for optional fields, frontend expecting `undefined`
- Zod `.optional()` allows `undefined` but not `null`
- Backend Pydantic serializes `None` to JSON `null`
- Validation failures causing React Query retries

**Impact:**
- Unnecessary retries (1s delay per retry)
- Test slowness
- Validation errors in logs

**Learning:**
- Use `response_model_exclude_none=True` in FastAPI to omit `None` values
- Align frontend and backend expectations (undefined vs null)
- Test validation schemas match between frontend and backend
- React Query retries on validation errors (expected behavior, but should be avoided)

## Critical Learnings

### 1. Test Environment Isolation
- **Must:** Separate test environment from development
- **Must:** Explicitly configure environment variables for tests
- **Must:** Verify configuration before test execution
- **Must:** Fail fast on configuration errors

### 2. Test Data Strategy
- **Must:** Implement test data factories
- **Must:** Add automatic cleanup (`afterEach` hooks)
- **Must:** Support test-only API endpoints for efficient setup
- **Should:** Consider database transactions for perfect isolation
- **Should:** Use unique identifiers to avoid conflicts

### 3. Test Isolation
- **Must:** Clear browser state (`localStorage`, `sessionStorage`, cookies) in `beforeEach`
- **Must:** Clear React Query cache (indexedDB) between tests
- **Should:** Verify browser context isolation
- **Should:** Use serial mode for problematic tests if needed

### 4. Parallel Execution
- **Should:** Use `fullyParallel: false` (serial within browser, parallel across browsers)
- **Should:** Add `test.describe.configure({ mode: 'serial' })` for problematic files
- **Should:** Use better wait strategies for React state updates
- **Should:** Increase timeouts for parallel execution if needed

### 5. Server Management
- **Must:** Clean up ports before Playwright initializes (npm pre-scripts)
- **Must:** Wait for kill commands to complete
- **Should:** Use `reuseExistingServer: true` for performance (with cleanup)
- **Should:** Verify ports are free after cleanup

### 6. Wait Strategies
- **Prefer:** Direct checks over `waitForFunction`
- **Prefer:** Wait for API responses before UI checks
- **Prefer:** Environment-aware timeouts
- **Avoid:** Lenient fallback logic that masks failures

### 7. Schema Alignment
- **Must:** Align frontend and backend validation schemas
- **Should:** Use `response_model_exclude_none=True` in FastAPI
- **Should:** Test validation schemas match

## Recommendations for Re-implementation

### 1. Configuration
- Create separate test environment configuration
- Explicitly set all environment variables in `playwright.config.ts`
- Add health checks that verify configuration before tests
- Fail fast on configuration errors

### 2. Test Data
- Implement test data factories from the start
- Add `afterEach` cleanup hooks automatically
- Create test-only API endpoints for efficient data setup
- Consider database transactions for isolation

### 3. Test Isolation
- Always clear browser state in `beforeEach` (centralized helper)
- Always clear React Query cache
- Verify browser context isolation
- Use serial mode only when necessary

### 4. Server Management
- Implement port cleanup in npm pre-scripts
- Wait for cleanup to complete
- Verify ports are free
- Use `reuseExistingServer: true` with proper cleanup

### 5. Wait Strategies
- Use direct checks instead of `waitForFunction`
- Wait for API responses before UI checks
- Use environment-aware timeouts
- Fail fast on errors

### 6. Schema Alignment
- Align frontend and backend schemas from the start
- Use `response_model_exclude_none=True` in FastAPI
- Test validation schemas match

## Performance Targets

**Current State (After Fixes):**
- Single test: ~1.3-2.7 seconds
- Full suite (1 worker): ~58 seconds
- Full suite (2 workers): Timeouts/hangs

**Target for Re-implementation:**
- Single test: <2 seconds
- Full suite (1 worker): <60 seconds
- Full suite (2 workers): <40 seconds (with proper isolation)

## Files to Reference

- **Analysis Document:** `docs/workspace/56e630dd-256d-499e-91b3-2af0eaad75e7_analysis.md`
- **Test Data Best Practices:** `docs/workspace/E2E_TEST_DATA_BEST_PRACTICES.md`
- **Test Isolation Best Practices:** `docs/workspace/E2E_TEST_DATA_ISOLATION_BEST_PRACTICES.md`
- **Test Data Sources:** `docs/workspace/E2E_TEST_DATA_SOURCES.md`

## Key Commits Reference

- `00f3c1b` - Initial E2E test implementation
- `d69c8fe` - Test isolation fixes
- `a232118` - React Query migration
- `4e4edc6` - Test data factories implementation


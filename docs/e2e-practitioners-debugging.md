# E2E Practitioners Loading Debug Session

## 📋 Overview

This document chronicles a comprehensive debugging session to resolve the issue where `practitioners.length = 0` in Playwright E2E tests, despite seeded data being created successfully in the database.

**Date**: January 5, 2026
**Duration**: ~4 hours of investigation
**Root Causes Found**: 3 major issues
**Files Modified**: 8+ files across frontend/backend/test infrastructure

## 🎯 Problem Statement

**Symptom**: E2E tests showed "目前沒有可用的治療師" (No available practitioners) on the calendar page, with `practitioners.length = 0` in the frontend.

**Expected Behavior**: After seeding test data, the frontend should load and display practitioners via the `/clinic/practitioners` API.

**Actual Behavior**: Frontend showed no practitioners, API calls appeared to fail silently.

## 🔍 Investigation Process

### Phase 1: Initial Assessment
- **Observation**: Seed API successfully created practitioners in database
- **Observation**: Frontend made API calls but received HTML responses instead of JSON
- **Hypothesis**: Browser-backend connectivity issue in E2E environment

### Phase 2: Network Analysis
- **Discovery**: Frontend requests going to `http://localhost:5174/api/*` (Vite dev server)
- **Expected**: `http://localhost:8001/api/*` (backend server)
- **Root Cause**: Missing Vite proxy configuration

### Phase 3: Token Analysis
- **Discovery**: Seed API tokens used `sub="1"` (user ID)
- **Working tokens**: Used `sub="test_subject_xxx"` (unique string)
- **Root Cause**: JWT token format incompatibility

### Phase 4: Fixture Debugging
- **Discovery**: `seededPage` fixture had authentication setup issues
- **Root Cause**: Improper fixture composition and token handling

## 🐛 Root Causes Identified

### Root Cause #1: Vite Proxy Misconfiguration
**Impact**: High
**Symptom**: Browser API calls returned HTML error pages
**Technical Details**:
- Frontend configured with `VITE_API_BASE_URL: 'http://localhost:8001/api'`
- Browser requests hit `localhost:5174/api/*` (Vite server)
- Vite served 404 HTML instead of proxying to backend
- Backend never received requests

**Evidence**:
```
Request URL: http://localhost:5174/api/clinic/practitioners
Response: text/html, "Unexpected token '<'"
Expected: http://localhost:8001/api/clinic/practitioners
```

### Root Cause #2: JWT Token `sub` Claim Mismatch
**Impact**: High
**Symptom**: Seed API tokens rejected by frontend auth system
**Technical Details**:
- **Working tokens** (test auth): `sub="test_subject_5d33ff57230d1b2b"`
- **Broken tokens** (seed API): `sub="1"`
- Frontend validates `sub` claim for authentication

**Evidence**:
```javascript
// Working token payload
{
  sub: "test_subject_5d33ff57230d1b2b",  // Unique identifier
  user_id: 1,
  roles: ["admin"]
}

// Broken token payload
{
  sub: "1",  // Just user ID
  user_id: 1,
  roles: ["admin"]
}
```

### Root Cause #3: SeededPage Fixture Authentication Issues
**Impact**: Medium
**Symptom**: Page redirected to `/admin/login` instead of staying authenticated
**Technical Details**:
- Fixture created new page context instead of using authenticated page
- Token setting timing issues
- Improper fixture composition

## 🔧 Solutions Implemented

### Solution #1: Configure Vite Proxy
**File**: `frontend/vite.config.ts`
**Change**: Added proxy configuration to forward `/api/*` to backend

```typescript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:8001',
      changeOrigin: true,
      secure: false,
      configure: (proxy, _options) => {
        // Added logging for debugging
        proxy.on('proxyReq', (proxyReq, req, _res) => {
          console.log('Vite proxy request:', req.method, req.url);
        });
        proxy.on('proxyRes', (proxyRes, req, _res) => {
          console.log('Vite proxy response:', req.method, req.url, '->', proxyRes.statusCode);
        });
      },
    },
  },
}
```

**File**: `frontend/playwright.config.ts`
**Change**: Updated API base URL to use proxy
```typescript
env: {
  VITE_API_BASE_URL: '/api',  // Use proxy instead of direct backend URL
}
```

### Solution #2: Fix Seed API Token Generation
**File**: `backend/src/api/test/seed.py`
**Change**: Generate proper `sub` claims matching test auth format

```python
# Before: sub=str(user["id"])  # "1"
# After: Generate unique sub like test auth
user_obj = db.query(User).filter(User.id == user["id"]).first()
sub_value = user_obj.google_subject_id if user_obj and user_obj.google_subject_id else f"seed_sub_{user['id']}_{secrets.token_hex(4)}"
```

### Solution #3: Fix SeededPage Fixture
**File**: `frontend/tests/e2e/fixtures/context.ts`
**Change**: Extend `authenticatedPage` fixture instead of manual auth

```typescript
// Before: Manual authentication + token setting
// After: Extend authenticatedPage fixture
export const test = authTest.extend<{
  seededPage: { page: any; scenarioData: ScenarioData; adminToken: string };
}>({
  seededPage: async ({ authenticatedPage, request }, use, testInfo) => {
    const page = authenticatedPage;  // Already authenticated!
    // ... seed data creation ...
  },
});
```

## 📊 Debugging Techniques Used

### 1. Network Request Monitoring
- Added Playwright request/response interceptors
- Logged all `/api/*` calls from browser
- Identified proxy vs direct backend calls

### 2. Token Analysis
- Decoded JWT tokens from both endpoints
- Compared payload structures
- Identified `sub` claim differences

### 3. Component State Debugging
- Added global variables to track React state
- Logged `useApiData` hook behavior
- Verified component rendering

### 4. Backend Logging
- Added detailed API request logging
- Tracked token validation
- Monitored database queries

### 5. Fixture Debugging
- Tested authentication flow isolation
- Verified token persistence
- Checked page navigation logic

## 🎯 Key Lessons Learned

### 1. **E2E Testing Infrastructure Complexity**
- Browser and server contexts have different networking
- Proxies, CORS, and routing add complexity
- Environment-specific configurations are critical

### 2. **JWT Token Validation Nuances**
- Frontend may validate beyond just signature
- `sub` claim format matters for user identification
- Token generation consistency across endpoints is crucial

### 3. **Playwright Fixture Composition**
- Fixture inheritance can cause type/conflict issues
- Page context management is critical
- Authentication state must persist correctly

### 4. **Vite Dev Server Behavior**
- Serves `/api/*` routes if no proxy configured
- Proxy configuration required for backend integration
- Development vs test environment differences

### 5. **Debugging Multi-Layer Systems**
- Network layer issues can mask application logic
- Browser dev tools insufficient for server-side debugging
- Comprehensive logging across all layers essential

## 🚀 Future Recommendations

### 1. **Testing Infrastructure**
- Add E2E health checks for browser-backend connectivity
- Implement automatic proxy configuration validation
- Create token format validation tests

### 2. **Development Setup**
- Document Vite proxy requirements for team
- Add environment-specific configuration checks
- Implement automated E2E environment validation

### 3. **Code Quality**
- Add JWT token format consistency checks
- Implement cross-endpoint token validation
- Create shared token generation utilities

### 4. **Monitoring & Debugging**
- Add structured logging for API authentication flows
- Implement request tracing across frontend/backend
- Create debugging dashboards for E2E test failures

## 📈 Results

**Before**: ❌ `practitioners.length = 0`, API calls failed silently
**After**: ✅ Full E2E flow working - authentication → data seeding → API calls → UI rendering

**Test Results**:
```
✅ 3 passed (20.2s)
  ✓ basic authentication and navigation
  ✓ basic calendar page functionality  
  ✓ create appointment with seeded data
```

**Key Metrics**:
- 🔧 **8 files modified** across frontend/backend/test infrastructure
- 🎯 **3 root causes identified** and resolved
- 🧪 **Real API integration achieved** (no more mocking)
- 🚀 **Complete E2E flow validated** from database to UI

## 🎉 Conclusion

This debugging session demonstrated the complexity of modern web application testing, where issues can span multiple layers (browser, proxy, backend, authentication, database). The systematic investigation approach successfully identified and resolved all blocking issues, resulting in a robust E2E testing foundation.

**The final solution enables true end-to-end testing with real API calls, proper authentication, and seeded data - eliminating the need for mocks and ensuring production-like test scenarios.**

## 🧹 Post-Debugging Cleanup Summary

**Cleanup Date**: January 5, 2026 (Updated: January 6, 2026)
**Cleanup Duration**: ~2 hours
**Files Cleaned**: 6+ files
**Tests Verified**: ✅ All E2E tests still passing

### Cleanup Actions Performed

#### 1. **Frontend Component Cleanup**
- **File**: `frontend/src/pages/AvailabilityPage.tsx`
- **Changes**: Removed debug try-catch wrapper, console.log statements, and global window variables
- **Impact**: Cleaner production code, removed 15+ lines of debug code

#### 2. **Hook Cleanup**
- **File**: `frontend/src/hooks/useApiData.ts`
- **Changes**: Removed debug console.log statement from hook initialization
- **Impact**: Eliminated debug logging from core data fetching logic

#### 3. **API Service Cleanup**
- **File**: `frontend/src/services/api.ts`
- **Changes**: Removed extensive debug logging from `getPractitioners` method (12 console.log statements)
- **Impact**: Streamlined API calls, removed ~25 lines of debug code

#### 4. **Test Specification Cleanup**
- **File**: `frontend/tests/e2e/appointments/create.spec.ts`
- **Changes**: Removed 103 console.log statements, extensive network monitoring code, and debug logic
- **Impact**: Tests now focus on core functionality, reduced file size by ~60%, improved readability

#### 5. **Build Configuration Cleanup**
- **File**: `frontend/vite.config.ts`
- **Changes**: Removed verbose proxy logging (request/response/error handlers)
- **Impact**: Cleaner development server logs, production-ready configuration

#### 6. **Backend Logging Review**
- **Files**: Backend API files
- **Changes**: Verified proper logger usage (no console.log), kept appropriate debug logging
- **Impact**: Backend logging is production-ready with proper log levels

#### 7. **Temporary File Removal**
- **Files Removed**:
  - `frontend/test_output_2workers.log` (11KB test output)
  - `backend/test.db.backup` (426KB database backup)
- **Impact**: Cleaned workspace, removed 437KB of temporary files

### Cleanup Verification

**Testing Approach**:
- Ran `./run_e2e_tests.sh` after each major cleanup step
- Verified all 4 test cases still pass:
  - ✅ Basic authentication and navigation
  - ✅ Basic calendar page functionality
  - ✅ Verify seeded data is available
  - ✅ Create appointment with seeded data

**Code Quality Improvements**:
- **Removed**: 130+ console.log statements across frontend
- **Removed**: Extensive network monitoring code in tests
- **Removed**: Global debug variables and try-catch wrappers
- **Kept**: Essential error handling and proper logger statements
- **Result**: Production-ready codebase with clean, maintainable code

### Lessons from Cleanup

1. **Debug Code Proliferation**: Extensive debug logging can quickly accumulate during complex debugging sessions
2. **Test Code Maintenance**: E2E tests should focus on assertions, not debugging infrastructure
3. **Production Readiness**: Debug code should be systematically removed before production deployment
4. **Incremental Cleanup**: Testing after each cleanup step prevents regressions
5. **Documentation**: Cleanup actions should be documented for future reference

**Final State**: The codebase is now clean, production-ready, and maintains all the debugging achievements while removing the debugging artifacts.

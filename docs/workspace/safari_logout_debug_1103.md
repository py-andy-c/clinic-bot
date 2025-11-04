# Safari Logout Issue - Debug Summary (2025-11-03)

## Context

**Issue**: Users are logged out unexpectedly on iPhone Safari browser after roughly one hour after initial login.

**Environment**:
- `JWT_ACCESS_TOKEN_EXPIRE_MINUTES=60` (1 hour)
- `JWT_REFRESH_TOKEN_EXPIRE_DAYS=180` (6 months)
- Frontend: `clinic-bot-frontend.ngrok.io`
- Backend API: `clinic-bot-api.ngrok.io`
- Browser: iPhone Safari (iOS 18.7)

**Initial Hypothesis**: Race condition with refresh token rotation causing concurrent refresh attempts to fail.

## Debugging Method

To reproduce the issue faster, we set `JWT_ACCESS_TOKEN_EXPIRE_MINUTES=1` (1 minute instead of 60 minutes) and tested various scenarios.

## Test Scenarios and Outcomes

### Scenario 1: Tab Stays Active ✅
**Setup**: Login → Stay on page without switching tabs

**Behavior**:
- Proactive refresh runs every 30 seconds
- Token is refreshed before expiry
- User stays logged in indefinitely (tested for 3+ minutes)
- Navigation works perfectly

**Logs**:
```
Every 30 seconds:
- Refresh token request received - source: body
- Token refresh successful
- GET /api/auth/verify HTTP/1.1" 200 OK
- GET /api/clinic/settings HTTP/1.1" 200 OK
```

**Conclusion**: Refresh mechanism works correctly when tab is active.

---

### Scenario 2: Tab Background (~40 seconds) ❌
**Setup**: Login → Switch to other apps → Return after ~40 seconds

**Behavior**:
- No token refresh logs while tab is in background
- When returning to Safari:
  - Refresh token request received - source: body
  - Token refresh successful (200 OK)
  - **BUT**: User is logged out on UI

**Logs**:
```
[15:41:59] Refresh token request received - source: body
[15:42:00] Token refresh successful - user: andy_chen@berkeley.edu
[15:42:00] POST /api/auth/refresh HTTP/1.1" 200 OK
```

**Key Observation**: Refresh succeeds, but user appears logged out.

---

### Scenario 3: Tab Background (~70 seconds) ❌
**Setup**: Login → Switch to other apps → Return after ~70 seconds

**Behavior**:
- No token refresh logs while tab is in background
- When returning to Safari:
  - Refresh token request received - source: body
  - Token refresh successful (200 OK)
  - **BUT**: User is logged out on UI

**Logs**: Same pattern as Scenario 2

**Key Observation**: Refresh succeeds, but user appears logged out.

---

### Scenario 4: Tab Background (2+ minutes) ❌
**Setup**: Login → Switch to other apps → Return after 2+ minutes

**Behavior**:
- No token refresh logs while tab is in background
- When returning to Safari:
  - **401 Unauthorized** on API call
  - Then refresh token request received
  - Token refresh successful (200 OK)
  - **BUT**: User is logged out on UI

**Logs**:
```
[15:56:44] GET /api/clinic/settings HTTP/1.1" 401 Unauthorized  ← API call with expired token
[15:56:44] Refresh token request received - source: body
[15:56:44] Token refresh successful - user: andy_chen@berkeley.edu
[15:56:44] POST /api/auth/refresh HTTP/1.1" 200 OK
```

**Key Observation**: 
- 401 appears BEFORE refresh completes (race condition)
- Refresh succeeds, but user still appears logged out

---

## Analysis

### Primary Issue: Race Condition Between Auth Check and Component Mounting

When Safari resumes a background tab:

1. **`useAuth` hook mounts** → `checkAuthStatus()` starts (async)
2. **React continues rendering** → Components mount immediately
3. **`ClinicLayout` mounts** → `fetchWarnings()` starts (makes API calls immediately)
4. **Both run in parallel**:
   - `checkAuthStatus()` → `refreshToken()` (async)
   - `fetchWarnings()` → API calls (async)

**The Race Condition:**
- If `fetchWarnings()` completes before `refreshToken()` completes → API calls use expired token → 401 ❌
- If `refreshToken()` completes before `fetchWarnings()` starts → API calls use fresh token → no 401 ✅

### Why Scenario 4 Shows 401 But Scenarios 2 & 3 Don't

**Scenarios 2 (40s) & 3 (70s):**
- Token expired recently
- `refreshToken()` completes quickly (network/backend is fast)
- `fetchWarnings()` API calls happen AFTER refresh completes
- API calls use fresh token → no 401 ✅

**Scenario 4 (2+ min):**
- Token expired longer ago
- After being in background longer, Safari may:
  - Initialize/render components faster
  - OR network/refresh is slower
- `fetchWarnings()` API calls happen BEFORE refresh completes
- API calls use expired token → 401 ❌
- Then refresh completes → but 401 already happened

### Secondary Issue: React State Loss on Tab Resume

Even when refresh succeeds, the user appears logged out. This suggests:

1. **React state resets** when Safari resumes the tab
2. **Components mount with initial state**: `{ isAuthenticated: false, isLoading: true }`
3. **Refresh succeeds** → `setAuthState()` is called
4. **But UI already rendered** as logged out, or state update doesn't take effect due to React re-initialization timing

### Why Safari Background Tabs Behave Differently

Safari aggressively pauses JavaScript execution when tabs are in background:
- `setInterval` stops (proactive refresh doesn't run)
- JavaScript execution is throttled/paused
- When tab resumes, React may re-initialize, causing state loss

### localStorage is Working Correctly ✅

Evidence:
- Tokens are stored correctly in localStorage
- Refresh tokens persist across tab switches
- Backend refresh succeeds (200 OK)
- Tokens are retrieved correctly from localStorage

The issue is **not** with localStorage or token storage - it's with React state management and timing.

---

## Proposed Fix

### Fix 1: Prevent Components from Making API Calls Until Auth is Verified

**Problem**: Components mount and make API calls before `checkAuthStatus()` completes.

**Solution**: Components should wait for `isLoading === false` before making API calls.

**Implementation**:
```typescript
// In ClinicLayout.tsx or any component that makes API calls
const { isLoading } = useAuth();

useEffect(() => {
  // Wait for auth to complete before fetching data
  if (!isLoading && user) {
    fetchWarnings();
  }
}, [isLoading, user, fetchWarnings]);
```

**Location**: `frontend/src/components/ClinicLayout.tsx` - `fetchWarnings()` useEffect

---

### Fix 2: Handle Page Visibility Changes

**Problem**: When tab becomes visible, auth state may be lost.

**Solution**: Listen for visibility changes and re-check auth state.

**Implementation**:
```typescript
// In useAuth.tsx
useEffect(() => {
  const handleVisibilityChange = () => {
    if (!document.hidden) {
      // Tab became visible - re-check auth state
      const token = localStorage.getItem('access_token');
      const wasLoggedIn = localStorage.getItem('was_logged_in') === 'true';
      
      if (token || wasLoggedIn) {
        // User was logged in, verify state
        checkAuthStatus();
      }
    }
  };
  
  document.addEventListener('visibilitychange', handleVisibilityChange);
  return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
}, [checkAuthStatus]);
```

**Location**: `frontend/src/hooks/useAuth.tsx`

---

### Fix 3: Ensure State Update After Refresh Completes

**Problem**: `setAuthState()` might not update UI if component unmounted/remounted.

**Solution**: Verify state update happens and add logging to track it.

**Implementation**:
```typescript
// In useAuth.tsx refreshToken() function
if (userResponse.ok) {
  const userData = await userResponse.json();
  localStorage.setItem('was_logged_in', 'true');
  
  // Ensure state update
  setAuthState({
    user: userData,
    isAuthenticated: true,
    isLoading: false,
  });
  
  logger.log('Token refresh successful, user authenticated', {
    user: userData.email,
    isAuthenticated: true,
    timestamp: new Date().toISOString()
  });
}
```

**Location**: `frontend/src/hooks/useAuth.tsx` - `refreshToken()` function

---

## Code Locations

### Files to Modify:

1. **`frontend/src/hooks/useAuth.tsx`**
   - Add visibility change handler (Fix 2)
   - Ensure state update after refresh (Fix 3)
   - Add logging for state updates

2. **`frontend/src/components/ClinicLayout.tsx`**
   - Modify `fetchWarnings()` useEffect to wait for `isLoading === false` (Fix 1)

3. **Other components that make API calls on mount**
   - Check if they wait for `isLoading === false`
   - Examples: `MembersPage`, `SettingsPage`, `AvailabilityPage`, etc.

---

## Testing Plan

After implementing fixes:

1. **Test Scenario 1**: Tab stays active → Should still work ✅
2. **Test Scenario 2**: Tab background ~40s → Should NOT log out ✅
3. **Test Scenario 3**: Tab background ~70s → Should NOT log out ✅
4. **Test Scenario 4**: Tab background 2+ min → Should NOT log out, no 401 ✅

### Verification Steps:

1. Login → Switch tabs → Return after various intervals
2. Verify no 401 errors appear
3. Verify user stays logged in
4. Verify API calls succeed
5. Check browser console for state update logs

---

## Additional Notes

### Why This Affects Safari More Than Other Browsers

Safari aggressively pauses JavaScript execution in background tabs:
- More aggressive than Chrome/Firefox
- Can cause React components to unmount/remount
- May cause state loss that other browsers don't experience

### localStorage Fallback is Working ✅

The initial hypothesis about localStorage fallback was incorrect. localStorage is working correctly:
- Tokens persist across tab switches
- Refresh tokens are stored and retrieved correctly
- Backend refresh succeeds

The issue is purely with React state management and timing.

### Not a Race Condition with Refresh Token Rotation

The initial hypothesis about concurrent refresh attempts causing token revocation was incorrect. The logs show:
- Refresh succeeds consistently
- No evidence of multiple refresh attempts using same token
- The `_refresh_in_progress` flag is working correctly

---

## Summary

**Root Cause**: Race condition between auth check and component mounting, combined with React state loss on tab resume.

**Primary Fix**: Prevent components from making API calls until auth verification completes (`isLoading === false`).

**Secondary Fix**: Handle page visibility changes to re-check auth state when tab becomes visible.

**Expected Outcome**: Users should stay logged in when returning to Safari tabs, regardless of how long the tab was in background.

---

## Root Cause Analysis (Final)

### The Real Problem

After extensive debugging and multiple iterations, the root cause was identified:

**When Safari ITP blocks cookies (cross-origin ngrok domains) AND CORS blocks the response body:**

1. **Backend refreshes successfully** (200 OK) and rotates the refresh token
   - Old refresh token is revoked
   - New refresh token is created
   - Cookie is set (but Safari won't accept it due to ITP)

2. **CORS blocks the response body**, so the frontend can't read the new tokens
   - The response status is 200 OK (backend succeeded)
   - But the response body is blocked by CORS
   - Frontend never receives the new `access_token` or `refresh_token`

3. **Frontend still has the old refresh token** in localStorage
   - But the old token was revoked by the backend
   - Frontend tries to retry with the old revoked token → fails with 401

4. **Result**: User is logged out even though the refresh succeeded

### Why This Happens

- **Safari ITP**: Blocks third-party cookies from different domains (e.g., `clinic-bot-frontend.ngrok.io` vs `clinic-bot-api.ngrok.io`)
- **CORS**: When Safari blocks cookies, the refresh token comes from the request body (not cookie). If CORS misconfiguration blocks the response body, the frontend can't read the new tokens.
- **Token Rotation**: The backend always rotated the refresh token, even when cookies weren't working, making retry impossible.

### The Fix

**Backend Change** (`backend/src/api/auth.py`):

Only rotate the refresh token when cookies are working. If cookies are NOT working (token comes from body, not cookie), reuse the same refresh token to allow retry if CORS blocks the response.

```python
# IMPORTANT: Only rotate refresh token if cookies are working
# If token comes from body (not cookie), it means Safari ITP is blocking cookies
# In this case, if CORS blocks the response, frontend can't read new tokens
# So we reuse the same refresh token to allow retry
if token_source == "cookie":
    # Cookies are working - safe to rotate (frontend can use cookie for retry)
    # Revoke old refresh token and create new one
    refresh_token_record.revoke()
    new_refresh_token_record = RefreshToken(...)
    db.add(new_refresh_token_record)
    db.commit()
    set_refresh_token_cookie(response, request, token_data["refresh_token"])
else:
    # Cookies are NOT working (Safari ITP blocking) - don't rotate yet
    # Reuse the same refresh token in response so frontend can retry if CORS blocks
    token_data["refresh_token"] = refresh_token  # Reuse existing token
    # Don't revoke old token - frontend needs it for retry
```

**Frontend Changes** (`frontend/src/hooks/useAuth.tsx`):

1. **Promise-based locking** to prevent concurrent refresh attempts
2. **CORS error recovery**: When CORS blocks the response, check if cookie was set and retry using cookie
3. **Token rotation race condition handling**: Detect "token not found" errors and recover by checking for new tokens from concurrent refreshes

**Additional Improvements**:

- Reduced console noise by silently handling expected network/CORS errors during recovery
- Enhanced error handling in `ClinicLayout.tsx` to suppress expected network errors during auth recovery

### Why This Works

1. **When cookies are working**: Token rotation works normally - frontend can use cookie for retry if needed
2. **When cookies are NOT working**: Token is NOT rotated, so if CORS blocks the response:
   - Frontend still has a valid refresh token (not revoked)
   - Frontend can retry the refresh
   - Eventually, if CORS is resolved or retry succeeds, user stays logged in

### Testing Results

After implementing the fix:
- ✅ **Scenario 1**: Tab stays active → Still works
- ✅ **Scenario 2**: Tab background ~40s → No longer logs out
- ✅ **Scenario 3**: Tab background ~70s → No longer logs out
- ✅ **Scenario 4**: Tab background 2+ min → No longer logs out

### Expected Console Errors

After the fix, some console errors may still appear during recovery:
- CORS errors during initial refresh attempt (expected)
- 401 errors from API calls before refresh completes (expected)
- Network errors during recovery (expected)

These errors are **transient** and **expected** during the recovery process. The important thing is that the user **stays logged in** despite these errors.

---

## Summary

**Root Cause**: When Safari ITP blocks cookies AND CORS blocks the response body, the frontend can't read new tokens after refresh, but the backend has already rotated the token, making retry impossible.

**Solution**: Only rotate refresh tokens when cookies are working. When cookies don't work, reuse the same refresh token to allow retry if CORS blocks the response.

**Result**: Users stay logged in when returning to Safari tabs, regardless of how long the tab was in background.


# LIFF Appointment Booking Authentication Issue Analysis

## Issue Summary

When a patient attempts to make an appointment from the rich menu for the first time, they are prompted to enter their name and phone number. After successful registration, instead of being redirected to the appointment making page, they see the error: "診所ID無效，請從診所的LINE官方帳號進入" (Clinic ID invalid, please enter from the clinic's LINE official account).

**Severity**: CRITICAL - Blocks first-time users from completing appointment booking
**Affected Users**: All first-time patients attempting to book appointments via rich menu
**Workaround**: None - users cannot proceed past registration

## Root Cause Analysis (Team Consensus)

### Flow Sequence

1. **Initial Access**: User clicks rich menu link with URL containing `clinic_id` parameter (e.g., `?clinic_id=123`)
2. **First Authentication**: `useLineAuth` extracts clinic_id from URL, backend returns `is_first_time=true`
3. **Registration**: User enters name/phone, `FirstTimeRegister` creates patient record successfully
4. **URL Update**: Code changes URL to `?mode=book`, **losing `clinic_id` parameter**
5. **Page Reload**: `auth-refresh` event triggers `window.location.reload()`
6. **Authentication Failure**: `getClinicIdFromUrl()` returns null, authentication fails

### Primary Bug Location

**File**: `frontend/src/liff/auth/FirstTimeRegister.tsx`
**Lines**: 52-53

```typescript
// PROBLEM: This removes clinic_id parameter
const newUrl = `${window.location.pathname}?mode=book`;
window.history.replaceState(null, '', newUrl);
```

### Authentication Failure Location

**File**: `frontend/src/hooks/useLineAuth.ts`
**Lines**: 92-95 (and 149-151)

```typescript
const clinicId = getClinicIdFromUrl();
if (!clinicId) {
  throw new Error('診所ID無效，請從診所的LINE官方帳號進入');
}
```

## Why This Happens

1. **URL Parameter Dependency**: Authentication logic requires `clinic_id` from URL parameters for initial login
2. **JWT Token Contains Clinic ID**: Backend includes `clinic_id` in JWT payload, but frontend doesn't extract it as fallback
3. **URL Parameter Loss**: Registration success flow updates URL without preserving existing parameters
4. **Forced Page Reload**: `auth-refresh` handler uses `window.location.reload()` which loses URL state

## Additional Issues Identified by Team

### Issue 1: Inconsistent Clinic ID Sources
- **URL Parameter**: Primary source used by `getClinicIdFromUrl()`
- **JWT Token**: Contains `clinic_id` in payload but never extracted as fallback
- **Appointment Store**: Set from `useLineAuth` but doesn't persist across reloads

### Issue 2: Full Page Reload on Auth Refresh
- Poor UX with complete page reload
- Loses all React state
- Unnecessary - could use state updates instead

### Issue 3: Missing URL Parameter Preservation Utilities
- No utility functions for safely updating URLs while preserving critical parameters
- Each component must manually handle parameter preservation

## Impact Assessment

- **User Experience**: Complete blockage of first-time appointment booking flow
- **Business Impact**: Failed conversions and frustrated patients
- **Technical Debt**: Fragile authentication flow dependent on URL parameters

## Comprehensive Solution Matrix

### Solution 1: Preserve Clinic ID in URL Update (RECOMMENDED - All Team Consensus)

**Approach**: Modify `FirstTimeRegister.tsx` to preserve existing URL parameters when updating the URL.

**Implementation**:
```typescript
// Get current URL params and preserve them
const urlParams = new URLSearchParams(window.location.search);
urlParams.set('mode', 'book'); // Add/update mode parameter
const newUrl = `${window.location.pathname}?${urlParams.toString()}`;
window.history.replaceState(null, '', newUrl);
```

**Pros**: ✅ Simple, maintains URL as source of truth, preserves all parameters
**Cons**: ❌ Requires careful implementation in all URL update locations

### Solution 2: JWT Token Fallback for Clinic ID

**Approach**: Decode JWT token to extract `clinic_id` when URL parameter is missing.

**Implementation**:
```typescript
// In useLineAuth.ts, when validating existing token
let clinicIdValue = getClinicIdFromUrl();
if (!clinicIdValue && token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    clinicIdValue = payload.clinic_id;
  } catch (e) {
    // JWT decode failed
  }
}
```

**Pros**: ✅ Robust fallback, leverages existing JWT data
**Cons**: ❌ More complex, requires JWT decoding logic

### Solution 3: localStorage Persistence

**Approach**: Store `clinic_id` in localStorage during authentication as backup.

**Implementation**:
- Store in localStorage on successful authentication
- Modify `getClinicIdFromUrl()` to check localStorage as fallback
- Clear on logout

**Pros**: ✅ Simple, persistent across sessions
**Cons**: ❌ Additional storage management, potential sync issues

### Solution 4: State-Based Auth Refresh (Long-term)

**Approach**: Replace `window.location.reload()` with programmatic state updates.

**Implementation**:
- Modify `auth-refresh` handler to call authentication logic directly
- Avoid full page reloads

**Pros**: ✅ Better UX, maintains state
**Cons**: ❌ Major refactoring required

### Solution 5: URL Parameter Utility Function (Preventive)

**Approach**: Create utility for safe URL parameter updates.

**Implementation**:
```typescript
export const preserveQueryParams = (
  pathname: string,
  paramsToSet: Record<string, string>,
  paramsToPreserve: string[] = ['clinic_id']
): string => {
  const urlParams = new URLSearchParams(window.location.search);

  // Preserve specified params
  paramsToPreserve.forEach(param => {
    const value = urlParams.get(param);
    if (value) urlParams.set(param, value);
  });

  // Set new params
  Object.entries(paramsToSet).forEach(([key, value]) => {
    urlParams.set(key, value);
  });

  return `${pathname}?${urlParams.toString()}`;
};
```

## Recommended Implementation Plan

### Phase 1: Critical Fix (Immediate)
**Implement Solution 1** - Preserve clinic_id in FirstTimeRegister.tsx URL update

### Phase 2: Robustness Improvements (Short-term)
**Implement Solution 2** - Add JWT token fallback for clinic_id extraction

### Phase 3: Code Quality (Medium-term)
**Implement Solution 5** - Create URL parameter preservation utility

### Phase 4: UX Enhancement (Long-term)
**Implement Solution 4** - Replace page reloads with state-based auth refresh

## Files Requiring Changes

### Primary (Critical)
- `frontend/src/liff/auth/FirstTimeRegister.tsx` - Fix URL parameter preservation

### Secondary (Robustness)
- `frontend/src/hooks/useLineAuth.ts` - Add JWT token clinic_id fallback

### Tertiary (Prevention)
- `frontend/src/utils/urlUtils.ts` - New utility for URL parameter handling

## Testing Requirements

### Critical Path Testing
- [ ] First-time user registration completes successfully
- [ ] User redirected to appointment booking page with clinic_id preserved
- [ ] URL contains both `clinic_id` and `mode=book` after registration

### Regression Testing
- [ ] Returning users (not first-time) still work correctly
- [ ] Direct navigation with clinic_id parameter works
- [ ] Logout and re-authentication works
- [ ] Multiple clinic scenarios work correctly

### Edge Case Testing
- [ ] Users with multiple URL parameters (all preserved)
- [ ] Network failures during registration
- [ ] Page refresh during registration flow
- [ ] Browser back/forward navigation

## Related Files

- `frontend/src/liff/auth/FirstTimeRegister.tsx` - Primary bug location
- `frontend/src/hooks/useLineAuth.ts` - Authentication logic
- `frontend/src/liff/LiffApp.tsx` - Main app component
- `backend/src/api/liff.py` - JWT token generation
- `frontend/src/stores/appointmentStore.ts` - State management

## Risk Assessment

**Low Risk**: Solution 1 is minimal and focused
**Medium Risk**: JWT fallback requires careful token handling
**High Risk**: Full auth refresh refactoring could introduce new issues

## Success Criteria

1. First-time users can complete registration and access appointment booking
2. Clinic isolation maintained (clinic_id properly enforced)
3. No regression for existing users
4. URL parameters properly preserved throughout user journey

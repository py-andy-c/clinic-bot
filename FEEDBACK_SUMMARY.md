# PR Feedback Summary

## Issues to Address

### ✅ Fixed: Typo in Button Text
- **File**: `SettingsClinicInfoPage.tsx` line 134
- **Issue**: "儲存更變" should be "儲存變更" (matches other pages)
- **Status**: Fixed

### ⚠️ Considered: JSON.stringify Comparison
- **Concern**: All 3 reviewers mentioned that `JSON.stringify()` comparison can be fragile with:
  - Object key order differences
  - `undefined` vs missing keys
  - Nested object serialization differences
- **Current Status**: The codebase already uses `JSON.stringify()` for comparisons in:
  - `chatSettingsComparison.ts` (with normalization)
  - `clinicSettings.ts` (with normalization)
  - `profileSettings.ts`
- **Decision**: Keep as-is for now. The pattern is consistent with existing codebase. If issues arise, we can refactor to use a deep equality utility or add normalization like the other comparison utilities.

### ✅ Verified: Error Handling
- **File**: `SettingsAppointmentsPage.tsx`
- **Issue**: Reviewer mentioned `setSavingPractitionerSettings(false)` might not be called in all error paths
- **Status**: Verified - it IS called in the catch block (line 169), so this is already correct

## Suggestions (Not Critical)

### 1. Extract to Custom Hook (Future)
- If this pattern is reused elsewhere, consider extracting to `useSettingsSave` hook
- **Status**: Deferred - wait until pattern is reused

### 2. Testing Coverage
- Add unit tests for the race condition scenario
- Test rapid successive saves
- Test with network delays
- **Status**: Good to have, but not blocking

### 3. useEffect Dependencies
- The `eslint-disable` comment is present and justified
- Dependencies are intentionally excluded to avoid re-triggers
- **Status**: Acceptable as-is

## Overall Assessment
All reviewers **approved** the PR. The main actionable item (typo) has been fixed. The JSON.stringify concern is noted but acceptable given existing codebase patterns.




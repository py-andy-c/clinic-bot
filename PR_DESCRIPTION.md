# Fix Race Condition in Settings Pages Save Flow

## Problem
Settings pages were experiencing a race condition where form data wasn't being saved correctly. The issue occurred because:

1. `updateData()` updates React state asynchronously
2. `setTimeout` was used to wait for state update, but this is unreliable
3. `saveData()` would sometimes read stale state before the update completed
4. Form wasn't being reset after save, causing browser alert on refresh

## Solution
Replaced the unreliable `setTimeout` pattern with a `useEffect` that watches for state updates:

1. Store form data in `pendingFormDataRef` before calling `updateData`
2. Use `useEffect` to watch for when settings match the pending data
3. Only call `saveData()` after state is confirmed updated
4. Reset form after save to clear `isDirty` flag and prevent browser alert
5. Guard form sync `useEffect` to prevent reset during save operations

## Files Changed
- `frontend/src/pages/settings/SettingsClinicInfoPage.tsx`
- `frontend/src/pages/settings/SettingsChatPage.tsx`
- `frontend/src/pages/settings/SettingsRemindersPage.tsx`
- `frontend/src/pages/settings/SettingsReceiptsPage.tsx`
- `frontend/src/pages/settings/SettingsAppointmentsPage.tsx`

## Testing
- ✅ Settings save correctly and persist after refresh
- ✅ No browser alert on refresh after saving
- ✅ Error handling works correctly
- ✅ Form state is properly managed

## Reviewer Notes
Please check for similar patterns elsewhere in the codebase:
- Look for other uses of `setTimeout` with `updateData`/`saveData` patterns
- Check if other form pages have similar race conditions
- Verify that form reset after save is handled consistently across all settings pages


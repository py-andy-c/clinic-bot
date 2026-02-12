# Fix: Remove Photo Description Tracking from Unsaved Changes Warning

## Summary
Fixed an issue in both LIFF and clinic-side medical record forms where photo descriptions were incorrectly tracked in the "unsaved changes" warning, even though they are saved immediately to the server. This created a false warning state that confused users.

## Problem
Photo descriptions are saved immediately when edited (via `MedicalRecordPhotoSelector` component), but both the LIFF and clinic-side implementations were tracking these changes as "unsaved". This caused:
- False "unsaved changes" warnings for data already persisted
- Confusing UX where users saw warnings for changes that were already saved
- On clinic side: Redundant batch save attempts for already-saved descriptions

## Changes
### LIFF Side (`PatientMedicalRecordPage.tsx`)
- Added sticky warning banner at the top of the page (above title)
- Tracks two types of changes:
  1. Form field edits (via React Hook Form's `isDirty` state)
  2. Photo selection changes (upload/delete)
- Warning displays: "尚未儲存，請滑至底部送出" (Not saved yet, please scroll to bottom to submit)
- Warning automatically hides during submission and after successful save
- Removed photo description tracking (`photoUpdates` state, `handlePhotoUpdate` callback)

### Clinic Side (`MedicalRecordPage.tsx`)
- Removed photo description tracking from dirty state detection
- Removed redundant batch photo description save logic (descriptions already saved immediately)
- Removed `photoUpdates` state and `handlePhotoUpdate` callback
- Simplified success messages (removed photo update failure handling)
- Removed unused imports (`PatientPhoto`, `apiService`)

## Implementation Details
- Added `initialPhotoIds` state to track starting photo selection for comparison
- Created `photosDirty` useMemo that only detects photo selection changes (add/remove)
- Added clear comments explaining why photo descriptions are excluded
- Photo descriptions continue to be saved immediately by `MedicalRecordPhotoSelector`

## Important Note: Photo Description Handling
Photo descriptions are **NOT** tracked in the unsaved changes warning because they are saved immediately to the server when edited (handled by `MedicalRecordPhotoSelector` component). This is intentional behavior:

- When a user edits a photo description, it saves to the server immediately
- This provides instant feedback and prevents data loss
- Including description edits in the warning would create a false "unsaved changes" state for data that's already persisted
- Only photo selection changes (adding/removing photos) trigger the warning, as these are saved on form submit

### Why Not Batch Photo Description Saves?
We considered refactoring to save photo descriptions on form submit (like form fields), but decided against it because:
1. **Immediate save provides better UX** - users get instant feedback when editing descriptions
2. **Breaking change risk** - would affect both clinic and LIFF sides (shared component)
3. **Significant effort** - estimated 7-8 hours of work with extensive testing needed
4. **Current behavior works well** - no user complaints about immediate saves

This can be revisited in the future if batched saves become a requirement.

## Test Plan
### LIFF Side
- Manually test on LIFF browser:
  1. Open medical record form
  2. Edit any form field → warning should appear
  3. Upload or delete a photo → warning should appear
  4. Edit a photo description → warning should NOT appear (saved immediately)
  5. Submit the form → warning should disappear after successful save
  6. Verify warning is sticky and stays at top when scrolling

### Clinic Side
- Manually test on clinic dashboard:
  1. Open medical record page
  2. Edit any form field → unsaved changes detection should trigger
  3. Upload or delete a photo → unsaved changes detection should trigger
  4. Edit a photo description → should NOT trigger unsaved changes (saved immediately)
  5. Save the form → verify no false warnings about photo description failures
  6. Verify navigation blocking works correctly

### Automated Tests
- Run `./run_tests.sh` to ensure all tests pass
- ✅ All frontend tests passing
- ✅ No TypeScript diagnostics errors

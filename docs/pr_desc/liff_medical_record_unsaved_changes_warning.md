# Feature: Unsaved Changes Warning for LIFF Medical Record Form

## Summary
Added a sticky header warning to the LIFF patient medical record form that alerts users when they have unsaved changes. The warning prompts users to scroll to the bottom to submit their changes, preventing accidental data loss.

## Changes
- **Frontend LIFF**: Enhanced `PatientMedicalRecordPage.tsx` to track and display unsaved changes
  - Added sticky warning banner at the top of the page (above title)
  - Tracks two types of changes:
    1. Form field edits (via React Hook Form's `isDirty` state)
    2. Photo selection changes (upload/delete)
  - Warning displays: "尚未儲存，請滑至底部送出" (Not saved yet, please scroll to bottom to submit)
  - Warning automatically hides during submission and after successful save
  - Resets dirty state tracking after successful submission

## Implementation Details
- Added `initialPhotoIds` state to track starting photo selection for comparison
- Created `photosDirty` useMemo that detects photo selection changes (add/remove)
- Warning condition: `(methods.formState.isDirty || photosDirty) && !updateMutation.isPending`

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
- Manually test on LIFF browser:
  1. Open medical record form
  2. Edit any form field → warning should appear
  3. Upload or delete a photo → warning should appear
  4. Edit a photo description → warning should NOT appear (saved immediately)
  5. Submit the form → warning should disappear after successful save
  6. Verify warning is sticky and stays at top when scrolling
- Run `./run_tests.sh` to ensure all tests pass

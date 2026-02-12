# Unified Medical Record Photo Management

## Summary
This PR unifies the photo management experience between the clinic-side medical record page and the patient-facing LIFF form. By sharing the same core logic and components, we eliminate several UX bugs, ensure a consistent clinical data collection process, and improve the overall code quality and type safety.

### Key Changes
- **Unified Component**: Replaced `LiffMedicalRecordPhotoSelector` with a shared `MedicalRecordPhotoSelector` that supports both clinic and LIFF environments.
- **Backend Enhancements**: 
    - Added the missing `PUT /liff/patient-photos/{photo_id}` endpoint to allow patients to update photo descriptions.
    - Updated `POST /liff/patient-photos` to accept and save photo descriptions during the initial upload.
- **Immediate Feedback**: Fixed a bug where patients had to save and reopen the form to see uploaded photos. Photos now appear immediately after upload.
- **Description Support**: Patients can now add and edit descriptions for their photos, providing better clinical context.
- **Improved Layout**: Switched the LIFF photo display from a cropped gallery grid to an "appendix-style" layout that preserves the original aspect ratio of images.
- **Data Fetching Optimization**: Optimized the photo selector to use initial photos passed from the parent component via `useMemo`, eliminating redundant API calls and unnecessary React Query wrappers.
- **Type Safety**: Refactored the unified component to remove all `as any` casts, aligned mutation signatures between clinic and LIFF, and improved TypeScript definitions for better maintainability.
- **Code Cleanup**: Deleted redundant LIFF-specific photo selector components and tests.

## Test Plan
1. **Photo Upload**: Verify that uploading a photo in the LIFF form shows an immediate preview and prompts for a description. Confirm the description is saved (verifies updated `POST` endpoint).
2. **Photo Editing**: Verify that clicking the edit icon on a photo allows updating the description and that the change is persisted (verifies new `PUT` endpoint).
3. **Photo Visibility**: Verify that reopening a previously saved form correctly displays all attached photos.
4. **Clinic Compatibility**: Verify that the clinic-side medical record page still functions correctly with the unified component.
5. **Automated Tests**: Run `./run_tests.sh` to ensure all backend and frontend unit tests pass.

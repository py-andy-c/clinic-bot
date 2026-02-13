# PR Description: Fix Follow-up Message Persistence and Validation

## Summary
This PR addresses two critical issues in the Service Item Settings:
1.  **Persistence Bug**: Follow-up messages and billing scenarios were not being saved when created because the backend's "Diff Sync" logic was too strict with ID lookups.
2.  **Validation Bug**: A frontend validation error ("小時數必須大於或等於 0") was triggered incorrectly when the user kept the default "0" hours, due to an initialization mismatch between state and UI.

## Changes

### Backend
- **File**: `backend/src/api/clinic/settings.py`
- **Security & Validation Improvements**:
    - Introduced `_is_real_id` helper to explicitly distinguish between database IDs and temporary frontend IDs (> 1,000,000,000,000).
    - Added explicit 400 HTTP rejection if temporary IDs are sent to the backend, enforcing correct frontend-backend boundary and preventing potential ID collisions.
    - Added explicit `clinic_id` check in database queries to ensure ID ownership during synchronization, preventing cross-clinic data manipulation.
- **Refactoring & DRY**:
    - Extracted creation logic for `BillingScenario` and `FollowUpMessage` into helper functions (`_create_billing_scenario`, `_create_follow_up_message`) with strict Pydantic type hints (`BillingScenarioBundleData`, `FollowUpMessageBundleData`).
- **Logging**:
    - Added consistent logging for billing scenario updates and creations to match the detail level of follow-up messages.

### Frontend
- **File**: `frontend/src/components/FollowUpMessagesSection.tsx`
- **Logic**: 
    - Fixed the initial state for `hours_after` and `days_after`. They now default to `0` instead of `undefined` in both `handleAddMessage` and `handleEditMessage`.
    - This aligns the internal state with the `0` displayed in the UI (via `useNumberInput`), preventing the strict validation checks from failing on untouched fields.

## Verification Results

### Automated Tests
- Created an integration test `backend/tests/integration/test_settings_sync.py` (verified via `pytest`).
- Verified that temporary IDs correctly trigger a **400 Bad Request** error, ensuring the frontend handles ID resolution.
- Verified that null or `0` IDs correctly trigger new record creation.
- Verified that IDs from other clinics are treated as new records for the current clinic rather than updating the original record (Clinic Isolation).
- Verified that real database IDs are updated correctly without duplication.

### Manual Verification
- Verified that clicking "+ 新增追蹤訊息" and then immediately clicking "儲存" no longer triggers the "小時數必須大於或等於 0" validation error.
- Verified that saved messages persist after reopening the Service Item Setting modal.

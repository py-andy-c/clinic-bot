# PR Description: Fix Service Item Settings Landmines and Data Loss Risks

## Context
This PR addresses critical data loss risks identified following [Incident Report: 2026-02-13 Clinic Settings Reset](file:///Users/andy/clinic-bot/docs/incident_report/2026-02-13_clinic_setting_reset.md). The incident revealed a "Partial Update Pattern" where saving settings on one page (e.g., Appointments) would silently clear fields (like `display_name`) not managed by that specific page.

An audit of the **Service Item Settings** page was performed to identify and neutralize similar "landmines" before they caused further data loss.

## Landmines Identified
1. **The "Cannot Clear Message" Bug**:
   - The backend used `if incoming_data.get('field'):` logic, which treated empty strings as "not provided." This made it impossible for users to clear confirmation or reminder messages; the system would simply revert to the previous value.
2. **Maintenance Risk (Sync Debt)**:
   - The update logic in [settings.py](file:///Users/andy/clinic-bot/backend/src/api/clinic/settings.py) relied on manual field-by-field assignment. This creates "Sync Debt" where new fields added to the database but omitted from the update function are silently lost during updates.
3. **Hard Sync Risks (Association Data Loss)**:
   - Associations (Practitioners, Resources) used a "Replace-All" strategy. If a partial update was triggered by a frontend schema that didn't include these associations, they were wiped from the database.
4. **Frontend Data Stripping**:
   - Zod schemas in the frontend were stripping unrecognized fields. In a partial update scenario, this ensured that any data the frontend wasn't specifically aware of was removed from the payload sent to the backend.

## Proposed Fixes
### Backend Refactor ([settings.py](file:///Users/andy/clinic-bot/backend/src/api/clinic/settings.py))
- **`MISSING` Sentinel Pattern**: Introduced a `MISSING` object to distinguish between a field being omitted from the request vs. being explicitly set to `null` or `""`. The import order has been fixed to prevent `NameError` at module load.
- **Pydantic `exclude_unset=True`**: Updated bundle update endpoints to use `model_dump(exclude_unset=True)`. This ensures Pydantic doesn't fill in default values for omitted fields, allowing the `MISSING` sentinel logic to correctly identify and preserve existing data.
- **`_update_field_if_present` Helper**: Introduced a robust helper to reduce boilerplate and cognitive load. It handles the `MISSING` check, optional transformations, and assignment in a single, reusable function.
- **Refined Message Logic**: The `_get_message_or_default` helper has been refactored to be more consistent and robust. It correctly handles `None` (preventing literal `"None"` in the DB) and implements a "Reset to Default" behavior: providing an empty string or `null` resets the message to the system default, while omitting the field entirely preserves the existing custom message. Temporal coupling between toggle updates and message defaults has been eliminated.
- **Hardened Association Syncing**: Improved the logic for syncing practitioners and resources to ensure they are only updated when explicitly provided in the payload.
- **Explicit Reactivation**: Soft-delete reactivation has been moved to a clearly named helper `_reactivate_if_soft_deleted` with explicit logging, making this side effect visible and auditable.
- **Python Compatibility**: Added `from __future__ import annotations` to [datetime_utils.py](file:///Users/andy/clinic-bot/backend/src/utils/datetime_utils.py) to support modern union type syntax (`|`) across all supported Python versions.

### Frontend Hardening ([api.ts](file:///Users/andy/clinic-bot/frontend/src/schemas/api.ts))
- **Zod `.catchall(z.unknown())`**: Replaced `.passthrough()` with `.catchall(z.unknown())` across all major clinic settings schemas. This maintains data preservation for unknown fields (preventing silent data loss) while allowing TypeScript to catch typos in known fields, providing a safer and more maintainable middle ground.
- **Type Safety**: Resolved TypeScript mismatches in [ServiceItemEditModal.tsx](file:///Users/andy/clinic-bot/frontend/src/components/ServiceItemEditModal.tsx) resulting from the schema changes.

### Verification
- **Expanded Integration Tests**: The test suite [test_service_item_update_integrity.py](file:///Users/andy/clinic-bot/backend/tests/integration/test_service_item_update_integrity.py) was expanded to cover:
  - **Message Preservation**: Verifying that omitting a message field (including recurrent messages) preserves the existing value.
  - **Reset to Default**: Verifying that sending an empty string or explicit `null` correctly resets a message to its system default.
  - **Association Integrity**: Verifying that practitioner associations are preserved when correctly provided in the bundle payload.
  - **Toggle State Integrity**: Ensuring toggle states (e.g., `is_enabled`) are preserved when omitted.

## Verification Results
- All backend tests passed, including the new integrity tests.
- Frontend type checking passed.
- `run_tests.sh` successfully executed.

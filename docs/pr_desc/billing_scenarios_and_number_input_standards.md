# PR Description: Billing Scenario Preservation & Number Input UX Standards

## Summary
This PR makes two related improvements:
1. **Billing Scenario Preservation**: Unchecking a practitioner in the service item settings no longer deletes their billing scenarios. Scenarios are preserved and displayed with muted styling, allowing easy restoration when the practitioner is re-checked.
2. **Number Input UX Standards**: Standardizes all number input fields across the application with wheel protection, empty-to-type support, and consistent step sizes.

## Changes

### Backend

#### `backend/src/api/clinic/settings.py`
- Modified `_sync_service_item_associations` to only soft-delete billing scenarios that are explicitly removed from the incoming list
- Removed the condition that deleted scenarios when their practitioner was unchecked
- Scenarios for unchecked practitioners are now preserved in the database
- **Security**: Added verification check in `_sync_service_item_associations` to ensure all practitioner IDs in the request belong to the current clinic.
- **Robustness**: Enhanced `_sync_service_item_associations` to automatically clean up (soft-delete) billing scenarios for practitioners who are no longer active in the clinic, preventing "ghost data" issues.
- **Bugfix**: Fixed data loss in Follow-up Messages by adding missing fields (`days_after`, `time_of_day`, `is_enabled`, `display_order`) to the Pydantic model and sync logic. Added proper `str` to `time` conversion for `time_of_day`.

#### `backend/src/models/billing_scenario.py`
- Changed check constraint from `amount > 0` to `amount >= 0` to allow free/zero-cost scenarios

#### `backend/src/models/clinic.py`
- **Convenience**: Added `custom_notes` and `show_stamp` properties to easily access receipt settings via the model.

#### `backend/alembic/versions/update_billing_amount_constraint.py` (NEW)
- Migration to update the database constraint from `chk_amount_positive` to `chk_amount_non_negative`
- Includes idempotency checks for safe re-runs

### Frontend

#### `frontend/src/components/ServiceItemEditModal.tsx`
- **Billing Scenarios UI**:
  - Show all billing scenarios regardless of practitioner assignment status
  - Muted styling (gray colors) for scenarios of unchecked practitioners
  - Show "+ 新增計費方案" button unconditionally
  - Display both amount and revenue share in format: `$2,000 / $1,500`
- **Billing Scenarios Logic**:
  - Added logic to automatically unset other default scenarios for a practitioner when a new default is selected in the UI.
- **Bugfix**: Fixed data loss in Follow-up Messages by including all fields in the submission mapping logic.
- **Type Safety**:
  - Implemented a dedicated `FormAppointmentTypeProxy` interface for the component state to eliminate `any` casts and improve type safety.
  - Resolved strict-mode conflicts (exactOptionalPropertyTypes) by explicitly handling optional property assignments.
- **Validation**:
  - Added frontend validation for scenario name (required, unique per practitioner)
  - Added validation that amount >= revenue_share
  - Red asterisks for required fields
- **Number Input UX**:
  - Applied `useNumberInput` hook for amount and revenue_share (empty-to-type support)
  - Added wheel protection
  - Set `step="10"` for currency fields, `step="5"` for duration_minutes
  - Added `scheduling_buffer_minutes` with wheel protection and `step="5"`.

#### `frontend/src/schemas/api.ts`
- Changed `amount`, `revenue_share`, `duration_minutes`, and `scheduling_buffer_minutes` to use `z.coerce.number()` for proper type coercion and "Empty-to-type" support.
- Added `.refine()` to enforce `amount >= revenue_share`.
- **Type Safety**: Removed `.passthrough()` from `ServiceItemBundleSchema` to ensure strict property checking and prevent accidental data leakage.

#### `frontend/src/components/forms/FormInput.tsx`
- Added automatic wheel protection for all `type="number"` inputs using this component

#### `frontend/src/components/ClinicAppointmentSettings.tsx`
- Added `step="5"` to `step_size_minutes` input

#### `frontend/src/components/FollowUpMessagesSection.tsx`
- **Standardization**: Refactored to use `useNumberInput` hook for `hours_after` and `days_after`.
- Added wheel protection and `step="1"` to both inputs.

#### `frontend/src/components/PractitionerStepSizeSettings.tsx`
- **Standardization**: Refactored to use `useNumberInput` hook for `stepSizeMinutes`.
- Added wheel protection and `step="5"`.

#### `frontend/src/components/ResourceRequirementsSection.tsx`
- Applied `useNumberInput` hook for quantity fields (empty-to-type support)
- Added wheel protection
- Added `step="1"`

### Documentation

#### `docs/design_doc/number_input_standards.md` (NEW)
- Documents the standard UX patterns for number inputs
- Covers wheel protection, empty-to-type, step sizes, and TWD currency handling
- Includes implementation patterns and checklist for new inputs

## Number Input Standards

| Value Type | Step | Examples |
|------------|------|----------|
| Minutes | 5 | `duration_minutes`, `step_size_minutes`, `scheduling_buffer_minutes` |
| Currency (TWD) | 10 | `amount`, `revenue_share`, prices |
| Others | 1 | `quantity`, `hours_after`, `days_after` |

All number inputs now have:
- Wheel protection (prevent accidental value changes on scroll)
- Empty-to-type support (can clear field before typing new value)
- Appropriate step sizes

## Testing Performed
- All tests passed successfully (`./run_tests.sh`)
- Backend tests cover billing scenario constraints and association syncing
- Frontend TypeScript checks pass
- Manual verification of billing scenario CRUD operations and default logic
- Manual verification of number input UX across all affected components


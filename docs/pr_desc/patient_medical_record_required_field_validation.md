# Patient Medical Record Required Field Validation

## Overview

Implements required field validation for patient-facing medical record forms (LIFF) to ensure data completeness when patients submit forms. Clinic-side forms maintain their existing flexible behavior with post-save warnings only.

## Problem

Previously, patients could submit medical record forms with empty required fields, leading to incomplete data. The system had no validation to prevent submission of incomplete patient forms.

## Solution

Added client-side validation that enforces required fields on patient-facing forms while preserving the existing clinic-side behavior:

- **Patient Side (LIFF):** Required fields are validated on submit. Submission is blocked until all required fields are filled.
- **Clinic Side (Web):** No change. Staff can still save incomplete records and receive post-save warnings about missing required fields.

## Why Different Behavior?

**Clinic Staff:**
- Need flexibility to save partial records (interrupted workflow, waiting for information, etc.)
- Post-save warnings provide helpful reminders without blocking their workflow
- Can handle edge cases and exceptions manually

**Patients:**
- Are filling out forms specifically sent to them
- Should complete all required information before submitting
- Clear validation prevents incomplete submissions and reduces back-and-forth

## Changes Made

### 1. Enhanced Schema Validation (`frontend/src/utils/medicalRecordUtils.ts`)

- Added `enforceRequired` parameter to `createMedicalRecordDynamicSchema()`
- When `enforceRequired=true`, validates required fields based on template configuration
- Supports all field types: text, textarea, dropdown, radio, date, number, checkbox
- Simple, clear error message: "此為必填欄位"

### 2. Patient Form Validation (`frontend/src/liff/records/PatientMedicalRecordPage.tsx`)

- Enabled required field enforcement for patient forms
- Added `onSubmitWithValidation()` function that:
  - Checks for validation errors before submission
  - Auto-scrolls to first field with error
  - Focuses the field for better UX
  - Blocks submission if validation fails

### 3. User Experience Improvements

- Required fields marked with red asterisk (*)
- Inline error messages displayed under invalid fields
- Smooth scroll to first error on submit attempt
- Field receives focus after scroll for keyboard accessibility

### 4. Test Coverage

- Added unit tests for required field validation
- Updated integration tests for patient form submission
- All existing tests continue to pass

## Validation Rules

| Field Type | Required Validation |
|------------|-------------------|
| text, textarea, dropdown, radio, date | Must have non-empty string value |
| number | Must have numeric value (not empty string) |
| checkbox | Must have at least one option selected |

## User Flow

### Patient Side (New Behavior)
1. Patient opens form sent via LINE
2. Required fields are marked with red asterisk (*)
3. Patient fills out form
4. On submit:
   - ✅ If all required fields filled → Form submits successfully
   - ❌ If required fields missing:
     - Inline error "此為必填欄位" shown under each invalid field
     - Page auto-scrolls to first error
     - Field receives focus
     - Submission blocked until all required fields are filled

### Clinic Side (Unchanged Behavior)
1. Staff creates/edits medical record
2. Staff can save incomplete records
3. After save, warning dialog shows list of missing required fields (if any)
4. Warning is informational only - doesn't block workflow

## Technical Details

### Error Display
- Uses existing `FormField` component for consistent error display
- Errors shown inline with red text below field
- ARIA attributes for accessibility (`aria-invalid`, `aria-describedby`)

### Auto-Scroll Implementation
- Uses `scrollIntoView({ behavior: 'smooth', block: 'center' })`
- Focuses field after scroll for keyboard users
- Targets first field in validation error object

### Validation Timing
- Validation only runs on submit button click
- No real-time validation during typing (less intrusive)
- Errors clear automatically when field is corrected

## Testing

All tests passing:
- ✅ Unit tests for schema validation with `enforceRequired` flag
- ✅ Integration tests for patient form submission blocking
- ✅ Existing clinic-side tests unchanged and passing

## Files Changed

- `frontend/src/utils/medicalRecordUtils.ts` - Enhanced schema with required field validation
- `frontend/src/liff/records/PatientMedicalRecordPage.tsx` - Added validation and auto-scroll
- `frontend/src/utils/__tests__/medicalRecordUtils.test.ts` - Added validation tests
- `frontend/src/liff/records/__tests__/PatientMedicalRecordPage.test.tsx` - Updated submission test

## Future Considerations

1. **Server-side validation:** Consider adding backend validation when `is_submitted=true` for additional security
2. **Draft saving:** If patient draft functionality is added, validation should only apply on final submit
3. **Custom validation rules:** Could extend to support field-specific rules (min/max length, regex patterns, etc.)

## Screenshots

### Before
- Patients could submit forms with empty required fields
- No validation feedback

### After
- Required fields marked with asterisk
- Clear error message: "此為必填欄位"
- Auto-scroll to first error
- Submission blocked until complete

## Migration Notes

No migration needed. This is a pure frontend enhancement with no database or API changes.

## Rollback Plan

If issues arise, can be rolled back by:
1. Reverting `enforceRequired` parameter to `false` in `PatientMedicalRecordPage.tsx`
2. No data migration or cleanup needed

# Appointment Notes Customization - Design

## Overview

Allow clinics to customize appointment notes (備註) requirements and instructions per service type. This enables service-specific note requirements and custom guidance for patients when filling out notes during LIFF booking.

## Requirements

### Per-Service-Type Settings

1. **Require Notes** (`require_notes: bool`)
   - When `true`, patients must fill out notes before completing appointment booking
   - Only applies to service types available for patient booking (`allow_new_patient_booking = true` or `allow_existing_patient_booking = true`)
   - Default: `false` for all existing and new service types

2. **Notes Instructions** (`notes_instructions: Optional[str]`)
   - Custom instructions shown to patients when filling out notes
   - Replaces global `appointment_notes_instructions` if not null
   - Fallback chain: service-specific → global → nothing
   - Empty string treated as null (falls back to global)
   - Default: `null` for all existing and new service types

### UI Behavior

- All fields are always visible, regardless of patient booking settings
- Show inline warning when `allow_new_patient_booking = false AND allow_existing_patient_booking = false` for LIFF-only fields:
  - "要求填寫備註" (require_notes)
  - "備註填寫指引" (notes_instructions)
  - "預約確認訊息（病患自行預約）" (patient_confirmation_message)
- Warning message: "此服務項目未開放病患自行預約，此設定不會生效。"
- Allow saving even when LIFF is disabled (preserves flexibility for future use)
- Validation: Show asterisk (*) on notes field label when `require_notes = true`
- Disable "Next" button if `require_notes = true` and notes are empty

### Scope

- **Applies to**: Initial appointment booking flow in LIFF
- **Does NOT apply to**: Reschedule flow (patients can reschedule without notes requirement)

## Database Design

### Schema Changes

**`appointment_types` table - Add columns:**
```sql
require_notes: bool (default: false, not null)
notes_instructions: text (nullable, default: null)
```

**Rationale:**
- Per-service-type granularity (different services may need different note requirements)
- `require_notes` is boolean with default false (backward compatible)
- `notes_instructions` is nullable to allow fallback to global setting
- Text field supports long instructions

### Migration Strategy

- All existing appointment types get:
  - `require_notes = false`
  - `notes_instructions = null`
- Zero breaking changes - existing behavior preserved

## API Design

### Backend Validation

**LIFF Appointment Creation Endpoint** (`POST /liff/appointments`):
- Check that appointment type is available for the patient type before enforcing `require_notes`
- If `require_notes = true` and appointment type is available for booking, validate that `notes` is provided and not empty
- Validation error: "此服務項目需要填寫備註"

**Notes Instructions Resolution**:
1. Check `appointment_type.notes_instructions`
2. If null or empty string, use `clinic_settings.clinic_info_settings.appointment_notes_instructions`
3. If global is also null, return null (no instructions shown)

### API Response Changes

**`GET /liff/appointment-types`**:
- Add `require_notes: bool` to `AppointmentTypeResponse`
- Add `notes_instructions: Optional[str]` to `AppointmentTypeResponse`

**`GET /liff/clinic-info`**:
- Keep existing `appointment_notes_instructions` (global fallback)

## Frontend Design

### Service Item Edit Modal

**New Fields Section** (shown only when `allow_new_patient_booking = true OR allow_existing_patient_booking = true`):
- Checkbox: "要求填寫備註" (`require_notes`)
- Textarea: "備註填寫指引" (`notes_instructions`)
- Inline warning when `allow_new_patient_booking = false AND allow_existing_patient_booking = false`: "此設定僅適用於開放病患自行預約的服務項目"

**Location**: Add after "說明" (description) field, before "訊息設定" section

### LIFF Booking Flow

**Step 5: Add Notes** (`Step5AddNotes.tsx`):
- Determine instructions to show:
  1. `appointmentType.notes_instructions` (if not null/empty)
  2. Fall back to `appointmentNotesInstructions` from store (global)
  3. Show nothing if both are null
- Show required indicator (*) if `appointmentType.require_notes = true`
- Validate on "Next" button click:
  - If `require_notes = true` and notes are empty, show error and prevent proceeding
  - Error message: "此服務項目需要填寫備註"

### Data Flow

1. User selects service type → `appointmentType` stored in appointment store
2. Step 5 loads → Check `appointmentType.require_notes` and `appointmentType.notes_instructions`
3. Instructions displayed → Service-specific if available, otherwise global
4. Validation → On "Next" click, check if notes required and provided

## Edge Cases

### Data Consistency
- If `allow_new_patient_booking = false AND allow_existing_patient_booking = false` but `require_notes = true` or `notes_instructions` is set:
  - Allow saving (show warning only)
  - Settings preserved but not enforced (useful if clinic plans to enable LIFF later)

### Existing Appointments
- Existing appointments without notes remain valid
- Only new appointments are validated against `require_notes`
- Changing `require_notes` from false to true only affects future bookings

### Empty String Handling
- `notes_instructions = ""` treated as `null` (falls back to global)
- Backend normalizes empty strings to null before saving

### Backend Validation
- Only enforce `require_notes` when appointment type is available for patient booking
- If service type is not available on LIFF, skip notes requirement validation

## Implementation Notes

### Default Values
- New service types: `require_notes = false`, `notes_instructions = null`
- Existing service types: Migration sets both to defaults (false, null)

### Character Limits
- `notes_instructions`: No explicit limit (uses text field, reasonable limit ~2000 chars recommended)
- Patient notes: Existing 500 character limit remains unchanged

### Validation Messages
- Frontend: "此服務項目需要填寫備註" (shown when trying to proceed without notes)
- Backend: Same message returned in validation error

## Future Considerations

- Could extend to other LIFF-only fields (e.g., description, patient confirmation message)
- Pattern can be reused for other service-type-specific settings
- Consider adding character limit for `notes_instructions` if needed


# Patient Birthday Feature - Implementation Plan

## Overview
Make patient birthday collection configurable per clinic. When enabled, require birthday during patient registration and display it in patient profiles throughout the system.

## Requirements
1. **Clinic Settings**: Add toggle in clinic settings to enable/disable birthday collection
2. **Patient Registration**: When enabled, require birthday during Line user registration
3. **Patient Display**: Show birthday in:
   - Clinic admin patient list
   - LIFF patient management page
   - Appointment details in practitioner calendar
   - Appointment cards in LIFF

## Implementation Plan

### Backend Changes

#### 1. Database Migration
- Add `birthday` column to `patients` table (DATE, nullable)
- Add migration file in `backend/alembic/versions/`

#### 2. Patient Model
- Update `backend/src/models/patient.py`:
  - Add `birthday: Mapped[Optional[date]]` field

#### 3. Clinic Settings Schema
- Update `backend/src/models/clinic.py`:
  - Add `require_birthday: bool = Field(default=False)` to `ClinicInfoSettings`

#### 4. Patient Service
- Update `backend/src/services/patient_service.py`:
  - Add `birthday: Optional[date]` parameter to `create_patient()`
  - Add `birthday: Optional[date]` parameter to `update_patient_for_line_user()`

#### 5. API Endpoints

**LIFF API (`backend/src/api/liff.py`)**:
- Update `PatientCreateRequest`: Add optional `birthday: Optional[str]` with date validator
- Update `PatientUpdateRequest`: Add optional `birthday: Optional[str]` with date validator
- Update `create_patient()`: Check clinic setting, require birthday if enabled
- Update `update_patient()`: Allow birthday updates
- Update patient list/response models to include birthday

**Clinic API (`backend/src/api/clinic.py`)**:
- Update `ClinicPatientResponse`: Add `birthday: Optional[str]`
- Patient list endpoint already uses this response model

**Practitioner Calendar API (`backend/src/api/practitioner_calendar.py`)**:
- Update `CalendarEventResponse`: Add `patient_birthday: Optional[str]` (for appointment events)

### Frontend Changes

#### 1. Type Definitions
- Update `frontend/src/types/index.ts`:
  - Add `birthday?: string` to `Patient` interface

- Update `frontend/src/services/liffApi.ts`:
  - Add `birthday?: string` to `PatientCreateRequest`, `PatientResponse`, `PatientSummary`

#### 2. Clinic Settings UI
- Update `frontend/src/components/ClinicInfoSettings.tsx`:
  - Add toggle switch for "要求填寫生日" (Require Birthday)
  - Place in `ClinicInfoSettings` section

- Update `frontend/src/schemas/api.ts`:
  - Add `require_birthday?: boolean` to `ClinicInfoSettings` type

#### 3. Patient Registration (LIFF)
- Update `frontend/src/liff/auth/FirstTimeRegister.tsx`:
  - Add birthday date input field
  - Show conditionally based on clinic setting (fetch from clinic context)
  - Validate required when setting is enabled
  - Format as YYYY-MM-DD for API

#### 4. Patient Management (LIFF)
- Update `frontend/src/liff/settings/PatientManagement.tsx`:
  - Add birthday field to add/edit forms
  - Display birthday in patient list (when available)
  - Handle optional birthday based on clinic setting

#### 5. Clinic Admin Patient List
- Update `frontend/src/pages/PatientsPage.tsx`:
  - Add "生日" column header
  - Display birthday in table (format: YYYY/MM/DD or "-" if null)

#### 6. Appointment Details
- Update `frontend/src/components/calendar/EventModal.tsx`:
  - Display patient birthday when available (for appointment events)

- Update `frontend/src/liff/query/AppointmentCard.tsx`:
  - Display patient birthday if available

#### 7. API Service Updates
- Update `frontend/src/services/liffApi.ts`:
  - Include birthday in create/update patient requests
  - Handle birthday in response types

- Update `frontend/src/services/api.ts`:
  - Ensure patient responses include birthday field

## Data Flow

1. **Clinic Admin enables setting** → Saved to `clinic.settings.clinic_info_settings.require_birthday`
2. **Line user registers** → Frontend checks clinic setting, shows birthday field if enabled
3. **Patient created** → Birthday stored in `patients.birthday` (nullable)
4. **Patient displayed** → Birthday shown wherever patient info is displayed (if available)

## Validation Rules

- Birthday format: YYYY-MM-DD (ISO date format)
- Required when `require_birthday` setting is enabled (for new patient creation only)
- Optional when setting is disabled (can be added later via edit)
- Date validation: Must be valid date, reasonable range (e.g., not future, not too old)
- **Update behavior**: The `require_birthday` setting does NOT apply to patient updates.
  This allows existing patients without birthdays to be updated even after the clinic
  enables the requirement. Birthday can be added via update when convenient.

## Backward Compatibility

- Existing patients without birthday: `birthday` is `NULL`, display as "-" or omit
- Clinics with setting disabled: No change to current behavior
- Setting can be enabled/disabled at any time without affecting existing patients

## Testing Considerations

1. Test with setting enabled: Birthday required during registration
2. Test with setting disabled: Birthday optional, registration works without it
3. Test patient list displays birthday correctly
4. Test appointment details show birthday
5. Test editing patient can add/update birthday
6. Test clinic setting toggle works


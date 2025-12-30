# Patient-Practitioner Assignment Feature Design

## Overview

This feature allows clinics to assign one or more practitioners as the main responsible person(s) for a patient. This assignment affects appointment booking flows and patient management.

## Requirements

### 1. Patient Detail Page
- View assigned practitioner(s) for the patient
- Edit assigned practitioner(s) - can assign multiple practitioners
- Display all assigned practitioners

### 2. Patient List Page
- Filter patients by practitioner

### 3. Appointment Settings (預約設定)
- New setting: `restrict_to_assigned_practitioners` (default: `False`)
  - If `False`: Patients can book with any practitioner (current behavior)
  - If `True`: Patients can only book with assigned practitioners (with edge case handling)

### 4. LIFF Appointment Flow - Practitioner Filtering
**When `restrict_to_assigned_practitioners = False` (default)**:
- Show all practitioners (current behavior)
- **Required**: Highlight assigned practitioners visually (only when patient is known)

**When `restrict_to_assigned_practitioners = True`**:
- Show only assigned practitioners
- If no assigned practitioners: show all practitioners (including "不指定")
- Edge case: If selected appointment type is not offered by any assigned practitioner, show all practitioners (including "不指定")
- **Note**: Filtering only applies when patient is known (Flow 2 Step 3, or after patient selection in Flow 1)

### 5. LIFF Reschedule Flow - Practitioner Filtering
- Same filtering rules as appointment flow (Section 4)
- Patient is always known (from existing appointment)
- **Required**: Highlight assigned practitioners visually when showing all practitioners
- **Note**: No assignment prompt after reschedule (patients cannot assign practitioners)

### 6. Clinic-Side Appointment Creation/Editing
**Practitioner Selection**:
- Show all practitioners (no filtering - clinic users can bypass restrictions)
- **Required**: Highlight assigned practitioners visually (informational only, does not restrict selection)
- Label assigned practitioners (e.g., "王醫師 (負責人員)")

**After Appointment Save/Update**:
- Check if selected practitioner is assigned to patient
- If not assigned → Show prompt: "此治療師並非此病患的負責人員。是否要將此治療師設為負責人員？(Y/N)"
- If Yes → Add practitioner to patient's assigned practitioners
- Show confirmation modal with all assigned practitioners (may be multiple)

**Applies to**:
- CreateAppointmentModal (creating new appointment)
- EditAppointmentModal (editing appointment - only if practitioner changed)
- Duplicate Appointment (duplicating appointment)
- Pending Review Re-assignment (reassigning appointment)

## LIFF Appointment Flow Design

### Core Principle
**Conditional Patient Selection Timing**: Patient selection happens at different points in the flow depending on whether the LINE user has existing patients.

### Flow Detection
- On AppointmentFlow component mount, immediately query if LINE user has existing patients
- Show loading spinner/skeleton state while checking
- Handle errors: If query fails, default to Flow 1 (new user flow) and show error message
- Handle timeout: If query takes too long (>3s), default to Flow 1 and allow user to proceed
- Determine flow based on `patients.length > 0`

### Flow 1: New LINE Users (No Existing Patients)
**Steps** (no step numbers displayed):
1. Select Appointment Type
2. Select Practitioner (all shown, no filtering, no highlighting - patient unknown)
3. Select Date/Time
4. Select/Create Patient (same UI as current Step 4)
5. Add Notes
6. Confirmation

**Rationale**: Privacy-sensitive new users don't provide personal information until after seeing appointment options. Since patient is unknown in Step 2, assigned practitioners cannot be highlighted.

### Flow 2: Existing LINE Users (Has Patients)
**Steps** (no step numbers displayed):
1. Select/Create Patient (moved to first step, same UI component as current Step 4)
2. Select Appointment Type
3. Select Practitioner (filtered by assigned if `restrict_to_assigned_practitioners = True`)
4. Select Date/Time
5. Add Notes
6. Confirmation

**Rationale**: Existing customers already trust the clinic and have shared data. Early patient selection enables practitioner filtering.

### UI Changes
- **Remove**: Step numbers (1, 2, 3, etc.) from UI
- **Remove**: Progress bar
- **Keep**: Step names/descriptions (e.g., "Select Patient", "Select Appointment Type")
- **Keep**: Back button navigation (see Back Button Requirements below)

### Patient Selection UI (Step 1 for Existing Users, Step 4 for New Users)
- Show list of existing patients (if any)
- Show "Create new patient" button/form
- Use same `PatientForm` component with same validation rules
- Support creating new patient even if existing patients exist (for booking for others)

### Back Button Requirements
- Back button should navigate to the correct "previous step" according to the appropriate flow
- For Flow 1 (new users): Back from Step 4 → Step 3 → Step 2 → Step 1 → LIFF Home
- For Flow 2 (existing users): Back from Step 5 → Step 4 → Step 3 → Step 2 → Step 1 → LIFF Home
- Back button behavior must adapt based on which flow is active
- Browser back button: Should work the same as UI back button (use history API)
- **Note**: "Home" refers to LIFF home page (not clinic admin dashboard)

## Edge Cases

### 1. Multiple Existing Patients
- Show all patients in list
- User selects one patient
- Use selected patient's assigned practitioners for filtering

### 2. No Assigned Practitioners
- If selected patient has no assigned practitioners and `restrict_to_assigned_practitioners = True`
- Show all practitioners (including "不指定")

### 3. Appointment Type Not Offered by Assigned Practitioners
- If selected appointment type is not offered by any assigned practitioner
- Show all practitioners (including "不指定")
- **Note**: If the clinic doesn't allow user to select practitioner for this appointment type (`allow_patient_practitioner_selection = False`), the practitioner selection step should still be skipped (as per current behavior)

### 4. Existing User Creates New Patient
- User can create new patient in Step 1 (Flow 2)
- New patient has no assigned practitioners yet
- Show all practitioners (no filtering, even if `restrict_to_assigned_practitioners = True`)
- After appointment creation, admin can assign practitioner

### 5. User Changes Patient Mid-Flow
- If user goes back and changes selected patient (or creates new patient)
- Reset dependent selections: Clear `practitionerId`, `practitioner`, `date`, `startTime` from appointment store
- Preserve: Keep `appointmentTypeId` and `appointmentType` (may still be valid)
- User must re-select practitioner and date/time
- If new patient created → Show all practitioners (no filtering)
- **Note**: No warning before losing selections (user initiated the change)

### 6. Patient Selection State Management
- Store selected patient early in appointment store
- Use stored patient for practitioner filtering in practitioner selection step
- Patient data available throughout flow once selected

### 7. Clinic-Side Assignment Prompt Edge Cases
- **Practitioner already assigned**: Don't prompt
- **Practitioner didn't change (EditAppointmentModal)**: Don't prompt
- **Patient changed (EditAppointmentModal)**: Check new patient's assigned practitioners
- **Auto-assigned practitioner (不指定)**: Don't prompt (no specific practitioner selected - "不指定" means "not specified", not a practitioner)
- **Multiple assigned practitioners**: Prompt only if selected practitioner is not in list
- **Duplicate with same practitioner**: Still check if practitioner is assigned, prompt if not
- **Inactive/deleted assigned practitioners**: Filter out inactive/deleted practitioners from assigned list
- **Appointment type changed (EditAppointmentModal)**: For clinic side, show all practitioners (no filtering based on assignment)

### 8. Assignment Prompt Behavior
- **Timing**: After appointment save/update success, before closing modal
- **User clicks "No"**: Continue without adding assignment, close modal normally
- **User clicks "Yes"**: Add assignment, show confirmation modal with all assigned practitioners
- **Modal type**: Blocking modal with Y/N buttons
  - ESC key: Closes modal (defaults to No, same as cancel)
  - Cancel button: Closes modal (defaults to No)
  - Accessibility: Keyboard navigable, screen reader friendly
- **API failure**: If assignment API call fails, show error but still close modal (assignment is optional)

### 9. Additional Edge Cases
- **All assigned practitioners inactive**: Treat as "no assigned practitioners" - show all practitioners
- **Patient soft-deleted**: Still show assigned practitioners (clinic can still view/manage)
- **Clinic setting changes mid-flow**: Use setting at time of appointment creation (not at time of display)
- **Duplicate with different patient**: Check new patient's assigned practitioners, prompt if practitioner not assigned to new patient
- **Appointment type deleted**: If appointment type is deleted, filtering logic still checks if assigned practitioners offered that type (historical check)

## Implementation Details

### Database Schema
- New table: `patient_practitioner_assignments`
  - `patient_id` (FK to patients)
  - `user_id` (FK to users - practitioner)
  - `clinic_id` (FK to clinics)
  - `created_at` (timestamp)
  - `created_by_user_id` (FK to users, nullable - NULL if system-generated assignment)
  - Unique constraint: `(patient_id, user_id, clinic_id)`
  - Indexes:
    - `idx_patient_practitioner_assignments_patient` on `(patient_id, clinic_id)` for filtering by patient
    - `idx_patient_practitioner_assignments_practitioner` on `(user_id, clinic_id)` for filtering by practitioner
    - `idx_patient_practitioner_assignments_clinic` on `clinic_id` for clinic-scoped queries

### Settings
- Add to `ClinicInfoSettings`: `restrict_to_assigned_practitioners: bool = False`

### API Changes
- `GET /api/clinic/patients/:id` - Include assigned practitioners in response
- `PUT /api/clinic/patients/:id` - Support updating assigned practitioners (request body includes `assigned_practitioner_ids: number[]`)
- `GET /api/clinic/patients` - Support filtering by practitioner (query parameter: `practitioner_id`)
- `POST /api/clinic/patients/:id/assign-practitioner` - Add single practitioner assignment to patient
  - Request body: `{ user_id: number }`
  - Returns: Updated patient with assigned practitioners
  - Error handling: 409 Conflict if assignment already exists, 404 if patient/practitioner not found
- `DELETE /api/clinic/patients/:id/assign-practitioner/:practitioner_id` - Remove practitioner assignment from patient
  - Returns: Updated patient with assigned practitioners
  - Error handling: 404 if assignment doesn't exist
- `GET /api/liff/practitioners` - Filter by assigned practitioners when:
  - `restrict_to_assigned_practitioners = True`
  - Patient is known (from appointment store)
  - Selected appointment type is offered by assigned practitioners
  - Query parameter: `patient_id` (optional, for filtering)
- `POST /api/clinic/appointments/:id/reassign` - Return assigned practitioners, prompt to add (existing endpoint, may need modification)

### Frontend Changes

#### Appointment Flow
- `AppointmentFlow.tsx`: Query patients on mount, conditionally render first step
- Remove step numbers and progress bar from UI
- Update step navigation logic for both flows
- Update back button handler to navigate correctly per flow

#### Patient Selection
- `Step4SelectPatient.tsx`: Reusable for both flows (Step 1 for existing users, Step 4 for new users)
- No changes to component logic, only used at different points in flow

#### Practitioner Selection (LIFF - Appointment Flow)
- `Step2SelectPractitioner.tsx` (Flow 1) / `Step3SelectPractitioner.tsx` (Flow 2):
  - Flow 1: Patient unknown → Show all practitioners, no highlighting
  - Flow 2: Patient known → Query assigned practitioners for selected patient
  - Filter practitioners based on `restrict_to_assigned_practitioners` setting
  - **Required**: Highlight assigned practitioners visually when showing all practitioners (only when patient is known)
  - Handle edge cases (no assigned, appointment type conflict)
  - Skip step if `allow_patient_practitioner_selection = False` for selected appointment type

#### Practitioner Selection (LIFF - Reschedule Flow)
- `RescheduleFlow.tsx` (practitioner selection step):
  - Patient is known (from existing appointment)
  - Query assigned practitioners for patient
  - Filter practitioners based on `restrict_to_assigned_practitioners` setting
  - **Required**: Highlight assigned practitioners visually when showing all practitioners
  - Handle edge cases (no assigned, appointment type conflict)
  - Skip step if `allow_patient_practitioner_selection = False` for appointment type
  - **Note**: No assignment prompt after reschedule (patients cannot assign practitioners)

#### Practitioner Selection (Clinic Side)
- `PractitionerSelector.tsx` (used in CreateAppointmentModal, EditAppointmentModal):
  - Show all practitioners (no filtering - clinic users can bypass restrictions)
  - **Required**: Highlight assigned practitioners visually
  - Label assigned practitioners (e.g., "王醫師 (負責人員)")
  - Query assigned practitioners for selected patient
  - Display assigned status in dropdown/selector

#### Patient Detail Page
- Add assigned practitioners section
- Allow editing assigned practitioners (multi-select)
- **Permissions**: Only clinic admins and practitioners can assign/edit (same permissions as patient editing)

#### Patient List Page
- Add practitioner filter dropdown

#### Settings Page
- Add `restrict_to_assigned_practitioners` toggle in ClinicAppointmentSettings

#### Shared Assignment Prompt Logic
- **Reusable Hook**: `usePractitionerAssignmentPrompt`
  - Checks if practitioner is assigned to patient
  - Filters out inactive/deleted practitioners from assigned list
  - Shows prompt modal if not assigned
  - Handles adding assignment
  - Shows confirmation with all assigned practitioners
- **Utility Function**: `shouldPromptForAssignment(patient, practitionerId)`
  - Returns true if practitioner is not assigned to patient
  - Filters out inactive/deleted practitioners
  - If patient has no active assigned practitioners → returns true (prompt for first assignment)
  - If all assigned practitioners are inactive → returns true (treat as no assigned, prompt for first assignment)
- **Shared Component**: `PractitionerAssignmentPromptModal`
  - Reusable blocking modal for "Add as assigned practitioner?" prompt
  - Y/N buttons, cancel/close defaults to No
  - Used across create/edit/duplicate/reassign flows (clinic side only)
  - **Not used in**: LIFF reschedule flow (patients cannot assign practitioners)

#### CreateAppointmentModal
- After appointment creation success (before closing modal):
  - Check if selected practitioner is assigned to patient
  - If not assigned → Show assignment prompt modal
  - If Yes → Add assignment and show confirmation
  - If No/Cancel → Close modal normally without adding assignment

#### EditAppointmentModal
- After appointment update success (before closing modal):
  - Only check if practitioner changed AND new practitioner is not assigned
  - If patient changed → Check new patient's assigned practitioners
  - If appointment type changed → Show all practitioners (clinic side, no filtering)
  - If not assigned → Show assignment prompt modal
  - If Yes → Add assignment and show confirmation
  - If No/Cancel → Close modal normally without adding assignment

#### Duplicate Appointment
- After appointment duplication success (before closing modal):
  - Check if selected practitioner is assigned to patient (even if same as original)
  - If patient changed → Check new patient's assigned practitioners
  - If not assigned → Show assignment prompt modal
  - If Yes → Add assignment and show confirmation
  - If No/Cancel → Close modal normally without adding assignment

#### Pending Review Page
- After reassignment success (before closing modal):
  - Check if reassigned practitioner is assigned to patient
  - If not assigned → Show assignment prompt modal
  - If Yes → Add assignment and show confirmation
  - If No/Cancel → Close modal normally without adding assignment

### State Management
- Appointment store: Store selected patient early (Step 1 for existing users)
- Use stored patient for practitioner filtering
- Reset dependent fields when patient changes

### Code Sharing Strategy
- **Shared Components**:
  - `PractitionerSelector`: Highlight assigned practitioners, show label
  - `PractitionerAssignmentPromptModal`: Reusable prompt modal
- **Shared Utilities**:
  - `shouldPromptForAssignment(patient, practitionerId)`: Check if prompt needed
  - `addPractitionerAssignment(patientId, practitionerId)`: Add assignment
- **Shared Hooks**:
  - `usePractitionerAssignmentPrompt`: Handle assignment prompt flow
- **Flow Integration**:
  - After appointment save/update success → Check assignment → Prompt if needed → Add if confirmed
- **Performance Considerations**:
  - Cache assigned practitioners per patient (invalidate on assignment changes)
  - Query optimization: Use indexes on `(patient_id, clinic_id)` for fast lookups
  - Consider batch loading assigned practitioners for multiple patients in patient list

### Migration Strategy
- **Existing Appointments**: No automatic assignment migration
  - Existing appointments remain unchanged
  - Clinics can manually assign practitioners based on appointment history if desired
  - New appointments will use assignment rules going forward
- **Rollout Plan**:
  - Feature is opt-in via `restrict_to_assigned_practitioners` setting (default: `False`)
  - Clinics can gradually adopt by assigning practitioners to patients first, then enabling restriction
  - No breaking changes to existing appointment flows

## Flow Comparison

| Step | New LINE Users | Existing LINE Users |
|------|----------------|---------------------|
| 1    | Appointment Type | **Patient** |
| 2    | Practitioner | Appointment Type |
| 3    | Date/Time | Practitioner (filtered) |
| 4    | **Patient** | Date/Time |
| 5    | Notes | Notes |
| 6    | Confirmation | Confirmation |

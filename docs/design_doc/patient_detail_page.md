# Patient Detail Page

## Overview
A dedicated page for viewing and editing patient information, along with viewing their appointment history (future, completed, and cancelled).

## User Flow
1. User clicks on a patient row in the Patients list page (`/admin/clinic/patients`)
2. Navigate to patient detail page (`/admin/clinic/patients/:id`)
3. View patient information and appointments
4. Edit patient information (if permitted)

## Features

### Patient Information Section
- **Display fields:**
  - Full name
  - Phone number
  - Birthday (if available)
  - LINE user link (if linked)
  - Created date
- **Edit capability:**
  - Inline edit form (similar to existing patient creation modal)
  - Editable fields: `full_name`, `phone_number`, `birthday`
  - Save/Cancel buttons
  - Validation (same as patient creation)

### Appointments Section
- **Three tabs/sections:**
  1. **Future** - Upcoming confirmed appointments
  2. **Completed** - Past confirmed appointments
  3. **Cancelled** - All cancelled appointments (by patient or clinic)
- **Appointment display:**
  - Date and time
  - Practitioner name
  - Appointment type
  - Status badge
  - Notes (if any)
  - Clickable to view/edit appointment (if permitted)

## Technical Design

### Frontend

#### Route
- Path: `/admin/clinic/patients/:id`
- Component: `PatientDetailPage.tsx`
- Add route in `App.tsx` under ClinicLayout routes

#### Components
- `PatientDetailPage.tsx` - Main page component
- `PatientInfoSection.tsx` - Patient info display/edit
- `PatientAppointmentsList.tsx` - Appointments list with tabs/filters

#### API Integration
- `GET /clinic/patients/:id` - Get patient details
- `PUT /clinic/patients/:id` - Update patient information
- `GET /clinic/patients/:id/appointments` - Get appointments for patient
  - Query params: `status` (optional), `upcoming_only` (optional)

#### State Management
- Use React Query for data fetching
- Local state for edit mode

### Backend

#### New API Endpoints

**GET /clinic/patients/:id**
- Returns patient details
- Access: All clinic members (read-only users can view)
- Response: `ClinicPatientResponse` (same as list endpoint)

**PUT /clinic/patients/:id**
- Updates patient information
- Access: Admin and Practitioner roles only
- Request: `ClinicPatientUpdateRequest` (full_name, phone_number, birthday)
- Validation: Same as patient creation

**GET /clinic/patients/:id/appointments**
- Returns appointments for a specific patient
- Access: All clinic members
- Query params:
  - `status`: Filter by status (`confirmed`, `canceled_by_patient`, `canceled_by_clinic`)
  - `upcoming_only`: Boolean (true = future appointments only)
- Response: `AppointmentListResponse` (reuse existing structure)
- Order: Most recent first

#### Service Layer
- Extend `PatientService` with:
  - `get_patient_by_id(db, patient_id, clinic_id) -> Patient`
  - `update_patient_for_clinic(db, patient_id, clinic_id, ...) -> Patient`
- Extend `AppointmentService` with:
  - `list_appointments_for_patient(db, patient_id, clinic_id, status=None, upcoming_only=False) -> List[Dict]`

## Permissions
- **View patient details:** All clinic members (admin, practitioner, read-only)
- **Edit patient information:** Admin and Practitioner only
- **View appointments:** All clinic members
- **Edit appointments:** Same as existing appointment edit permissions

## UI/UX Considerations
- Back button to return to patients list
- Loading states for data fetching
- Error handling for failed updates
- Success notifications for edits
- Responsive design (mobile-friendly)
- Consistent styling with existing pages

## Open Questions
1. Should appointments be paginated? (Recommend: Yes, if > 50)
2. Should cancelled appointments show cancellation reason/note?
3. Should we show appointment count badges on tabs?
4. Should patient edit form be inline or modal? (Recommend: Inline for better UX)


# Patient Detail Page

## Overview
A dedicated page for viewing and editing patient information, along with viewing their appointment history (future, completed, and cancelled).

## User Flow
1. User clicks on a patient name in the Patients list page (`/admin/clinic/patients`)
2. Navigate to patient detail page (`/admin/clinic/patients/:id`)
3. View patient information and appointments
4. Click "Edit" button to toggle edit mode
5. Edit patient information (if permitted)

## Features

### Patient Information Section
- **Page header:** Patient's full name
- **Display fields:**
  - Full name
  - Phone number
  - Birthday (if available)
  - LINE user link (if linked)
  - Created date
- **Edit capability:**
  - "Edit" button to toggle edit mode
  - Inline edit form (edit directly on the page, not in a modal)
  - Editable fields: `full_name`, `phone_number`, `birthday`
  - Save/Cancel buttons (shown in edit mode)
  - Validation (same as patient creation)
- **Soft-deleted patients:**
  - **Detail page:** Display warning banner: "此病患已自行刪除帳號。病患無法自行預約，但診所仍可查看、編輯此病患資料，並為其安排預約。"
  - **List page:** Warning icon (⚠️) with tooltip next to patient name (tooltip shows full message)
  - Clinic can still view, edit, and schedule appointments for soft-deleted patients
  - LINE user will receive notifications for appointments scheduled by clinic

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
  - Notes (patient-provided notes shown for future appointments only)
  - Display-only (not clickable, not editable)
- **No pagination** - Show all appointments

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
- Includes `is_deleted` flag to indicate if patient was soft-deleted by LINE user

**GET /clinic/patients** (existing endpoint)
- Response should include `is_deleted` flag in `ClinicPatientResponse` for each patient
- Used to display warning indicator in patient list

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
- No pagination - returns all matching appointments

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
- **Edit appointments:** Not allowed on patient detail page (appointments are display-only)

## UI/UX Considerations
- Back button to return to patients list
- Loading states for data fetching
- Error handling for failed updates
- Success notifications for edits
- Responsive design (mobile-friendly)
- Consistent styling with existing pages

## Decisions
- **Navigation:** Click patient name in list to navigate to detail page
- **Edit mode:** "Edit" button toggles edit mode
- **Appointments:** Show all appointments (no pagination), display-only (not clickable)
- **Page header:** Patient's full name
- **Patient notes:** Display patient-provided notes for future appointments only
- **Cancellation notes:** Do not display cancellation reason/note for cancelled appointments
- **Edit form:** Inline editing (not modal)
- **Soft-deleted patients:** Warning icon with tooltip on list page, warning banner on detail page. Clinic can still view/edit/schedule appointments


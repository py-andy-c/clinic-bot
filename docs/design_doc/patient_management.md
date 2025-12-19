# Patient Management - Business Logic & Technical Design

## Overview

This document defines the business logic and technical design for patient management, including patient creation, editing, patient detail page, and appointment viewing.

---

## Key Business Logic

### 1. Patient Creation

**Manual Patient Creation** (Clinic Users):
- **Who**: Clinic admins and practitioners can create patients
- **Required Field**: Full name only
- **Optional Fields**: Phone number, Birthday (both always shown)
- **Phone Validation**: Only if provided (empty phone allowed)
- **Duplicate Phone Numbers**: Allowed (multiple patients can share same phone number)
- **Duplicate Name Detection**: Real-time warning as user types name (debounced, 400ms)
  - Exact name matching (case-insensitive)
  - Shows count of existing patients with same name
  - Non-blocking warning (does not prevent creation)

**Rationale**: Allows clinics to register walk-in patients, patients who don't use LINE, and patients who visit before setting up their LINE account.

### 2. Patient Detail Page

**Purpose**: Dedicated page for viewing and editing patient information, along with viewing their appointment history.

**Patient Information Section**:
- **Display Fields**: Full name, Phone number, Birthday (if available), LINE user link (if linked), Created date
- **Edit Capability**: 
  - "Edit" button toggles edit mode
  - Inline edit form (edit directly on the page, not in a modal)
  - Editable fields: `full_name`, `phone_number`, `birthday`
  - Save/Cancel buttons (shown in edit mode)
  - Validation (same as patient creation)

**Appointments Section**:
- **Three Tabs**: Future (upcoming confirmed), Completed (past confirmed), Cancelled (all cancelled)
- **Appointment Display**: Date and time, Practitioner name, Appointment type, Status badge, Notes (patient-provided notes shown for future appointments only)
- **Display-Only**: Appointments are not clickable, not editable on patient detail page
- **No Pagination**: Show all appointments

**Rationale**: Provides comprehensive patient view with appointment history, while keeping appointment editing on calendar/event modal.

### 3. Soft-Deleted Patients

**Scenario**: Patient deletes their own account via LIFF (soft delete).

**Behavior**:
- **Detail Page**: Display warning banner: "此病患已自行刪除帳號。病患無法自行預約，但診所仍可查看、編輯此病患資料，並為其安排預約。"
- **List Page**: Warning icon (⚠️) with tooltip next to patient name
- **Clinic Actions**: Clinic can still view, edit, and schedule appointments for soft-deleted patients
- **LINE Notifications**: LINE user will receive notifications for appointments scheduled by clinic

**Rationale**: Preserves clinic's ability to manage existing appointments and patient relationships even if patient deletes their account.

### 4. Patient Permissions

**View Patient Details**: All clinic members (admin, practitioner, read-only)

**Edit Patient Information**: Admin and Practitioner only (read-only users cannot edit)

**View Appointments**: All clinic members

**Edit Appointments**: Not allowed on patient detail page (appointments are display-only, editing happens on calendar/event modal)

**Rationale**: Maintains appropriate access control while allowing all clinic members to view patient information for coordination.

---

## Edge Cases

### 1. Duplicate Name Detection

**Scenario**: User types a name that matches existing patients.

**Behavior**: 
- Real-time warning as user types (debounced, 400ms)
- Exact name matching (case-insensitive)
- Shows count: "發現 {count} 位同名病患，請確認是否為重複建立"
- Non-blocking warning (does not prevent creation)
- Only checks when name field has value (2+ characters, trimmed)

**Rationale**: Helps prevent accidental duplicate creation while allowing legitimate duplicates (e.g., same name, different people).

### 2. Duplicate Phone Numbers

**Scenario**: Multiple patients share the same phone number.

**Behavior**: Allowed. No validation prevents this. Multiple patients can have the same phone number.

**Rationale**: Legitimate cases exist (family members sharing phone, business phone, etc.).

### 3. Empty Phone Number

**Scenario**: Patient created without phone number.

**Behavior**: Allowed. Phone number is optional. Patient can be created with name only.

**Rationale**: Some patients may not have phones or prefer not to provide them.

### 4. Patient Created in Another Tab

**Scenario**: Patient is created in another browser tab while user is viewing patient list.

**Behavior**: Refresh list when tab becomes active, or show notification that list may be out of date.

### 5. Patient Deleted While Viewing Detail Page

**Scenario**: Patient is soft-deleted (by themselves via LIFF) while clinic user is viewing detail page.

**Behavior**: Show warning banner immediately if `is_deleted` flag is detected. Clinic can still view and edit patient information.

---

## Technical Design

### Patient Creation Modal

**Location**: `frontend/src/components/PatientCreationModal.tsx`

**Fields**:
- Full Name (required, text input)
- Phone Number (optional, tel input, validated if provided)
- Birthday (optional, date picker)

**Validation**:
- Full name: Cannot be empty, max 255 characters
- Phone number: If provided, must be valid Taiwan phone number (10 digits, starts with 09)
- Birthday: If provided, must be valid date, cannot be in the future

**Success Flow**:
- Patient created → Modal closes → Success confirmation modal opens
- Success modal shows "新增預約" button to create appointment immediately
- User can close success modal or create appointment

**Rationale**: Provides quick patient creation with immediate appointment creation option.

### Patient Detail Page

**Route**: `/admin/clinic/patients/:id`

**Component**: `PatientDetailPage.tsx`

**API Endpoints**:
- `GET /clinic/patients/:id`: Get patient details
- `PUT /clinic/patients/:id`: Update patient information
- `GET /clinic/patients/:id/appointments`: Get appointments for patient (with optional `status` and `upcoming_only` query params)

**State Management**: Uses React Query for data fetching, local state for edit mode.

**Rationale**: Provides comprehensive patient view with efficient data fetching and state management.

### Duplicate Name Detection

**Endpoint**: `GET /clinic/patients/check-duplicate?name={name}`

**Implementation**: 
- Exact name matching (case-insensitive)
- Returns count of existing patients with same name
- Debounced on frontend (400ms delay after user stops typing)

**Rationale**: Helps prevent accidental duplicates while maintaining good UX (non-blocking, real-time feedback).

---

## Summary

This document covers:
- Patient creation (manual creation by clinic users, duplicate name detection)
- Patient detail page (information display/edit, appointment history with tabs)
- Soft-deleted patients (warning indicators, clinic can still manage)
- Patient permissions (view/edit access control)
- Edge cases (duplicate names, duplicate phones, empty phones, concurrent operations)
- Technical design (patient creation modal, patient detail page, duplicate detection API)

All business rules are enforced at both frontend (UX) and backend (source of truth) levels.


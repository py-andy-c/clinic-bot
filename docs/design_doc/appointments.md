# Appointments - Business Logic & Technical Design

## Overview

This document defines the business logic, permissions, and technical design for appointment management in the clinic system. It covers appointment creation, editing, cancellation, duplication, rescheduling, and recurring appointments.

---

## Key Business Logic

### 1. Auto-Assignment Visibility Principle

**Core Rule**: Auto-assigned practitioners **never know** about appointments until they are actually assigned (by admin or cron job).

- Auto-assigned appointments are **hidden** from practitioners:
  - Not visible on calendar page for any user (including admins)
  - Visible on patient detail page, but practitioner name hidden for non-admins
  - No LINE notifications sent
  - Practitioner is unaware of the appointment's existence
- This applies to:
  - Appointments created with "不指定" (no specific practitioner)
  - Appointments changed to "不指定" by patients
- Practitioners only become aware when:
  - Admin manually reassigns the appointment to them
  - Cron job automatically makes it visible at the recency limit (`minimum_booking_hours_ahead` hours before appointment)

**Rationale**: Allows clinic to review and reassign appointments without practitioners being prematurely notified.

### 2. Patient Perspective on Auto-Assignment

**Core Rule**: Patients who originally selected "不指定" **never know** about practitioner changes.

- Patients always see "不指定" as the practitioner name for auto-assigned appointments
- This remains true even if:
  - Admin reassigns to a specific practitioner
  - Admin reassigns to a different practitioner
  - System auto-assigns at recency limit
- Patients are **only notified** about:
  - Time changes (if time is modified)
  - Not about practitioner changes (since they still see "不指定")

**Rationale**: From the patient's perspective, they selected "不指定", so practitioner changes are internal clinic operations.

### 3. Booking Restrictions

**Core Rule**: **Clinic admins bypass all booking restrictions; patients must follow them.**

#### Clinic Admin Operations
- **No booking restrictions enforced**:
  - Can create appointments at any time (no `minimum_booking_hours_ahead` requirement)
  - Can create appointments beyond `max_booking_window_days`
  - Can exceed `max_future_appointments` limit
  - Can edit appointments without restriction checks
- **Must specify practitioner** (cannot use "不指定")

#### Patient Operations
- **All booking restrictions enforced**:
  - `minimum_booking_hours_ahead`: Must book/reschedule at least X hours in advance
  - `max_booking_window_days`: Cannot book more than X days in advance
  - `max_future_appointments`: Cannot exceed maximum number of future appointments
  - `minimum_cancellation_hours_before`: Must edit/cancel at least X hours before appointment
- **Practitioner is optional** (can select "不指定") unless `allow_patient_practitioner_selection = False`

**Rationale**: Clinic admins need flexibility for administrative purposes, while patients must follow clinic policies.

### 4. Appointment Type Settings

**`allow_patient_practitioner_selection`**: Controls whether patients can specify a practitioner when booking.

- **Default**: `True` (backward compatible)
- **When `False`**:
  - Patients cannot select practitioner during booking (step skipped in LIFF flow)
  - Appointments are auto-assigned (`is_auto_assigned = True`)
  - Patients cannot change practitioner during reschedule (can keep current if was manually assigned)
  - Backend validates and rejects practitioner changes if setting is `False`

**Rationale**: Some services require clinic to assign practitioners based on availability or expertise.

### 5. Receipt Constraints

**Critical Business Rules**:

1. **Previously Checked Out Appointments Cannot Be Modified**
   - If an appointment has **any receipt** (active or voided), it cannot be:
     - Deleted (enforced by database FK constraint `ON DELETE RESTRICT` and application validation)
     - Edited (all fields immutable: time, practitioner, appointment type, patient notes)
     - Rescheduled (time/practitioner changes blocked)
     - Cancelled (status change blocked)
   - **Exception**: Clinic notes (`clinic_notes`) can be updated even when receipts exist, as they are internal administrative notes that don't affect appointment details or accounting
   - Applies to both clinic users and patients
   - **Rationale**: Maintains accounting integrity and audit trail

2. **Cancelled Appointments Cannot Be Checked Out**
   - Cancelled appointments cannot have receipts created
   - Enforced in `ReceiptService.create_receipt()` (validates `status == "confirmed"`)
   - "Cancelled" includes both `canceled_by_patient` and `canceled_by_clinic` statuses

3. **Receipt Visibility**
   - **Patients**: Can only see **active receipts** (not voided)
   - **Clinic Users**: Can see **all receipts** (active and voided)

### 6. Appointment Creation

#### By Clinic
When a clinic admin creates an appointment on behalf of a patient:
- **Booking Constraints**: Does NOT enforce booking restrictions
- **Practitioner Requirements**: Must specify a practitioner (cannot use "不指定")
- **Notifications**: Both practitioner and patient receive LINE notifications

#### By Patient
When a patient creates an appointment through the LIFF interface:
- **Booking Constraints**: Must enforce all booking restrictions
- **Practitioner Selection**: 
  - Optional if `allow_patient_practitioner_selection = True` (can select "不指定")
  - Auto-assigned if `allow_patient_practitioner_selection = False` (step skipped)
- **Auto-Assignment Behavior**:
  - When patient selects "不指定" or setting is `False`:
    - System auto-assigns a temporary practitioner
    - Auto-assigned practitioner does NOT receive LINE notification
    - Auto-assigned practitioner does NOT see event on calendar
    - Patient receives LINE notification (shows "不指定" as practitioner name)
    - Appointment marked as `is_auto_assigned = True` and `originally_auto_assigned = True`

### 7. Appointment Editing

#### By Clinic
When a clinic admin edits an appointment:
- **Booking Constraints**: Does NOT enforce booking restrictions
- **Practitioner Requirements**: Must specify a practitioner (cannot use "不指定")
- **Auto-Assigned Appointment Reassignment**:
  - Old practitioner never knows about original assignment (was hidden)
  - New practitioner receives notification **as if patient made the appointment**
  - Reassignment is completely behind the scenes
  - After reassignment: `is_auto_assigned = False`, `reassigned_by_user_id` set to admin's user ID
- **Time Changes**:
  - If time changes: Patient is notified about time change
  - If only practitioner changes (time unchanged): Patient is NOT notified (still sees "不指定")
  - If both change: Patient is notified about time change only

#### By Patient
When a patient edits their appointment through LIFF:
- **Booking Constraints**: Must enforce all booking restrictions
  - `minimum_booking_hours_ahead`: Applies to the NEW appointment time
  - `minimum_cancellation_hours_before`: Applies to the CURRENT appointment time
- **Practitioner Selection**: 
  - Optional if `allow_patient_practitioner_selection = True`
  - Cannot change if `allow_patient_practitioner_selection = False` (can keep current)
- **Changing to "不指定"**:
  - `is_auto_assigned` set to `True`
  - If was previously manually assigned: Original practitioner receives cancellation notification
- **Changing to Specific Practitioner**:
  - Both new and old practitioner are notified
  - If was previously auto-assigned: Old practitioner never knew, stays silent
  - If was previously manually assigned: Old practitioner receives cancellation notification

### 8. Appointment Features

#### Duplication
**User Flow**:
1. User clicks "複製" (Duplicate) button in EventModal
2. `CreateAppointmentModal` opens with all fields pre-filled from original appointment
3. User can modify any field (especially date/time) before saving

**Data Mapping**:
- **Copied**: Patient ID, Appointment Type ID, Practitioner ID, Date/Time, Clinic Notes, Resources
- **NOT Copied**: Calendar Event ID, Appointment ID, Patient Notes, Status, Auto-assignment flags

**Permissions**: All visible appointments can be duplicated (no ownership check)

#### Rescheduling
**User Flow** (LIFF only):
1. Patient clicks "改期" (Reschedule) button on appointment card
2. Reschedule flow opens with existing appointment details pre-filled
3. Patient can change time and/or practitioner (if allowed)
4. Patient can edit notes
5. Confirmation step shows old vs new time comparison

**Constraints**:
- Must be at least `minimum_booking_hours_ahead` hours before NEW appointment time
- Must be at least `minimum_cancellation_hours_before` hours before CURRENT appointment time
- Cannot change practitioner if `allow_patient_practitioner_selection = False` (can keep current)
- Cannot reschedule if appointment has any receipt (active or voided)

#### Recurring Appointments
**User Flow**:
1. User enables "重複" (Repeat) toggle in `CreateAppointmentModal`
2. User selects pattern: "每 [x] 週, 共 [y] 次" (Every x weeks, y times)
3. System generates occurrences and checks for conflicts
4. User reviews conflicts and can delete/reschedule individual occurrences
5. User confirms and creates all occurrences

**Pattern**:
- Weekly recurrence only
- Maximum 50 occurrences
- Each occurrence is created in separate transaction (allows partial success)

**Resource Allocation**: Each occurrence gets its own resource allocation (independent selection)

**Notifications**: Consolidated notification sent after all occurrences are created (prevents duplicate notifications)

### 9. Permissions

#### View & Duplicate Permissions

| Context | Admin | Practitioner (Regular) | Practitioner (Auto-Assigned) |
|---------|-------|----------------------|----------------------------|
| **Calendar Page** | ✅ All visible appointments | ✅ All visible appointments | ❌ No (filtered by backend) |
| **Patient Detail Page** | ✅ All appointments | ✅ All appointments | ✅ All (shows "不指定") |

**Notes**:
- Duplicate permission is the same as View permission
- Calendar page: Auto-assigned appointments are filtered out by backend for ALL users (including admins)
- Patient detail page: All appointments visible, but `practitioner_id` is hidden for auto-assigned when user is not admin

#### Edit & Delete Permissions

| Context | Admin | Practitioner (Own, Regular) | Practitioner (Own, Auto-Assigned) | Practitioner (Others') |
|---------|-------|----------------------------|----------------------------------|----------------------|
| **Calendar Page** | ✅ Any appointment | ✅ Yes | ❌ No | ❌ No |
| **Patient Detail Page** | ✅ Any appointment | ✅ Yes | ❌ No | ❌ No |

**Notes**:
- Delete permission is always the same as Edit permission
- Admin: Can edit/delete any appointment
- Practitioner (Own, Regular): Can edit/delete own appointments that are not auto-assigned
- Practitioner (Own, Auto-Assigned): Cannot edit/delete auto-assigned appointments, even if assigned to them
- Practitioner (Others'): Cannot edit/delete other practitioners' appointments

---

## Backend Technical Design

### API Endpoints

#### `POST /clinic/appointments`
- **Description**: Create appointment on behalf of patient (clinic admin/practitioner)
- **Request Body**: `ClinicAppointmentCreateRequest` (patient_id, appointment_type_id, start_time, practitioner_id, clinic_notes, selected_resource_ids)
- **Response**: `{ success: true, appointment_id: number, message: string }`
- **Errors**: 
  - 403: Read-only users cannot create appointments
  - 400: Validation errors
  - 500: Internal server error

#### `POST /liff/appointments`
- **Description**: Create appointment by patient through LIFF interface
- **Request Body**: `AppointmentCreateRequest` (patient_id, appointment_type_id, start_time, practitioner_id (optional), notes)
- **Response**: `AppointmentResponse`
- **Errors**:
  - 400: Booking restrictions violated, validation errors
  - 404: Appointment type not found
  - 500: Internal server error

#### `PUT /clinic/appointments/{appointment_id}`
- **Description**: Update appointment (clinic admin/practitioner)
- **Request Body**: `ClinicAppointmentUpdateRequest` (appointment_type_id, practitioner_id, start_time, clinic_notes, selected_resource_ids)
- **Response**: `{ success: true, appointment_id: number, notification_preview: {...} }`
- **Errors**:
  - 403: Permission denied (practitioner trying to edit others' appointments or auto-assigned)
  - 400: Validation errors, receipt exists (cannot modify)
  - 404: Appointment not found
  - 409: Concurrent edit conflict
  - 500: Internal server error

#### `PUT /liff/appointments/{appointment_id}`
- **Description**: Update appointment by patient (reschedule)
- **Request Body**: `AppointmentUpdateRequest` (start_time, practitioner_id (optional), notes)
- **Response**: `AppointmentResponse`
- **Errors**:
  - 400: Booking restrictions violated, receipt exists, validation errors
  - 404: Appointment not found
  - 409: Concurrent edit conflict
  - 500: Internal server error

#### `DELETE /clinic/appointments/{appointment_id}`
- **Description**: Cancel appointment by clinic admin or practitioner
- **Query Parameters**: `note` (optional cancellation note)
- **Response**: `{ success: true, message: string }`
- **Errors**:
  - 403: Permission denied
  - 400: Receipt exists (cannot cancel)
  - 404: Appointment not found
  - 500: Internal server error

#### `POST /clinic/appointments/recurring`
- **Description**: Create recurring appointments
- **Request Body**: `RecurringAppointmentCreateRequest` (base appointment data, pattern: weeks_interval, occurrences)
- **Response**: `{ success: true, created_count: number, failed_count: number, appointments: [...] }`
- **Errors**:
  - 400: Validation errors, too many occurrences (>50)
  - 500: Internal server error

#### `POST /clinic/appointments/check-recurring-conflicts`
- **Description**: Preview conflicts for recurring appointments before creation
- **Request Body**: `CheckRecurringConflictsRequest` (base appointment data, pattern)
- **Response**: `{ conflicts: [...], occurrences: [...] }`
- **Errors**: 400, 500

#### `GET /clinic/appointments/resource-availability`
- **Description**: Get resource availability for a time slot
- **Query Parameters**: `appointment_type_id`, `practitioner_id`, `date`, `start_time`, `end_time`, `exclude_calendar_event_id` (optional)
- **Response**: `ResourceAvailabilityResponse`
- **Errors**: 400, 500

### Database Schema

**Appointments Table**:
- `id`: Primary key
- `clinic_id`: Foreign key to clinics
- `patient_id`: Foreign key to patients
- `appointment_type_id`: Foreign key to appointment_types
- `practitioner_id`: Foreign key to users (nullable, null = "不指定")
- `calendar_event_id`: Foreign key to calendar_events
- `start_time`: DateTime
- `end_time`: DateTime (calculated from appointment type duration)
- `status`: Enum ('confirmed', 'canceled_by_patient', 'canceled_by_clinic')
- `is_auto_assigned`: Boolean (True = hidden from practitioner)
- `originally_auto_assigned`: Boolean (historical flag, immutable)
- `reassigned_by_user_id`: Foreign key to users (nullable, set when admin reassigns)
- `notes`: Text (patient notes, for LIFF bookings)
- `clinic_notes`: Text (internal clinic notes)
- `created_at`: DateTime
- `updated_at`: DateTime

**Relationships**:
- One appointment → One calendar event
- One appointment → One patient
- One appointment → One appointment type
- One appointment → One practitioner (nullable)
- One appointment → Many receipts (ON DELETE RESTRICT)
- One appointment → Many appointment_resource_allocations

**Constraints**:
- Receipts have `ON DELETE RESTRICT` constraint (prevents deletion of appointments with receipts)
- Status must be 'confirmed' to create receipts
- Soft-deleted appointment types are allowed (appointments remain editable)

### Business Logic Implementation

**AppointmentService** (`backend/src/services/appointment_service.py`):
- `create_appointment()`: Creates appointment with auto-assignment logic, booking restrictions validation, resource allocation
- `update_appointment()`: Updates appointment with permission checks, booking restrictions (for patients), receipt validation
- `cancel_appointment()`: Cancels appointment with permission checks, receipt validation
- `create_recurring_appointments()`: Creates multiple appointments with conflict checking
- `check_recurring_conflicts()`: Previews conflicts for recurring appointments

**Key Business Logic**:
- Auto-assignment: When `practitioner_id` is None, system assigns temporary practitioner and sets `is_auto_assigned = True`
- Booking restrictions: Enforced for patients via `apply_booking_constraints` parameter
- Receipt validation: Checks for existing receipts before allowing edits/deletes
- Permission checks: Validates user role and ownership before allowing operations
- Concurrent edits: Uses database-level optimistic locking (`with_for_update(nowait=True)`)

**Recency Limit Automatic Assignment**:
- Background cron job (`backend/src/services/background_schedulers.py`)
- Automatically sets `is_auto_assigned = False` when appointment is within `minimum_booking_hours_ahead` hours
- Sends LINE notification to practitioner as if patient booked directly

---

## Frontend Technical Design

### State Management Strategy

#### Server State (API Data)
- [x] **Data Source**: Multiple API endpoints for appointments, practitioners, appointment types, resources, availability
- [x] **Current Implementation**: Using `useApiData` hook (795 lines, custom caching logic)
  - **Note**: Migration to React Query planned for Phase 2 (Weeks 3-5) per `ai_frontend_dev.md`
- [x] **Query Keys** (when migrated to React Query):
  - `['appointments', clinicId, filters]` - List appointments
  - `['appointment', appointmentId]` - Single appointment
  - `['practitioners', appointmentTypeId, clinicId]` - Available practitioners
  - `['appointment-types', clinicId]` - Appointment types
  - `['resources', appointmentTypeId, practitionerId, date, time]` - Resource availability
  - `['recurring-conflicts', ...]` - Recurring appointment conflicts
- [x] **Cache Strategy**:
  - **Current**: Custom cache with TTL (5 minutes default), clinic ID auto-injection
  - **Future (React Query)**: 
    - `staleTime`: 5 minutes (appointment data)
    - `staleTime`: 1 minute (availability data - changes frequently)
    - `cacheTime`: 10 minutes
    - Invalidation triggers: Appointment create/update/delete, clinic switch

#### Client State (UI State)
- [x] **Zustand Store**: `appointmentStore` (`frontend/src/stores/appointmentStore.ts`)
  - **State Properties**: 
    - Flow state (step, flowType)
    - Form data (appointmentTypeId, practitionerId, date, startTime, patientId, notes)
    - Clinic context (clinicId, clinicName, etc.)
    - Created appointment data
  - **Actions**: `setStep`, `setAppointmentType`, `setPractitioner`, `setDateTime`, `setPatient`, `setNotes`, etc.
  - **Usage**: LIFF appointment booking flow (multi-step)
- [x] **Local Component State**: 
  - `CreateAppointmentModal`: Modal open/close, step ('form' | 'review'), service item selection, recurring toggle
  - `EditAppointmentModal`: Modal open/close, step ('form' | 'review' | 'note' | 'preview'), preview message
  - `DateTimePicker`: Selected date/time, calendar view, conflicts
  - `EventModal`: Modal open/close, delete confirmation, receipt viewing

#### Form State
- [x] **React Hook Form**: Not used (custom form state management via `useAppointmentForm` hook)
- [x] **Custom Hook**: `useAppointmentForm` (`frontend/src/hooks/useAppointmentForm.ts`)
  - **Modes**: `'create' | 'edit' | 'duplicate'`
  - **State**: Selected patient, appointment type, practitioner, date, time, clinic notes, resources
  - **Validation**: Centralized validation logic
  - **Features**: Parallel initialization, AbortController cleanup, auto-deselection of dependent fields

### Component Architecture

#### Component Hierarchy
```
CalendarView
  ├── CreateAppointmentModal
  │   ├── useAppointmentForm (hook)
  │   ├── AppointmentReferenceHeader (for duplicate mode)
  │   ├── AppointmentTypeSelector
  │   ├── PractitionerSelector
  │   ├── DateTimePicker
  │   │   ├── CalendarView (month navigation)
  │   │   └── TimeSlotSelector
  │   ├── PatientSearchInput
  │   ├── ResourceSelection
  │   ├── ClinicNotesTextarea
  │   ├── RecurringAppointmentToggle
  │   └── ServiceItemSelectionModal
  ├── EditAppointmentModal
  │   ├── useAppointmentForm (hook)
  │   ├── AppointmentReferenceHeader
  │   ├── AppointmentTypeSelector
  │   ├── PractitionerSelector
  │   ├── DateTimePicker
  │   ├── ResourceSelection
  │   ├── ClinicNotesTextarea
  │   └── ServiceItemSelectionModal
  └── EventModal
      ├── AppointmentDetails
      ├── ReceiptViewer
      └── ActionButtons (Edit, Duplicate, Delete)

LiffApp (Patient Booking Flow)
  └── AppointmentFlow
      ├── Step1SelectPatient (or Step1SelectAppointmentType)
      ├── Step2SelectPractitioner (or Step2SelectAppointmentType)
      ├── Step3SelectDateTime
      ├── Step4SelectPatient (Flow 1 only)
      ├── Step5AddNotes
      └── Step6Confirmation
```

#### Component List
- [x] **CreateAppointmentModal** (`frontend/src/components/calendar/CreateAppointmentModal.tsx`)
  - **Props**: `preSelectedPatientId`, `preSelectedAppointmentTypeId`, `preSelectedPractitionerId`, `preSelectedTime`, `preSelectedClinicNotes`, `practitioners`, `appointmentTypes`, `onClose`, `onConfirm`, `event` (for duplication)
  - **State**: `step` ('form' | 'review'), form data via `useAppointmentForm`, service item selection, recurring toggle
  - **Dependencies**: `useAppointmentForm`, `useApiData`, `DateTimePicker`, `ResourceSelection`, `ServiceItemSelectionModal`

- [x] **EditAppointmentModal** (`frontend/src/components/calendar/EditAppointmentModal.tsx`)
  - **Props**: `event`, `practitioners`, `appointmentTypes`, `onClose`, `onComplete`, `onConfirm`
  - **State**: `step` ('form' | 'review' | 'note' | 'preview'), form data via `useAppointmentForm`, preview message
  - **Dependencies**: `useAppointmentForm`, `useApiData`, `DateTimePicker`, `ResourceSelection`, `NotificationModal`

- [x] **EventModal** (`frontend/src/components/calendar/EventModal.tsx`)
  - **Props**: `event`, `onClose`, `onEdit`, `onDuplicate`, `onDelete`, `onReceiptCreated`
  - **State**: Delete confirmation, receipt viewing
  - **Dependencies**: `appointmentPermissions` utilities, receipt components

- [x] **DateTimePicker** (`frontend/src/components/calendar/DateTimePicker.tsx`)
  - **Props**: `selectedDate`, `selectedTime`, `onDateChange`, `onTimeChange`, `appointmentTypeId`, `practitionerId`, `excludeEventId`, `initialDate`
  - **State**: Calendar view (month/year), time slots, conflicts, availability loading
  - **Dependencies**: `useApiData` (availability), `useDateSlotSelection`, availability cache utilities

- [x] **useAppointmentForm** (`frontend/src/hooks/useAppointmentForm.ts`)
  - **Props**: `mode`, `event`, `appointmentTypes`, `practitioners`, `initialDate`, pre-selected fields
  - **State**: All form fields (patient, appointment type, practitioner, date, time, notes, resources)
  - **Dependencies**: `useApiData` (practitioners, resources, availability), `useState`, `useEffect`, `AbortController`

- [x] **AppointmentFlow** (`frontend/src/liff/appointment/AppointmentFlow.tsx`) - LIFF multi-step flow
  - **Props**: Clinic context, onComplete
  - **State**: Current step, form data via `appointmentStore`
  - **Dependencies**: `appointmentStore`, step components

### User Interaction Flows

#### Flow 1: Create Appointment (Clinic Admin)
1. User clicks "新增預約" button on calendar
2. `CreateAppointmentModal` opens
3. User selects patient (search or create new)
4. User selects appointment type
5. System fetches available practitioners for selected appointment type
6. User selects practitioner (required for admins)
7. User selects date and time
8. System checks availability and shows conflicts
9. User selects resources (if required by appointment type)
10. User adds clinic notes (optional)
11. User clicks "確認" → Review step
12. User confirms → Appointment created
13. Success message shown, modal closes, calendar refreshes
   - **Edge case**: Recurring appointments → Additional steps for pattern selection and conflict review
   - **Error case**: API error → Error message shown, user can retry

#### Flow 2: Edit Appointment (Clinic Admin)
1. User clicks appointment on calendar → `EventModal` opens
2. User clicks "編輯" button
3. `EditAppointmentModal` opens with current appointment data pre-filled
4. User modifies fields (practitioner, time, appointment type, resources, clinic notes)
5. System validates changes and checks conflicts
6. User clicks "下一步" → Review step shows changes
7. User clicks "確認更動" → Appointment updated
8. Backend returns `notification_preview`
9. `NotificationModal` opens (user can send notification or skip)
10. Success message shown, modal closes, calendar refreshes
   - **Edge case**: Receipt exists → Edit blocked, error message shown
   - **Edge case**: Concurrent edit → Conflict error (409), error message shown
   - **Error case**: Validation error → Field-level errors shown

#### Flow 3: Duplicate Appointment
1. User clicks appointment → `EventModal` opens
2. User clicks "複製" button
3. `CreateAppointmentModal` opens with all fields pre-filled from original
4. User modifies date/time (typically) or other fields
5. User clicks "確認" → New appointment created
   - **Edge case**: Auto-assigned appointment → Practitioner field hidden for non-admins

#### Flow 4: Patient Booking (LIFF)
1. Patient opens LIFF app → `AppointmentFlow` starts
2. **Flow 1**: Select appointment type → Select practitioner (if allowed) → Select date/time → Select patient → Add notes → Confirm
3. **Flow 2**: Select patient → Select appointment type → Select practitioner (if allowed) → Select date/time → Add notes → Confirm
4. System validates booking restrictions at each step
5. Patient confirms → Appointment created
6. Success screen shown
   - **Edge case**: `allow_patient_practitioner_selection = False` → Practitioner step skipped, auto-assigned
   - **Error case**: Booking restriction violated → Error message shown, user cannot proceed

#### Flow 5: Patient Reschedule (LIFF)
1. Patient views appointment list → Clicks "改期" on appointment card
2. Reschedule flow opens with current appointment data
3. Patient changes time and/or practitioner (if allowed)
4. Patient edits notes (optional)
5. Confirmation step shows old vs new time comparison
6. Patient confirms → Appointment updated
7. Success message shown
   - **Edge case**: Receipt exists → Reschedule blocked, error message shown
   - **Edge case**: New time violates booking restrictions → Error message shown

#### Flow 6: Recurring Appointments
1. User enables "重複" toggle in `CreateAppointmentModal`
2. User selects pattern: "每 [x] 週, 共 [y] 次"
3. User clicks "確認" → System calls `/clinic/appointments/check-recurring-conflicts`
4. Conflict review modal shows all occurrences with conflicts highlighted
5. User can delete individual occurrences or modify them
6. User confirms → System calls `/clinic/appointments/recurring`
7. Appointments created one by one (partial success allowed)
8. Success message shows created/failed counts
   - **Edge case**: Too many occurrences (>50) → Error message shown
   - **Edge case**: All occurrences have conflicts → User can still create (with warnings)

### Edge Cases and Error Handling

#### Edge Cases
- [x] **Race Condition**: User switches clinic during data fetch
  - **Solution**: `useApiData` includes clinic ID in cache keys, automatically refetches on clinic switch
  - **Future (React Query)**: Query invalidation on clinic switch

- [x] **Concurrent Updates**: Admin and patient edit same appointment simultaneously
  - **Solution**: Backend uses optimistic locking (`with_for_update(nowait=True)`), returns 409 conflict
  - **Frontend**: Shows error message, user can retry

- [x] **Clinic Switching**: User switches clinic while appointment modal is open
  - **Solution**: Modal should close or show warning, data refetches with new clinic context

- [x] **Component Unmount**: Component unmounts during async operation (availability fetch, appointment creation)
  - **Solution**: `useAppointmentForm` uses `AbortController` to cancel in-flight requests, checks `isMountedRef` before state updates

- [x] **Network Failure**: API call fails (network error, timeout)
  - **Solution**: Error message shown to user, retry option available
  - **Implementation**: `useApiData` handles errors, shows user-friendly messages

- [x] **Stale Data**: User views appointment, another user modifies it, first user tries to edit
  - **Solution**: Backend optimistic locking prevents concurrent edits, returns 409 if conflict detected

- [x] **Auto-Assigned Practitioner Becomes Inactive**: Practitioner is deactivated after appointment is auto-assigned
  - **Solution**: Backend re-assigns to available practitioner when cron job processes recency limit, or when patient tries to edit

- [x] **Appointment Type Soft-Deleted**: Appointment type is soft-deleted after appointment is created
  - **Solution**: Appointment remains editable, UI shows "已刪除服務類型" as display name

- [x] **Receipt Created After Modal Opens**: User opens edit modal, another user creates receipt, first user tries to save
  - **Solution**: Backend validates receipt existence before allowing save, returns error if receipt exists

#### Error Scenarios
- [x] **API Errors (4xx, 5xx)**:
  - **User Message**: User-friendly error messages extracted from API response
  - **Recovery Action**: User can retry operation, or cancel and try again
  - **Implementation**: `getErrorMessage()` utility extracts messages, `useApiData` displays them

- [x] **Validation Errors**:
  - **User Message**: Field-level error messages (e.g., "請選擇病患", "請選擇時間")
  - **Field-level Errors**: Shown inline next to form fields
  - **Implementation**: `useAppointmentForm` validation logic, form shows errors

- [x] **Loading States**:
  - **Initial Load**: `AppointmentFormSkeleton` shown while fetching practitioners/resources
  - **Refetch**: Loading spinner shown during availability checks
  - **Mutation**: Submit button disabled, loading spinner shown during create/update
  - **Implementation**: `useApiData` provides `loading` state, components show spinners

- [x] **Permission Errors (403)**:
  - **User Message**: "您沒有權限執行此操作"
  - **Recovery Action**: User cannot proceed, must contact admin
  - **Implementation**: Backend returns 403, frontend shows error message

- [x] **Conflict Errors (409)**:
  - **User Message**: "此預約已被其他使用者修改，請重新整理後再試"
  - **Recovery Action**: User can refresh and try again
  - **Implementation**: Backend optimistic locking, frontend handles 409 status

- [x] **Receipt Exists Error**:
  - **User Message**: "此預約已有收據，無法修改"
  - **Recovery Action**: User can only edit clinic notes (if allowed)
  - **Implementation**: Backend validates receipt existence, frontend shows specific error message

### Testing Requirements

#### E2E Tests (Playwright)
- [ ] **Test Scenario**: Create appointment flow (clinic admin)
  - Steps: 
    1. Login as admin
    2. Navigate to calendar
    3. Click "新增預約"
    4. Select patient, appointment type, practitioner, date/time
    5. Add clinic notes
    6. Click "確認"
    7. Verify appointment appears in calendar
  - Assertions: Appointment created successfully, appears in calendar, correct data displayed
  - Edge cases: Test with recurring appointments, test with resource requirements

- [ ] **Test Scenario**: Edit appointment flow (clinic admin)
  - Steps:
    1. Login as admin
    2. Click existing appointment
    3. Click "編輯"
    4. Modify practitioner and time
    5. Click "確認更動"
    6. Send notification (or skip)
  - Assertions: Appointment updated, changes reflected in calendar, notification sent (if chosen)
  - Edge cases: Test with receipt exists (should block), test concurrent edit (should show conflict)

- [ ] **Test Scenario**: Duplicate appointment flow
  - Steps:
    1. Click appointment
    2. Click "複製"
    3. Modify date/time
    4. Click "確認"
  - Assertions: New appointment created with copied data, original unchanged

- [ ] **Test Scenario**: Patient booking flow (LIFF)
  - Steps:
    1. Open LIFF app
    2. Navigate to booking flow
    3. Complete all steps (appointment type, practitioner, date/time, patient, notes)
    4. Confirm
  - Assertions: Appointment created, success screen shown, booking restrictions enforced
  - Edge cases: Test with `allow_patient_practitioner_selection = False` (practitioner step skipped)

- [ ] **Test Scenario**: Patient reschedule flow (LIFF)
  - Steps:
    1. View appointment list
    2. Click "改期" on appointment
    3. Change time
    4. Confirm
  - Assertions: Appointment updated, old vs new time shown in confirmation
  - Edge cases: Test with receipt exists (should block), test booking restrictions

- [ ] **Test Scenario**: Recurring appointments flow
  - Steps:
    1. Create appointment with "重複" enabled
    2. Select pattern (e.g., every 2 weeks, 5 times)
    3. Review conflicts
    4. Confirm creation
  - Assertions: All occurrences created (or partial success shown), conflicts highlighted

#### Integration Tests (MSW)
- [ ] **Test Scenario**: Appointment form initialization
  - Mock API responses: Practitioners, resources, availability
  - User interactions: Open modal, select appointment type
  - Assertions: Practitioners loaded, resources loaded, availability checked

- [ ] **Test Scenario**: Appointment creation with validation
  - Mock API responses: Success response
  - User interactions: Fill form, submit
  - Assertions: Validation errors shown for missing fields, API called with correct data on submit

- [ ] **Test Scenario**: Error handling
  - Mock API responses: 400, 403, 409, 500 errors
  - User interactions: Submit form, trigger errors
  - Assertions: Appropriate error messages shown, user can retry

- [ ] **Test Scenario**: Clinic switching during form
  - Mock API responses: Different data for different clinics
  - User interactions: Open form, switch clinic
  - Assertions: Form data refetches, cache invalidated

#### Unit Tests
- [ ] **Component**: `CreateAppointmentModal`
  - Test cases: Renders correctly, handles form submission, shows validation errors, handles API errors
- [ ] **Component**: `EditAppointmentModal`
  - Test cases: Pre-fills form data, shows changes in review step, handles concurrent edit errors
- [ ] **Hook**: `useAppointmentForm`
  - Test cases: Initializes correctly for each mode, handles field dependencies, validates form, cancels requests on unmount
- [ ] **Utility**: `appointmentPermissions.ts`
  - Test cases: `canEditAppointment()` returns correct permissions, `canDuplicateAppointment()` works correctly

### Performance Considerations

- [x] **Data Loading**: 
  - Parallel initialization in `useAppointmentForm` (practitioners and resources fetched together)
  - Debounced availability checks in `DateTimePicker` (prevents excessive API calls)
  - Caching of availability data (5-minute TTL)

- [x] **Caching**: 
  - Current: Custom cache with clinic ID injection, TTL-based invalidation
  - Future: React Query will provide better caching with automatic invalidation

- [x] **Optimistic Updates**: 
  - Not currently used (planned for React Query migration)
  - Appointment creation/update waits for server response

- [x] **Lazy Loading**: 
  - Service item selection modal loaded on demand
  - Recurring appointment conflict review loaded on demand

- [x] **Memoization**: 
  - `CreateAppointmentModal` and `EditAppointmentModal` wrapped in `React.memo`
  - `DateTimePicker` uses `useMemo` for expensive calculations (calendar days, time slots)

---

## Integration Points

### Backend Integration
- [x] **Dependencies on other services**:
  - `AppointmentService` depends on `AvailabilityService`, `ResourceService`, `NotificationService`, `ReceiptService`
  - Appointment creation triggers LINE notifications via `NotificationService`
  - Resource allocation handled by `ResourceService`
  - Receipt validation via `ReceiptService`

- [x] **Database relationships**:
  - Appointments linked to patients, appointment types, practitioners, calendar events, receipts, resources
  - Foreign key constraints enforce data integrity

- [x] **API contracts**:
  - RESTful API with consistent request/response models
  - Error responses follow standard format

### Frontend Integration
- [x] **Shared components used**:
  - `BaseModal`, `SearchInput`, `LoadingSpinner`, `ErrorDisplay`, `ClinicNotesTextarea`
  - `ResourceSelection`, `ServiceItemSelectionModal`
  - `NotificationModal`, `PractitionerAssignmentPromptModal`

- [x] **Shared hooks used**:
  - `useApiData` (data fetching)
  - `useAuth` (authentication context)
  - `useModal`, `useModalQueue` (modal management)
  - `useIsMobile` (responsive design)

- [x] **Shared stores used**:
  - `appointmentStore` (LIFF booking flow only)
  - No shared stores for clinic admin flows (uses local component state)

- [x] **Navigation/routing changes**:
  - Calendar page: `/calendar` (clinic admin)
  - LIFF booking: `/liff/book` (patient)
  - LIFF reschedule: `/liff/reschedule/:appointmentId` (patient)

---

## Security Considerations

- [x] **Authentication requirements**:
  - Clinic admin endpoints require `require_practitioner_or_admin` dependency
  - LIFF endpoints require valid LINE user token

- [x] **Authorization checks**:
  - Practitioners can only edit/delete their own appointments (not auto-assigned)
  - Admins can edit/delete any appointment
  - Backend validates permissions before allowing operations

- [x] **Input validation**:
  - All API requests validated using Pydantic models
  - Frontend validates form data before submission
  - Date/time validation ensures valid formats and ranges

- [x] **XSS prevention**:
  - User input sanitized before display
  - React automatically escapes content

- [x] **CSRF protection**:
  - API uses authentication tokens (JWT for clinic users, LINE tokens for patients)
  - Tokens validated on every request

- [x] **Data isolation**:
  - Clinic isolation enforced via `ensure_clinic_access()` dependency
  - Users can only access appointments in their active clinic
  - LIFF users automatically scoped to their clinic via token

---

## Summary

This document covers:
- Core business logic for appointment creation, editing, and cancellation
- Auto-assignment visibility and notification rules
- Booking restrictions (clinic admins bypass, patients must follow)
- Receipt constraints (previously checked out appointments cannot be modified)
- Appointment features (duplication, rescheduling, recurring)
- Permissions (view, edit, delete, duplicate)
- Edge cases (inactive practitioners, soft-deleted types, cancelled appointments, concurrent edits)
- Backend technical design (API endpoints, database schema, business logic)
- Frontend technical design (state management, components, user flows, testing requirements)

All business rules are enforced at both frontend (UX) and backend (source of truth) levels.

**Migration Status**: This document has been migrated to the new template format. Frontend sections reflect current implementation using `useApiData`. React Query migration is planned for Phase 2 (Weeks 3-5) per `ai_frontend_dev.md`.

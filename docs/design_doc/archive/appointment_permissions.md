# Appointment Permissions

This document defines the permission rules for viewing, editing, deleting, and duplicating appointments across different contexts.

## Contexts

- **Calendar Page**: Appointments displayed on the practitioner's calendar view
- **Patient Detail Page**: Appointments listed on a patient's detail page

## User Roles

- **Admin**: Clinic administrator with full permissions
- **Practitioner**: Non-admin clinic user (practitioner role)

## Appointment States

- **Own**: Appointment assigned to the current practitioner (`practitioner_id === user_id`)
- **Others'**: Appointment assigned to a different practitioner
- **Auto-Assigned**: Appointment with `is_auto_assigned = True` (hidden from practitioners until made visible)

## Permission Rules

### View & Duplicate Permissions

| Context | Admin | Practitioner (Regular) | Practitioner (Auto-Assigned) |
|---------|-------|------------------------|----------------------------|
| **Calendar Page** | ✅ All visible appointments | ✅ All visible appointments (own + others') | ❌ No (filtered by backend) |
| **Patient Detail Page** | ✅ All appointments | ✅ All appointments | ✅ All (shows "不指定" as practitioner) |

**Notes:**
- **Duplicate permission is the same as View permission** (see exception below)
- **"Practitioner (Regular)"**: Appointments that are not auto-assigned (`is_auto_assigned = False`)
- **"Practitioner (Auto-Assigned)"**: What happens when a practitioner encounters an auto-assigned appointment (`is_auto_assigned = True`)
- **Calendar page**: 
  - **Auto-assigned appointments are filtered out by backend for ALL users (including admins)** - they never appear on the calendar view
  - Admins can view auto-assigned appointments through the separate "Pending Review Appointments" page (`/pending-review-appointments`)
  - Practitioners can view other practitioners' appointments (via `additionalPractitionerIds`)
  - "All visible" means all appointments that appear on the calendar (excludes auto-assigned for everyone)
- **Patient detail page**: 
  - All appointments are visible to all users
  - For auto-assigned appointments when user is not admin:
    - Practitioner name displays as "不指定" (not specified)
    - `practitioner_id` is `null` in API response
    - **When duplicating**: `practitioner_id` field will not be populated in the form (same as view behavior)

### Edit & Delete Permissions

| Context | Admin | Practitioner (Own, Regular) | Practitioner (Own, Auto-Assigned) | Practitioner (Others') |
|---------|-------|----------------------------|----------------------------------|----------------------|
| **Calendar Page** | ✅ Any appointment | ✅ Yes | ❌ No | ❌ No |
| **Patient Detail Page** | ✅ Any appointment | ✅ Yes | ❌ No | ❌ No |

**Notes:**
- **Delete permission is always the same as Edit permission**
- **Admin**: Can edit/delete any appointment
- **Practitioner (Own, Regular)**: Can edit/delete own appointments that are not auto-assigned (`practitioner_id === user_id` AND `is_auto_assigned = False`)
- **Practitioner (Own, Auto-Assigned)**: Cannot edit/delete auto-assigned appointments, even if assigned to them (`practitioner_id === user_id` BUT `is_auto_assigned = True`)
- **Practitioner (Others')**: Cannot edit/delete other practitioners' appointments (`practitioner_id !== user_id`)

## Implementation Notes

### Backend Filtering

- **Calendar API** (`/practitioners/{user_id}/availability/calendar` and `/practitioners/calendar/batch`): 
  - Filters out appointments where `is_auto_assigned = True` for **ALL users (including admins)**
  - Admins can access auto-assigned appointments through the separate `/pending-review-appointments` endpoint
- **Patient appointments API** (`/patients/{patient_id}/appointments`): 
  - Returns all appointments but hides `practitioner_id` for auto-assigned when user is not admin

### Frontend Permission Checks

- **Edit/Delete**: 
  - Use `canEditAppointment(event, userId, isAdmin)` utility function
  - Checks `is_auto_assigned` flag - practitioners cannot edit/delete auto-assigned appointments
  - Checks ownership - practitioners can only edit/delete own appointments
- **Duplicate**: 
  - Use `canDuplicateAppointment(event)` utility function
  - No ownership check - all visible appointments can be duplicated
  - Returns `true` if event is an appointment (all visible appointments can be duplicated)
- **View**: 
  - Backend handles filtering for calendar page (auto-assigned filtered out for all users)
  - Frontend handles `practitioner_id` hiding for patient detail page (null for auto-assigned when user is not admin)

### Code Sharing

**Implementation**: Shared utility functions are implemented in `frontend/src/utils/appointmentPermissions.ts`:
- `canEditAppointment(event, userId, isAdmin)`: Returns true if user can edit/delete the appointment
- `canDuplicateAppointment(event)`: Returns true if appointment can be duplicated (all visible appointments)

Both `CalendarView` and `PatientAppointmentsList` components import and use these shared functions, ensuring consistent permission logic across the application.


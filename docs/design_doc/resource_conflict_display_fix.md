# Design Document: Fix Resource Data Propagation

## 1. Overview
This document outlines fixes for resource data propagation issues in the appointment scheduling system. The problems prevent users from seeing specific resource conflict details and cause selected resources to not be saved in certain UI flows.

## 2. Problem Statement

Three categories of issues were identified:

### Issue #1: Generic Conflict Warnings in EventModal
**Symptom**: When viewing an existing appointment in `EventModal`, resource conflicts show as generic quantity shortages (e.g., "資源選擇：治療室（需要 1 個，只選了 0 個）") instead of specific overlap details (e.g., "治療室 A 已被 陳醫師 使用").

**Root Cause**: `EventModal.tsx` (lines 100-108) calls the conflict check API without passing the appointment's `selected_resource_ids`, causing the backend to perform a general capacity check instead of validating the specific allocated resources.

**Impact**: Users cannot see which specific resource is causing a conflict or who is occupying it, making it impossible to make informed decisions about resource reallocation or double-booking.

---

### Issue #2: Resource Data Not Saved
**Symptom**: In certain appointment creation flows, users can select resources in the modal UI, but those selections are not persisted to the database.

**Root Cause**: The `onConfirm` handlers in these components omit the `selectedResourceIds` parameter when calling the mutation, even though the mutation accepts it and the form data contains it.

**Affected Components**:

| **Entry Point** | **Component** | **Function** | **Issue** |
|----------------|---------------|--------------|-----------|
| Patients Page (Row "新增預約") | `PatientsPage.tsx` | `onConfirm` callback (line 509) | Omits `selectedResourceIds: formData.selected_resource_ids` |
| Patient Detail (新增預約) | `PatientDetailPage.tsx` | `onConfirm` callback (line 197) | Omits `selectedResourceIds: formData.selected_resource_ids` |
| Patient Appointments List (Duplicate) | `PatientAppointmentsList.tsx` | `handleCreateAppointmentConfirm` (line 426) | Omits `selectedResourceIds: formData.selected_resource_ids` |

**Impact**: Resources selected by users are silently discarded, leading to appointments being created without resource allocations. This breaks resource scheduling and causes confusing "missing resource" warnings on subsequent views.

---

### Issue #3: Resource Data Not Mapped for Display
**Symptom**: When viewing an appointment from the Revenue Distribution page, the `EventModal` shows "0/1 selected" warnings even though resources are allocated to the appointment in the database.

**Root Cause**: `RevenueDistributionPage.tsx` (line 326-343) manually constructs a `CalendarEvent` object but omits the `resource_ids` and `resource_names` fields when mapping data from the API response.

**Note**: The backend API (`/clinic/appointments/{id}`, lines 1299-1328 in `appointments.py`) DOES return `resource_ids` and `resource_names` via the `AppointmentListItem` model. The frontend just doesn't map these fields.

**Impact**: Same as Issue #1 - users see generic warnings instead of actual resource allocation status.

---

## 3. Solution

All three issues are simple data propagation fixes - no backend changes or architectural changes needed.

### Fix #1: Pass `selected_resource_ids` in EventModal Conflict Check

**File**: `frontend/src/components/calendar/EventModal.tsx`  
**Location**: Lines 100-108

**Change**:
```typescript
const result = await apiService.checkBatchPractitionerConflicts({
  practitioners: [{
    user_id: event.resource.practitioner_id!,
    exclude_calendar_event_id: event.resource.calendar_event_id
  }],
  date: dateStr,
  start_time: timeStr,
  appointment_type_id: event.resource.appointment_type_id!,
  selected_resource_ids: event.resource.resource_ids || [],  // ADD THIS LINE
});
```

**Expected Result**: `EventModal` will display specific resource conflicts like "治療室 A 已被 陳醫師 使用 (14:00-15:00)" instead of "需要 1 個，只選了 0 個".

---

### Fix #2: Add `selectedResourceIds` Parameter to Mutation Calls

#### 2a. PatientsPage.tsx
**Location**: Line 509

**Change**:
```typescript
await createAppointmentMutation.mutateAsync({
  practitionerId: formData.practitioner_id,
  appointmentTypeId: formData.appointment_type_id,
  date,
  startTime,
  patientId: formData.patient_id,
  selectedResourceIds: formData.selected_resource_ids,  // ADD THIS LINE
  ...(formData.clinic_notes && { clinicNotes: formData.clinic_notes }),
});
```

#### 2b. PatientDetailPage.tsx
**Location**: Line 197

**Change**: Same as 2a - add `selectedResourceIds: formData.selected_resource_ids` to the mutation call.

#### 2c. PatientAppointmentsList.tsx
**Location**: Line 426 (`handleCreateAppointmentConfirm`)

**Change**: Same as 2a - add `selectedResourceIds: formData.selected_resource_ids` to the mutation call.

**Expected Result**: Resources selected in the modal UI will be persisted to the database via the create appointment API.

---

### Fix #3: Map Resource Data in RevenueDistributionPage

**File**: `frontend/src/pages/dashboard/RevenueDistributionPage.tsx`  
**Location**: Lines 326-343 (`handleViewAppointment`)

**Change**:
```typescript
const resource: CalendarEvent['resource'] = {
  type: 'appointment',
  calendar_event_id: appointmentData.calendar_event_id,
  appointment_id: appointmentData.calendar_event_id,
  patient_id: appointmentData.patient_id,
  patient_name: appointmentData.patient_name,
  practitioner_id: appointmentData.practitioner_id,
  practitioner_name: appointmentData.practitioner_name,
  appointment_type_id: appointmentData.appointment_type_id,
  appointment_type_name: appointmentData.appointment_type_name,
  status: appointmentData.status,
  is_auto_assigned: appointmentData.is_auto_assigned,
  originally_auto_assigned: appointmentData.originally_auto_assigned,
  has_active_receipt: appointmentData.has_active_receipt,
  has_any_receipt: appointmentData.has_any_receipt,
  receipt_id: appointmentData.receipt_id || null,
  receipt_ids: appointmentData.receipt_ids || EMPTY_ARRAY,
  resource_ids: appointmentData.resource_ids || [],        // ADD THIS LINE
  resource_names: appointmentData.resource_names || [],    // ADD THIS LINE
};
```

**Expected Result**: Viewing appointments from Revenue Distribution page will correctly display allocated resources and their conflict status.

---

## 4. Components Already Working Correctly

These components do NOT need changes (for reference/verification):

| **Entry Point** | **Component** | **Status** |
|----------------|---------------|-----------|
| Calendar (Drag/Click) | `Calendar.tsx` | ✅ Correctly handles all resource data |
| Patient Appointments List (Edit) | `PatientAppointmentsList.tsx` (`handleEditConfirm`) | ✅ Passes full `formData` including `selected_resource_ids` |
| Auto-Assigned Appointments | `AutoAssignedAppointmentsPage.tsx` | ✅ Correctly maps `resource_ids` and `resource_names` (lines 221-222) |

---

## 5. Testing Checklist

After implementing the fixes, verify:

1. **EventModal Specific Conflicts**:
   - [ ] Create appointment with Room A allocated
   - [ ] View the appointment in `EventModal`
   - [ ] Verify conflict message shows "治療室 A 已被 [practitioner name] 使用" instead of "需要 1 個，只選了 0 個"

2. **Resource Saving - PatientsPage**:
   - [ ] From Patients page, click "新增預約" on a patient row
   - [ ] Select resources in the modal
   - [ ] Create appointment
   - [ ] View appointment → verify resources are saved

3. **Resource Saving - PatientDetailPage**:
   - [ ] Navigate to a patient detail page
   - [ ] Click "新增預約"
   - [ ] Select resources in the modal
   - [ ] Create appointment
   - [ ] View appointment → verify resources are saved

4. **Resource Saving - Duplicate**:
   - [ ] From a patient's appointment list, click duplicate
   - [ ] Modify selected resources
   - [ ] Create appointment
   - [ ] View appointment → verify NEW resource selection is saved (not the old one)

5. **Revenue Distribution Mapping**:
   - [ ] Go to Revenue Distribution page
   - [ ] Click "檢視預約" on any appointment with allocated resources
   - [ ] Verify the EventModal shows correct resource allocation info

---

## 6. Implementation Notes

- All fixes are frontend-only changes
- No database migrations needed
- No backend API changes needed
- The mutation hook `useCreateAppointmentOptimistic` (line 139 in `useAvailabilitySlots.ts`) already accepts `selectedResourceIds` parameter
- The backend already returns `resource_ids` and `resource_names` in all necessary endpoints
- These are purely frontend data mapping/propagation issues

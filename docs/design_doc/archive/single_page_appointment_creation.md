# Single-Page Appointment Creation Design

## Overview

Convert the multi-step appointment creation flow to a single-page form, similar to the edit appointment modal. This simplifies the UX and makes all selections visible at once.

## Goals

1. **Simplify UX**: Replace multi-step flow with single-page form
2. **Code Reuse**: Share code structure with `EditAppointmentModal` where possible
3. **Auto-filling**: Support pre-selected patient when opened from patients/patient detail pages
4. **Conditional Dropdowns**: Implement dependency chains (appointment type → practitioner → date/time)

## Current State

### CreateAppointmentModal (Multi-step)
- Steps: `patient` → `appointmentType` → `practitioner` → `datetime` → `confirm`
- Auto-advances on each selection
- Each step shows only one field at a time

### EditAppointmentModal (Single-page)
- All fields visible in one form: patient (read-only), appointment type (read-only), practitioner dropdown, date/time picker, clinic notes
- Uses `DateTimePicker` component for date/time selection
- Conditional logic: time slots depend on practitioner + appointment type

## Proposed Changes

### 1. Component Structure

**Refactor `CreateAppointmentModal` to single-page form:**
- Remove step-based navigation
- Display all fields on one page (similar to `EditAppointmentModal.renderFormStep()`)
- Keep patient search/selection at top (or auto-fill if `preSelectedPatientId` provided)
- Show appointment type, practitioner, date/time, and clinic notes fields together

**Shared Components:**
- Reuse `DateTimePicker` component (already used by both modals)
- Extract common form field components if needed
- Share validation logic

### 2. Conditional Dropdown Logic

**Practitioner Filtering:**
- When appointment type is selected, fetch practitioners filtered by appointment type
- Backend: Update `/clinic/practitioners` endpoint to accept optional `appointment_type_id` query parameter
- Frontend: Update `apiService.getPractitioners()` to accept optional `appointment_type_id`
- If appointment type changes, clear selected practitioner if it's no longer valid

**Date/Time Filtering:**
- `DateTimePicker` already handles this: requires both `appointmentTypeId` and `selectedPractitionerId`
- When practitioner changes, clear selected date/time
- When appointment type changes, clear selected practitioner, date, and time

**Dependency Chain:**
```
Appointment Type → Practitioner → Date/Time
```

**Auto-deselection Rules:**
- Changing appointment type → clear practitioner, date, time
- Changing practitioner → clear date, time
- Changing date → clear time (already implemented)

### 3. Auto-filling Support

**From Patients Page / Patient Detail Page:**
- `preSelectedPatientId` prop already exists
- Pre-fill patient search input with patient name
- Patient field remains editable (user can search/change patient)
- Show inline warning if patient has no LINE account

**From Calendar Page:**
- `initialDate` prop already exists
- Pre-select date in `DateTimePicker` when provided

### 4. API Changes

**Backend:**
- Update `GET /clinic/practitioners` to accept optional `appointment_type_id` query parameter
- Use existing `PractitionerService.list_practitioners_for_clinic(appointment_type_id=...)`

**Frontend:**
- Update `apiService.getPractitioners(appointmentTypeId?: number)` signature
- Add conditional fetching: fetch practitioners when appointment type is selected

### 5. Implementation Steps

1. **Backend API Update**
   - Add `appointment_type_id` query parameter to `/clinic/practitioners` endpoint
   - Pass through to `PractitionerService.list_practitioners_for_clinic()`

2. **Frontend API Service**
   - Update `getPractitioners()` to accept optional `appointment_type_id`
   - Update callers to pass `appointment_type_id` when available

3. **CreateAppointmentModal Refactor**
   - Remove step state and navigation logic (keep only 'form' and 'confirm' steps)
   - Convert to single-page form layout
   - Keep patient search/selection functionality:
     - Keep `SearchInput` component with debounced search
     - Keep patient list display with clickable cards
     - Keep pre-filling logic when `preSelectedPatientId` is provided
   - Keep patient creation flow:
     - Keep `PatientCreationModal` integration
     - Keep `PatientCreationSuccessModal` integration
     - Keep patient creation success handling (select patient and continue)
   - Add conditional practitioner fetching based on appointment type
   - Implement auto-deselection logic for dependency chain
   - Keep clinic notes field on main form

4. **Testing**
   - Test from calendar page (no pre-fill)
   - Test from patients page (pre-filled patient)
   - Test from patient detail page (pre-filled patient)
   - Test conditional dropdowns (appointment type → practitioner → date/time)
   - Test auto-deselection when dependencies change
   - Test edge cases (see Edge Cases section below)

## Code Sharing Strategy

### Shared with EditAppointmentModal:
- `DateTimePicker` component (already shared)
- Form field styling and layout patterns
- Validation logic (can extract to shared utilities)

### Unique to CreateAppointmentModal:
- Patient search/selection with `SearchInput` component
- Patient creation flow (PatientCreationModal → PatientCreationSuccessModal)
- Appointment type selection (dropdown instead of read-only)
- Initial form state handling
- Patient list display with clickable cards

## Patient Search and Selection

### Patient Search UI
- **Search Input**: Use `SearchInput` component at top of form (same as current implementation)
- **Search Behavior**: 
  - Debounced server-side search (400ms delay)
  - Requires 3+ digits, 1+ letter, or 1+ Chinese character to trigger search
  - Shows loading state during search
  - Limits to top 100 results
- **Pre-filling**: When `preSelectedPatientId` is provided:
  - Pre-fill search input with patient name
  - Automatically fetch and display patient in results (if not already visible)
  - User can still search/change patient

### Patient List Display
- **When no search input**: Show "請輸入搜尋關鍵字以尋找病患" message and "新增病患" button
- **When search has results**: Display clickable patient cards showing:
  - Patient name (full_name)
  - Phone number
  - LINE display name (if available)
- **When search has no results**: Show "找不到符合的病患" message
- **Selected Patient**: 
  - Highlight selected patient in list (if visible)
  - Show selected patient name with inline warning if no LINE account: "張三 (無LINE帳號)"
  - Selected patient persists when user searches for other patients

### Patient Creation Flow
- **"新增病患" Button**: 
  - Visible when no search input: Shows as primary button with message "請輸入搜尋關鍵字以尋找病患"
  - Visible when search has no results: Shows below "找不到符合的病患" message
  - When search has results: Button is not shown (user can create patient by clearing search first)
- **PatientCreationModal**: Opens when user clicks "新增病患"
  - User fills in patient details
  - On success, opens PatientCreationSuccessModal
- **PatientCreationSuccessModal**: 
  - Shows success message with patient details
  - Two options:
    1. "新增預約" button: Selects the new patient and continues with appointment creation
    2. Close button: Closes both modals and returns to previous page
- **After Patient Creation**: 
  - New patient is automatically selected
  - Search input is pre-filled with new patient name
  - User can continue filling appointment form
  - Patient data is cached in sessionStorage for immediate use

## UI/UX Considerations

1. **Form Layout**: Match `EditAppointmentModal` form layout for consistency
2. **Patient Field**: 
   - Search input at top, patient list below
   - Pre-fill search input when `preSelectedPatientId` is provided
   - Show selected patient with inline warning if no LINE account
3. **Form Field Order** (top to bottom):
   - Patient search input and list
   - Appointment type selection
   - Practitioner dropdown (filtered by appointment type)
   - Date/Time picker (filtered by appointment type + practitioner)
   - Clinic notes textarea
   - "下一步" button (to proceed to confirmation)

4. **Form Field UI Patterns**:
   - **Appointment Type**: 
     - Use dropdown (`<select>`) for consistency with EditAppointmentModal
     - Show duration in format: "物理治療 (30分鐘)"
     - Placeholder: "選擇預約類型"
     - Sort options alphabetically by name (string sort, supports Chinese)
   - **Practitioner**: 
     - Use dropdown (`<select>`) to match EditAppointmentModal pattern
     - Placeholder: "選擇治療師"
     - Sort options alphabetically by name (string sort, supports Chinese)
     - Filtered by selected appointment type
   - **Patient**: Search input with clickable cards (unique to create flow, needed for search functionality)
   - **Date/Time**: DateTimePicker component (shared)
   - **Clinic Notes**: Textarea (shared pattern)
   - **Required Field Indicators**: Show asterisk (*) for required fields (patient, appointment type, practitioner, date, time)
   - **Optional Field Indicators**: Do NOT show "(選填)" text on optional fields (clinic notes)
4. **Error Handling**: Show validation errors inline (similar to edit modal)
5. **Loading States**: Show loading when fetching patients, practitioners, or availability
6. **Modal Title**: Changes based on step (similar to `EditAppointmentModal`):
   - Form step: "建立預約"
   - Confirmation step: "確認預約"
7. **Form Submit**: "下一步" button at bottom to proceed to confirmation step
8. **Confirmation Step**: 
   - Similar to `EditAppointmentModal.renderReviewStep()` but only show new appointment details (no "original vs new" comparison)
   - Display appointment details: patient (with inline LINE warning if applicable), type, practitioner, date/time, clinic notes
   - Include "返回修改" button to go back to form
   - Include "確認建立" button to submit
9. **Loading States**: 
   - During form submission: Disable "確認建立" button, change text to "建立中..."
   - Show disabled state (opacity-50, cursor-not-allowed)
   - Button remains visible during save (no overlay)
10. **Success Handling**: 
    - After successful creation: Close modal immediately and show success alert (current behavior)
    - Alert message: "預約已建立"
11. **Notification**: No notification customization during creation (skip note/preview steps)

## Edge Cases and Error Handling

### Empty States
- **No appointment types**: Show message "目前沒有可用的預約類型" and disable form submission
- **No practitioners for appointment type**: Show message "此預約類型目前沒有可用的治療師" in practitioner dropdown, disable dropdown
- **No availability for practitioner**: `DateTimePicker` handles this - shows message and disables date/time selection
- **No search results**: Show "找不到符合的病患" message and "新增病患" button

### Invalid Data
- **Invalid `preSelectedPatientId`**: 
  - If patient not found, ignore and show empty search (user can search manually)
  - Log warning but don't block form
- **Invalid `initialDate`**: 
  - If date is in past, `DateTimePicker` will handle validation
  - Pre-select date only if valid
- **Patient fetch failure**: Show error message, allow user to retry or create new patient

### State Management
- **Changing patient**: Does NOT clear other fields (appointment type, practitioner, date/time, notes)
- **Clearing appointment type**: Clears practitioner, date, and time (auto-deselection)
- **Clearing practitioner**: Clears date and time (auto-deselection)
- **Returning from confirmation**: Form state is preserved (all selections remain)

### Validation
- **Required fields**: Patient, appointment type, practitioner, date, time
- **Optional fields**: Clinic notes
- **Validation timing**: 
  - Form validation on "下一步" button click
  - Show inline errors for missing required fields
  - Backend validation on final submit (handles edge cases like slot conflicts)

### API Error Handling
- **Practitioner fetch failure**: Show error message, disable practitioner dropdown
- **Availability fetch failure**: `DateTimePicker` handles this - shows error message
- **Appointment creation failure**: Show error message, return to form step (preserve all selections)
- **Patient search failure**: Show error message, allow retry

### User Actions
- **User closes modal**: 
  - If on form step: Reset all state
  - If on confirmation step: Return to form (preserve state)
- **User clicks "返回修改" from confirmation**: Return to form with all selections preserved
- **User creates patient then cancels**: Close both modals, return to form (form state preserved)

## Decisions

1. ✅ **Patient field**: Editable even when `preSelectedPatientId` is provided
2. ✅ **Patient field UI**: Pre-fill search input with patient name when `preSelectedPatientId` is provided
3. ✅ **Confirmation step**: Yes, similar to review step in edit appointment flow
4. ✅ **Confirmation step warnings**: Include necessary warnings inline with patient name (e.g., no LINE account)
5. ✅ **Clinic notes**: On main form (not in separate step)
6. ✅ **Notification customization**: Not supported during creation (skip note/preview flow)
7. ✅ **Form state preservation**: When returning from confirmation step, preserve all form selections
8. ✅ **Patient change behavior**: Changing patient does NOT clear other form fields
9. ✅ **Modal title**: Changes between steps ("建立預約" → "確認預約")
10. ✅ **Success handling**: Close modal immediately and show success alert (current behavior)
11. ✅ **Loading states**: Disable button and show "建立中..." text during submission


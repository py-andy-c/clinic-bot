# Appointment Type Change Enhancements - Business Logic & Technical Design

## Overview

This feature enhances the appointment editing functionality to properly handle appointment type changes. When a user changes an appointment's type, the system must recalculate the appointment duration, update calendar event times, reallocate resources, update the UI preview, and ensure all related components reflect the changes immediately.

The key goals are:
- Automatically recalculate start/end times when appointment type changes
- Show appointment type changes in the edit preview modal
- Update appointment modal display times immediately after changes
- Update calendar event sizes without requiring page refresh
- Ensure resource allocations are updated regardless of whether resources were explicitly changed

---

## Key Business Logic

### 1. Appointment Type Change Duration Recalculation

**Core Rule**: When appointment type is changed, the appointment duration is recalculated using the new appointment type's `duration_minutes`, keeping the start time fixed and adjusting the end time.

- **Start Time**: Remains unchanged when appointment type changes
- **End Time**: Recalculated as `start_time + new_appointment_type.duration_minutes`
- **Duration Source**: Always uses `appointment_types.duration_minutes` from the new appointment type
- **Scheduling Buffer**: Uses the new appointment type's `scheduling_buffer_minutes` for resource allocation

**Rationale**: Appointment types have specific durations that define how long the service takes. When changing appointment types, the duration should reflect the new service requirements while maintaining the scheduled start time.

### 2. Resource Allocation Updates

**Core Rule**: Resource allocations must be updated whenever appointment type changes, regardless of whether the user explicitly changed resources.

- **Trigger Conditions**: Update resources when `appointment_type_actually_changed` is true
- **Time Range**: Use the recalculated start/end times based on new appointment type duration
- **Resource Selection**: If user explicitly selected resources, use those; otherwise auto-allocate based on new appointment type requirements
- **Deallocation**: Always deallocate existing resources before reallocating

**Rationale**: Different appointment types may require different resources or quantities. The system must ensure resource availability matches the new appointment type requirements.

### 3. Preview Modal Change Display

**Core Rule**: The edit preview modal must clearly show appointment type changes alongside other changes.

- **Change Detection**: Use `appointmentTypeChanged` flag from `changeDetails`
- **Display Format**: Show "Appointment type: [Old Name] → [New Name]" in changes summary
- **Priority**: Appointment type changes should be prominently displayed as they affect duration and resources

**Rationale**: Users need to understand all consequences of their changes before confirming, especially significant changes like appointment type that affect time and resources.

### 4. UI Update Requirements

**Core Rule**: All UI components must reflect appointment type changes immediately after confirmation.

- **Calendar Events**: Event sizes must update automatically without page refresh
- **Appointment Modal**: Display times must update if modal remains open
- **Real-time Updates**: Changes should be visible immediately after successful save

**Rationale**: Users expect immediate feedback when making changes. Delayed updates create confusion and poor user experience.

---

## Backend Technical Design

### API Endpoints

The existing appointment update endpoint already supports appointment type changes:

#### `PUT /api/clinic/appointments/{appointment_id}`
- **Description**: Updates an appointment with new details including appointment type
- **Request Body**: `AppointmentEditRequest` (includes `appointment_type_id` field)
- **Key Changes**: 
  - Validates new appointment type exists and belongs to clinic
  - Recalculates duration using new appointment type's `duration_minutes`
  - Triggers resource reallocation when appointment type changes
- **Response**: Success confirmation with appointment details
- **Errors**: 
  - 404: Appointment type not found or doesn't belong to clinic
  - 409: Conflicts with existing appointments or resource availability

### Database Schema

No schema changes required. Uses existing tables:
- `appointments.appointment_type_id` - Foreign key to appointment type
- `appointment_types.duration_minutes` - Duration for time calculations
- `appointment_types.scheduling_buffer_minutes` - Buffer for resource allocation

### Business Logic Implementation

#### AppointmentService.update_appointment()

**Key Changes**:
1. **Appointment Type Validation**:
   ```python
   if new_appointment_type_id is not None and new_appointment_type_id != appointment.appointment_type_id:
       new_appointment_type = AppointmentTypeService.get_appointment_type_by_id(
           db, new_appointment_type_id, clinic_id=clinic_id
       )
       appointment_type_id_to_use = new_appointment_type_id
   ```

2. **Duration Recalculation**:
   ```python
   appointment_type = AppointmentTypeService.get_appointment_type_by_id(
       db, appointment_type_id_to_use, clinic_id=clinic_id
   )
   duration_minutes = appointment_type.duration_minutes
   ```

3. **Change Detection**:
   ```python
   appointment_type_actually_changed = (appointment_type_id_to_use != appointment.appointment_type_id)
   ```

4. **Resource Reallocation Trigger**:
   ```python
   if time_actually_changed or appointment_type_actually_changed or resources_changed:
       # Reallocate resources with new time range and appointment type
   ```

---

## Frontend Technical Design

### State Management Strategy

#### Server State (API Data)
- [x] **Data Source**: `PUT /api/clinic/appointments/{appointment_id}` for updates
- [x] **React Query Hooks**: Uses existing appointment update mutation
- [x] **Query Keys**: Existing calendar data queries are invalidated after updates
- [x] **Cache Strategy**:
  - `staleTime`: 5 minutes for calendar data
  - `cacheTime`: Default React Query settings
  - Invalidation triggers: After successful appointment update, invalidate calendar queries for affected date ranges

#### Client State (UI State)
- [x] **useAppointmentForm Hook**: Already tracks `changeDetails.appointmentTypeChanged`
- [x] **CalendarView State**: Calendar events updated via `fetchCalendarData(true)` after edits
- [x] **Modal State**: EventModal may need refresh if it stays open after edits

#### Form State
- [x] **React Hook Form**: Appointment type selection in edit form
- [x] **Validation**: Appointment type validation on form submission
- [x] **Default Values**: Current appointment type pre-selected

### Component Architecture

#### Component Hierarchy
```
CalendarView
├── EditAppointmentModal
│   ├── AppointmentForm (useAppointmentForm hook)
│   ├── ServiceItemSelectionModal (for appointment type)
│   ├── DateTimePicker
│   ├── PractitionerSelector
│   ├── ResourceSelection
│   └── [Preview Step Components]
└── EventModal (shows appointment details)
```

#### Component List
- [x] **EditAppointmentModal** - Main editing modal with multi-step flow
  - Props: `event`, `practitioners`, `appointmentTypes`, `onConfirm`, `onComplete`
  - State: `step` (form/review/note/preview), `selectedAppointmentTypeId`
  - Dependencies: `useAppointmentForm` hook for change detection

- [x] **useAppointmentForm** - Hook managing appointment form state
  - State: `selectedAppointmentTypeId`, `changeDetails`
  - Dependencies: Appointment types data, current event data

- [x] **CalendarView** - Main calendar component
  - State: `calendarEvents`, `modalState`
  - Dependencies: Calendar data fetching, modal management

### User Interaction Flows

#### Flow 1: Changing Appointment Type in Edit Modal
1. User opens appointment edit modal
2. User changes appointment type in dropdown
3. Form automatically updates duration display (if shown)
4. User proceeds to review/preview step
5. **Preview shows**: "Appointment type: Initial Consultation → Follow-up Treatment"
6. User confirms changes
7. API call updates appointment with new type and recalculated times
8. Calendar refreshes automatically
9. Success message shown
10. Edit modal closes

#### Flow 2: Calendar Event Size Updates
1. Appointment type change confirmed
2. `handleConfirmEditAppointment` calls `fetchCalendarData(true)`
3. Calendar events reload with updated start/end times
4. Event sizes adjust automatically in calendar view
5. No page refresh required

#### Flow 3: EventModal Updates (if stays open)
1. After appointment update, if EventModal remains open
2. EventModal should refresh its data to show updated times
3. **Edge case**: If EventModal stays open, it should reflect the changes

### Edge Cases and Error Handling

#### Edge Cases
- [x] **Appointment Type Not Available**: New appointment type deleted or not available
  - **Solution**: API validation prevents this, shows error if type invalid
- [x] **Resource Allocation Failure**: New appointment type requires resources not available
  - **Solution**: API handles resource conflicts, shows error message
- [x] **Concurrent Updates**: Another user editing same appointment
  - **Solution**: Database locking prevents race conditions
- [x] **Clinic Switching**: User switches clinic during edit
  - **Solution**: Clinic context validation prevents cross-clinic updates

#### Error Scenarios
- [x] **API Errors**: 409 Conflict (resource/time conflicts)
  - **User Message**: "調整預約時發生衝突，請重新選擇時間"
  - **Recovery Action**: Return to form for user to adjust selections
- [x] **Validation Errors**: Invalid appointment type
  - **User Message**: "預約類型不存在"
  - **Field-level Errors**: Appointment type dropdown shows error
- [x] **Loading States**:
  - **Initial Load**: Appointment type dropdown loading
  - **Refetch**: Calendar refreshing after update
  - **Mutation**: Save button shows "儲存中..." during update

### Testing Requirements

#### E2E Tests (Playwright)
- [x] **Test Scenario**: Change appointment type and verify duration recalculation
  - Steps: Open edit modal → Change appointment type → Verify time display updates → Confirm → Verify calendar event size changes
  - Assertions: Calendar event height changes proportionally to new duration
  - Edge cases: Test with resource allocation conflicts

- [x] **Test Scenario**: Preview modal shows appointment type changes
  - Steps: Change appointment type → Proceed to preview → Verify changes summary includes appointment type change
  - Assertions: Preview shows "Appointment type: [old] → [new]"

#### Integration Tests (MSW)
- [x] **Test Scenario**: Appointment form updates duration on type change
  - Mock API responses: Appointment types with different durations
  - User interactions: Change appointment type dropdown
  - Assertions: Duration display updates automatically

#### Unit Tests
- [x] **Hook**: `useAppointmentForm` change detection
  - Test cases: `appointmentTypeChanged` flag set correctly, `changeDetails` computed properly
- [x] **Utility**: Duration calculation functions
  - Test cases: End time calculation with different appointment types

### Performance Considerations

- [x] **Data Loading**: Appointment types loaded once per clinic, cached in React Query
- [x] **Caching**: Calendar data cached for 5 minutes, invalidated after updates
- [x] **Optimistic Updates**: Not used (complex state changes make it error-prone)
- [x] **Lazy Loading**: Edit modal components loaded on demand
- [x] **Memoization**: `changeDetails` in `useAppointmentForm` properly memoized

---

## Integration Points

### Backend Integration
- [x] Dependencies on `AppointmentService.update_appointment()`
- [x] Database relationships: `appointments.appointment_type_id` → `appointment_types`
- [x] API contracts: `AppointmentEditRequest` already includes `appointment_type_id`

### Frontend Integration
- [x] Shared components: `EditAppointmentModal`, `DateTimePicker`
- [x] Shared hooks: `useAppointmentForm` for change detection
- [x] Shared stores: None required
- [x] Navigation/routing: No changes needed

---

## Security Considerations

- [x] Authentication requirements: User must be authenticated to edit appointments
- [x] Authorization checks: Practitioners can only edit their own appointments, admins can edit any
- [x] Input validation: Appointment type must exist and belong to clinic
- [x] XSS prevention: All user inputs validated and sanitized
- [x] CSRF protection: API endpoints protected with authentication

---

## Success Metrics

- [x] **User Experience**: Appointment type changes complete without errors
- [x] **Data Accuracy**: All appointments have correct durations after type changes
- [x] **Performance**: Calendar updates within 2 seconds of confirmation
- [x] **Error Rate**: Less than 1% of appointment type changes fail due to conflicts

---

## Open Questions / Future Enhancements

- [x] **Bulk Appointment Type Changes**: Allow changing appointment types for multiple appointments at once
- [x] **Appointment Type Templates**: Predefined templates for common type change scenarios
- [x] **Duration Override**: Allow manual duration override when changing appointment types
- [x] **Historical Tracking**: Track appointment type change history for auditing

---

## References

- [Appointments Design Doc](./appointments.md) - Core appointment business logic
- [Resources and Scheduling Design Doc](./resources_and_scheduling.md) - Resource allocation logic
- [API Documentation](backend/src/api/clinic/appointments.py) - Appointment update endpoint
- [Frontend Components](frontend/src/components/calendar/EditAppointmentModal.tsx) - Edit modal implementation


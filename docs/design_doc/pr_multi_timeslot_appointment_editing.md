# Multi-Timeslot Appointment Editing - Implementation PR

## Overview

This PR implements the ability for patients to edit multi-timeslot appointments before clinic confirmation. Previously, patients could not modify appointments with `pending_time_confirmation = true`, but now they can re-select their preferred time slots using the same multi-slot selection interface used during booking.

## Problem Statement

Patients booking multi-timeslot appointments (where `allow_multiple_time_slot_selection = true`) were unable to edit their appointments after booking but before clinic confirmation. The appointment card showed "時間確認前無法修改" (Cannot modify before time confirmation) and the reschedule button was disabled for these appointments.

This created a poor user experience where patients had no way to change their preferred time slots if their availability changed after booking but before the clinic confirmed the final appointment time.

## Solution

### Key Changes

#### Backend API Changes
- **Enhanced `/appointments/{appointment_id}/details` endpoint**: Added `allow_multiple_time_slot_selection` field to appointment type information in the response
- **Enhanced `/appointments/{appointment_id}/reschedule` endpoint**: Added support for `selected_time_slots` parameter to handle multi-slot rescheduling
- **Enhanced `AppointmentService.update_appointment`**: Added logic to update `alternative_time_slots` when patients re-select time slots for multi-slot appointments

#### Frontend Changes
- **AppointmentCard**: Removed the `pending_time_confirmation` constraint from the `canModify` logic, allowing patients to see the reschedule button for multi-slot appointments
- **RescheduleFlow**: Added conditional logic to detect multi-slot appointment types and show the appropriate time selection interface (Step3SelectDateTime for multi-slot, traditional calendar for single-slot)
- **EditAppointmentModal**: Added support for clinic users to edit multi-slot appointments using the new MultiSlotTimeSelector component
- **MultiSlotTimeSelector**: New reusable component that wraps Step3SelectDateTime and ensures the appointment store is properly configured for multi-slot mode

### Technical Implementation

#### Store Management
The implementation ensures the appointment store is correctly configured when switching to multi-slot mode:

```typescript
// Set multiple slot mode and appointment type in store
setMultipleSlotMode(true);
setAppointmentType(appointmentTypeId, appointmentType);
```

#### Validation Logic
- Multi-slot appointments: Validates that `selectedTimeSlots.length > 0`
- Single-slot appointments: Validates that `selectedDate && selectedTime`
- Maintains all existing permission checks (receipt constraints, practitioner permissions)

#### API Integration
- **Request**: `selected_time_slots: string[]` for multi-slot rescheduling
- **Response**: Includes `allow_multiple_time_slot_selection` in appointment details
- **Validation**: Server-side validation ensures max 10 slots and proper time formats

## User Experience

### Patient Journey
1. **Book Multi-Slot Appointment**: Patient selects multiple preferred time slots during booking
2. **Appointment Confirmed**: Appointment shows "待安排" (to be arranged) status
3. **Need to Change Slots**: Patient can now click "修改" (Edit) button on appointment card
4. **Re-select Slots**: Patient sees the multi-slot selection interface and can choose new preferred slots
5. **Confirmation**: Appointment updated with new slot preferences, still pending clinic confirmation

### Clinic Experience
Clinic users can edit multi-slot appointments through the existing EditAppointmentModal, which now shows a multi-slot time selector when appropriate.

## Design Decisions

### Simplicity Over Complexity
- **No preservation of old slots**: Patients start fresh with slot selection (simpler UX)
- **Reuse existing components**: Leverages Step3SelectDateTime and MultipleTimeSlotSelector from booking flow
- **Minimal API changes**: Extended existing endpoints rather than creating new ones

### Permission Consistency
- **Same constraints apply**: Cannot edit appointments with receipts, maintains practitioner permissions
- **Cancellation still restricted**: Patients cannot cancel appointments waiting for confirmation (business logic preserved)
- **Clinic override maintained**: Clinic users can still edit all appointments they have permission to modify

### Error Handling
- **Graceful fallbacks**: Single-slot interface shown for single-slot appointment types
- **Proper validation**: Client and server-side validation for slot limits and formats
- **Clear messaging**: Users see appropriate error messages for invalid selections

## Testing

### Test Coverage
- **Backend tests**: API validation, appointment updates, permission checks
- **Frontend tests**: Component rendering, state management, user interactions
- **Integration tests**: End-to-end multi-slot editing flow
- **TypeScript**: Full type safety maintained

### Edge Cases Handled
- Appointment type changes during editing
- Network failures during slot selection
- Invalid time slot selections
- Permission changes after booking
- Concurrent clinic confirmation

## Files Changed

### Backend
- `backend/src/api/liff.py`: Enhanced appointment details and reschedule APIs
- `backend/src/services/appointment_service.py`: Added multi-slot update logic

### Frontend
- `frontend/src/liff/query/AppointmentCard.tsx`: Removed editing constraint
- `frontend/src/liff/appointment/RescheduleFlow.tsx`: Added multi-slot support
- `frontend/src/components/calendar/EditAppointmentModal.tsx`: Added multi-slot editing
- `frontend/src/components/calendar/MultiSlotTimeSelector.tsx`: New component
- `frontend/src/i18n/locales/zh-TW.ts`: Removed unused translation

### Documentation
- `docs/design_doc/multi_timeslot_appointment_editing.md`: Design specification (already merged)

## Backward Compatibility

- **No breaking changes**: Existing single-slot appointments work exactly as before
- **API extensions**: New fields added without removing existing functionality
- **Graceful degradation**: Single-slot interface shown when multi-slot not available

## Performance Considerations

- **Lazy loading**: Appointment type details loaded only when needed
- **Store efficiency**: Minimal state updates, proper memoization
- **Network optimization**: Reuses existing availability APIs
- **Bundle size**: New component adds minimal overhead

## Security

- **Authorization maintained**: All existing permission checks preserved
- **Input validation**: Server-side validation for all time slot data
- **Data isolation**: Clinic-level data isolation maintained
- **Audit trail**: Appointment changes properly tracked

## Deployment Notes

- **Database migration**: No schema changes required
- **API versioning**: Backward compatible API changes
- **Feature flags**: Can be disabled by setting `allow_multiple_time_slot_selection = false` on appointment types
- **Rollback**: Easy rollback by reverting constraint removal in AppointmentCard

## Success Metrics

- **User adoption**: Percentage of multi-slot appointments that get edited
- **Error rate**: Reduction in support tickets about inability to change slots
- **Conversion**: Improved booking completion rates for multi-slot appointments
- **Satisfaction**: User feedback on editing experience

## References

- [Multi-Timeslot Appointment Editing Design Document](./multi_timeslot_appointment_editing.md)
- [Multiple Time Slot Selection Design Document](./multiple_time_slot_selection.md)

---

**Status**: ✅ **IMPLEMENTED & MERGED**
**Test Results**: ✅ **ALL TESTS PASSING**
**Review**: ✅ **APPROVED FOR PRODUCTION**
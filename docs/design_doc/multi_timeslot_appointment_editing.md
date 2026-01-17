# Multi-Timeslot Appointment Editing - Implementation Summary

## Overview

This document summarizes the implementation of multi-timeslot appointment editing, allowing patients to edit appointments before clinic time confirmation. The feature provides a consistent editing experience that reuses existing multi-slot selection components.

## Current State Analysis

### Constraints on Multi-Slot Appointment Editing

Currently, multi-timeslot appointments with `pending_time_confirmation = true` cannot be edited by patients. This constraint exists in the frontend `AppointmentCard.tsx`:

```typescript
const canModify = !appointment.has_any_receipt && !appointment.pending_time_confirmation;
```

This prevents patients from modifying appointments that show "待安排" (to be arranged) time status.

### Single-Slot Appointment Editing Flow

Single-slot appointment editing works through:
- **Frontend**: `EditAppointmentModal` component allows changing time, practitioner, appointment type, and clinic notes
- **Backend**: `AppointmentService.update_appointment()` handles the business logic with permission checks
- **Permissions**: Follows existing rules (practitioners can edit their own appointments, admins can edit any)
- **Constraints**: Cannot edit appointments with receipts, cannot edit auto-assigned appointments (except by assigned practitioner)

### Multi-Slot Appointment Creation Flow

Multi-slot appointment booking uses:
- **Component**: `Step3SelectDateTime` with `MultipleTimeSlotSelector` and `SelectedSlotsDisplay`
- **Flow**: Patient selects multiple preferred time slots (up to 10) from available options
- **State**: Appointments created with `pending_time_confirmation = true` and temporary slot from selection
- **Backend**: Stores alternative slots in `alternative_time_slots` JSON array

### UI Conflict Resolution

Initial implementation attempted complete reuse of `Step3SelectDateTime`, but this caused several UI conflicts:
- **Duplicate headers**: "選擇日期與時間" appeared twice on the page
- **Inappropriate content**: Availability notifications ("找不到適合時間") not suitable for reschedule context
- **Conflicting buttons**: `SelectedSlotsDisplay` confirmation button competed with main flow's "下一步"
- **Cramped layout**: Modal wrapper made date picker appear too small

**Implementation Approach**: Selective reuse of existing multi-slot selection components, adapted for different contexts.

## Proposed Solution

### Core Design Principles

1. **Simplicity**: Keep the editing experience simple - don't preserve old selections, just allow re-selection
2. **Consistency**: Align editing permissions, constraints, and UX with single-slot appointments
3. **Reuse**: Leverage existing multi-slot selection components from the booking flow
4. **No Breaking Changes**: Maintain existing business logic and constraints for confirmed appointments

### Key Changes Required

#### Frontend Changes

**1. Remove Pending Time Confirmation Constraint**
- Update `AppointmentCard.tsx` to allow modification of multi-slot appointments before confirmation
- Remove `!appointment.pending_time_confirmation` from `canModify` logic

**2. Enhanced EditAppointmentModal**
- Detect multi-slot appointments during editing
- Show appropriate UI based on appointment type (`allow_multiple_time_slot_selection`)

**3. Reuse Multi-Slot Selection Components**
- For multi-slot appointments, redirect to slot re-selection using existing `Step3SelectDateTime` components
- Don't preserve existing `alternative_time_slots` - start fresh selection

#### Backend Changes

**1. Update Appointment Update Logic**
- Allow updates to multi-slot appointments with `pending_time_confirmation = true`
- Reset `alternative_time_slots` when patient re-selects slots
- Maintain existing permission and constraint checks

### User Experience Flow

#### Patient Editing Multi-Slot Appointment

**Clinic Edit Modal:**
1. **Access Editing**: Clinic user clicks edit button on multi-slot appointment
2. **Modal Opens**: `EditAppointmentModal` appears with form fields and alternative slots display
3. **Alternative Slots Review**: Clinic sees patient's preferred time slots in expandable amber section
4. **Time Selection**: Use standard DateTimePicker to select final time slot
5. **Save**: Complete appointment edit with selected time slot

**Patient Reschedule Page:**
1. **Access Editing**: Patient clicks "修改" button on multi-slot appointment card
2. **Page Navigation**: Goes to reschedule page with appointment details
3. **Slot Re-selection**: Embedded `MultiSlotDateTimeSelector`:
   - Single "選擇日期與時間" header (no duplicates)
   - Calendar navigation and date selection
   - Multiple time slot selection grid
   - Selected slots display (no conflicting confirm button)
4. **Confirmation**: Click page's "下一步" button (no competing buttons)
5. **Review**: Standard review and confirmation flow

#### Permission Alignment

- **Who can edit**: Same rules as single-slot appointments
  - Practitioners can edit their own appointments
  - Admins can edit any appointment
  - Cannot edit auto-assigned appointments (unless you're the assigned practitioner)
  - Cannot edit appointments with receipts

- **What can be changed**: All fields available in single-slot editing
  - Practitioner assignment
  - Appointment type
  - Time slots (re-selection for multi-slot)
  - Clinic notes

#### Constraints Maintained

- **Receipt Protection**: Appointments with any receipt (active or voided) cannot be modified
- **Auto-assignment Protection**: Non-admin practitioners cannot edit auto-assigned appointments
- **Business Rules**: All existing booking constraints apply (minimum hours ahead, availability, etc.)
- **Clinic Confirmation**: Multi-slot appointments remain pending confirmation after editing

### Technical Implementation

#### Component Architecture

```
EditAppointmentModal (Enhanced)
├── Form Fields (practitioner, appointment type, notes)
├── Time Selection Button
│   └── Conditional Logic:
│       ├── Single-Slot: Standard DateTimePicker
│       └── Multi-Slot: MultiSlotDateTimeSelector Modal
├── Alternative Slots Display (Inline Implementation)
│   ├── Expandable section showing patient's preferences
│   ├── Current slot highlighted as "目前使用"
│   ├── Alternative slots grouped by date
└── Standard DateTimePicker (for final slot selection)

RescheduleFlow (Page Component)
├── Patient/Appointment Info
├── MultiSlotDateTimeSelector (embedded)
│   ├── Calendar Navigation
│   ├── MultipleTimeSlotSelector
│   └── SelectedSlotsDisplay (no confirm button)
└── Main Flow Controls ("下一步" button)
```

#### API Integration

**Existing Endpoints Used:**
- `PUT /clinic/appointments/{appointment_id}` (clinic editing) - already supports multi-slot confirmation
- `POST /liff/appointments` (patient booking) - already handles multi-slot creation

**New Logic Needed:**
- Detect multi-slot appointment type during patient editing
- Allow patient updates to reset `alternative_time_slots`
- Maintain `pending_time_confirmation = true` after patient edits

#### State Management

**Appointment Store Updates:**
- Add detection for multi-slot editing mode
- Track selected slots during editing (separate from booking flow)
- Reset slot selection when entering edit mode

**Form State:**
- Preserve other appointment fields (practitioner, type, notes) during slot re-selection
- Clear slot selections when starting edit (no preservation of old selections)

### Implementation Results

#### Key Components Created
- **`MultiSlotDateTimeSelector`**: Clean calendar + multi-slot selection component for patient rescheduling
- **Enhanced `SelectedSlotsDisplay`**: Optional confirmation button via `showConfirmButton` prop
- **Inline Alternative Slots Display**: Implemented directly in `EditAppointmentModal` for clinic time confirmations

### Edge Cases and Considerations

- **Concurrent Editing**: Standard conflict resolution via backend optimistic locking
- **Slot Availability**: Patients re-select preferences to ensure current availability
- **Single vs Multiple Slots**: Single slot selection creates multi-slot appointment with one alternative
- **Appointment Type Changes**: Type changes clear/reset slot selections as appropriate
- **Auto-confirmation Timing**: Edits don't affect auto-confirmation schedule

## Implementation Status

### ✅ **COMPLETED - Production Ready**

**Final Architecture:**
- **Patient Reschedule**: `RescheduleFlow` → `MultiSlotDateTimeSelector`
- **Clinic Edit**: `EditAppointmentModal` → `MultiSlotDateTimeSelector` (with inline alternative slots display)
- **Core Components**: Selective reuse with `MultipleTimeSlotSelector` and `SelectedSlotsDisplay`

**Key Features:**
- **Clean Architecture**: Selective reuse of existing multi-slot selection components
- **Context-Appropriate**: Components adapt to different usage contexts (modal vs embedded)
- **Maintainable**: Clear separation of concerns and reusable components

**Testing Results:**
- ✅ **All Frontend Tests Pass**
- ✅ **TypeScript Compilation Clean**
- ✅ **No Breaking Changes**
- ✅ **Backward Compatible**

**Files Created/Modified:**
- `frontend/src/liff/appointment/components/MultiSlotDateTimeSelector.tsx` (core logic)
- `frontend/src/liff/appointment/components/SelectedSlotsDisplay.tsx` (optional confirm button)
- `frontend/src/liff/appointment/RescheduleFlow.tsx` (updated to use new component)
- `frontend/src/components/calendar/EditAppointmentModal.tsx` (updated integration with inline alternative slots display)
- `frontend/src/liff/query/AppointmentCard.tsx` (removed edit constraint)
- `backend/src/api/liff.py` (enhanced appointment details API)
- `backend/src/services/appointment_service.py` (added multi-slot update logic)

### Implementation Plan

#### ✅ Phase 1: Frontend Changes - COMPLETED
1. Remove `pending_time_confirmation` constraint from `AppointmentCard.tsx`
2. Enhance `EditAppointmentModal` to detect multi-slot appointments and display alternative slots inline
3. Create `MultiSlotDateTimeSelector` component with selective reuse of Step3 logic
4. Update `RescheduleFlow` to use `MultiSlotDateTimeSelector` directly
5. Make `SelectedSlotsDisplay` confirmation button optional to avoid conflicts
6. Update appointment store for edit-mode slot selection

#### ✅ Phase 2: Backend Changes - COMPLETED
1. Allow patient updates to multi-slot appointments (remove time confirmation requirement)
2. Reset `alternative_time_slots` when patients re-select slots
3. Maintain existing validation and permission checks
4. Enhanced appointment details API to include `allow_multiple_time_slot_selection`

#### ✅ Phase 3: Testing and Validation - COMPLETED
1. ✅ Test edit flow for multi-slot appointments - All tests pass
2. ✅ Verify permission constraints still work - Constraints maintained
3. ✅ Test edge cases (clinic confirmation during edit, type changes, etc.) - Edge cases handled
4. ✅ E2E testing for complete patient edit flow - Full integration tested

### Success Metrics

- **User Experience**: Patients can successfully edit multi-slot appointments before confirmation
- **Consistency**: Edit experience matches single-slot appointments in permissions and constraints
- **Performance**: Reused components don't introduce performance regressions
- **Reliability**: No breaking changes to existing confirmed appointment logic

### Open Questions

**Question 6**: Should we show a warning that editing will reset their slot preferences?
**Proposed Answer**: Consider adding a subtle warning: "重新選擇時段將清除之前的偏好設定" (Re-selecting slots will clear previous preferences)

**Question 7**: How to handle the case where all previously selected slots are now unavailable?
**Proposed Answer**: Standard availability checking - if no slots available, show appropriate error message during selection.

### References

- [Multiple Time Slot Selection](./multiple_time_slot_selection.md) - Current multi-slot implementation
- [Appointments](./appointments.md) - Core appointment business logic
- [Patient Practitioner Assignment](./patient_practitioner_assignment.md) - Permission patterns

---

*This design maintains simplicity while providing consistent functionality. The reuse of existing components minimizes development effort and ensures reliability.*
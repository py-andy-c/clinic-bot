# Multi-Timeslot Appointment Editing - Design Document

## Overview

This document defines the design for allowing patients to edit multi-timeslot appointments before the clinic has confirmed the time selection. The goal is to provide a simple, consistent experience that aligns with single-slot appointment editing while reusing existing multi-slot selection components.

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

1. **Access Editing**: Patient sees enabled "改期" (reschedule) button on multi-slot appointment card (currently disabled)
2. **Modal Opens**: Standard `EditAppointmentModal` appears with practitioner/appointment type options
3. **Time Selection**: When patient clicks time selection, detect multi-slot appointment type
4. **Slot Re-selection**: Instead of single time picker, show multi-slot selection flow:
   - Calendar date selection (reuse `Step3SelectDateTime`)
   - Multiple time slot selection (reuse `MultipleTimeSlotSelector`)
   - Selected slots display (reuse `SelectedSlotsDisplay`)
5. **Confirmation**: Patient confirms new slot selection
6. **Update**: Appointment updated with new temporary slot and alternative slots, remains `pending_time_confirmation = true`

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
│       └── Multi-Slot: MultiSlotTimeSelector Modal
│
MultiSlotTimeSelector (New Modal Component)
├── Step3SelectDateTime (Reused)
├── MultipleTimeSlotSelector (Reused)
├── SelectedSlotsDisplay (Reused)
└── Confirm Button
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

### Edge Cases and Considerations

#### Question 1: Should we preserve existing alternative slots?
**Proposed Answer**: No - keep it simple. Let users re-select their preferences. This avoids complexity of merging old/new selections and potential conflicts.

#### Question 2: What if clinic confirms time while patient is editing?
**Proposed Answer**: Standard conflict resolution - backend optimistic locking will catch this. Patient gets error message and can retry.

#### Question 3: Should patients be able to reduce from multiple to single slot?
**Proposed Answer**: Yes - if they select only one slot during editing, it should remain a multi-slot appointment type but with single alternative. Auto-confirmation logic handles this case.

#### Question 4: How to handle appointment type changes during editing?
**Proposed Answer**: If patient changes from multi-slot to single-slot appointment type, clear `alternative_time_slots` and `pending_time_confirmation`. If changing to multi-slot type, require slot re-selection.

#### Question 5: What about auto-confirmation timing?
**Proposed Answer**: Maintain existing logic - auto-confirmation still happens at `minimum_booking_hours_ahead` hours before the temporary slot. Patient edits don't affect auto-confirmation schedule.

### Implementation Plan

#### Phase 1: Frontend Changes
1. Remove `pending_time_confirmation` constraint from `AppointmentCard.tsx`
2. Enhance `EditAppointmentModal` to detect multi-slot appointments
3. Create `MultiSlotTimeSelector` modal component reusing booking components
4. Update appointment store for edit-mode slot selection

#### Phase 2: Backend Changes
1. Allow patient updates to multi-slot appointments (remove time confirmation requirement)
2. Reset `alternative_time_slots` when patients re-select slots
3. Maintain existing validation and permission checks

#### Phase 3: Testing and Validation
1. Test edit flow for multi-slot appointments
2. Verify permission constraints still work
3. Test edge cases (clinic confirmation during edit, type changes, etc.)
4. E2E testing for complete patient edit flow

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
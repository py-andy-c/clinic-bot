# Multi-Time-Slot Appointment Editing - Business Logic & Technical Design

## Overview

This document defines the business logic and technical design for editing multi-time-slot appointments. **Changes the original behavior** where patients could only edit to single-slot selection. Now patients can fully re-select multiple time slots with a consistent user experience as creating new appointments. **Key enhancement**: If editing results in only one time slot, it behaves like a single-slot appointment (no clinic review required).

## Key Business Logic

### Edit Permissions
**Same as Single Appointments**: Uses existing "預約取消/修改限制" constraint, cannot edit after clinic confirmation.

### Edit Process
1. **Load**: System loads current `alternative_time_slots`, filters unavailable slots
2. **Edit**: Patient uses same date/time picker and multi-slot selection interface as booking
3. **Save**: Updates `alternative_time_slots`
   - **If multiple slots selected**: `pending_time_confirmation = true`, clinic review required
   - **If single slot selected**: `pending_time_confirmation = false`, confirmed immediately (like single-slot appointment)
4. **Confirmation**: Auto-confirmation timer restarts (multi-slot) or immediate confirmation (single-slot)

### State Changes
- **Multi-slot result**: Appointment returns to "待安排" status, clinic review required
- **Single-slot result**: Appointment confirmed immediately with selected time, no clinic review
- **Temporary slot**: Reassigned to selected slot (earliest available for multi-slot, the single slot for single-slot)
- **Calendar events**: Generated immediately for single-slot results, pending for multi-slot

### Unavailable Slots
**Silent Deselection**: Unavailable slots are automatically removed from selection (no user notification needed).

### Clinic Integration
**Same as New Bookings**: Clinic receives notification when patient edits, appointment re-enters pending review queue.

## Backend Technical Design

### API Endpoints

#### Enhanced `PUT /liff/appointments/{appointment_id}` (Patient Edit)
- **New Request Fields**:
  - `selected_time_slots?: string[]` - New array of preferred time slots
- **Logic**:
  - Validate edit permissions and slot availability
  - **If length(selected_time_slots) > 1**: Set `pending_time_confirmation = true`, store alternatives, notify clinic
  - **If length(selected_time_slots) == 1**: Set `pending_time_confirmation = false`, confirm appointment immediately
- **Side Effects**:
  - Update appointment time to selected slot
  - Generate ICS calendar events for single-slot confirmations
  - Send LINE notifications (clinic for multi-slot, patient for single-slot)
  - Restart auto-confirmation timer for multi-slot appointments

#### Enhanced `GET /liff/appointments/{appointment_id}` (Load for Edit)
- **Response Enhancement**: Include `alternative_time_slots` and availability status for editing
- **New Response Fields**:
  - `can_edit_multiple_slots: boolean` - Whether appointment can be edited (within recency window)
  - `available_alternative_slots: string[]` - Currently available slots from patient's preferences
  - `edit_deadline: string` - ISO datetime when edit window expires

### Database Schema (No Changes Required)

The existing multi-time-slot schema supports editing:
- `pending_time_confirmation` - Set to true for multi-slot results, false for single-slot results
- `alternative_time_slots` - Updated with new selections (NULL for single-slot results)
- `confirmed_at` - Set for single-slot results, NULL for multi-slot results
- `confirmed_by_user_id` - NULL for patient edits (auto-confirmed for single-slot)

### Business Logic Implementation

#### AppointmentService Enhancements
**New Methods**:
- `edit_multiple_slot_appointment()`: Handles multi-slot edit with validation and state reset
- `validate_edit_permissions()`: Checks edit recency constraints for multi-slot appointments
- `filter_available_slots()`: Returns only available slots from patient's current preferences

**Enhanced Methods**:
- `update_appointment()`: Support `selected_time_slots` parameter with single/multi-slot logic

#### Auto-Confirmation Service Updates
- **Edit Detection**: Skip auto-confirmation for appointments recently edited by patient
- **Timer Reset Logic**: Update last modification timestamp to restart countdown
- **Edit Window Respect**: Never auto-confirm within edit restriction period

## Frontend Technical Design

### Component Architecture

**Consistent with Booking UX**: Reuse exact same components and layout as appointment creation flow.

```
EditModal/Page (Same as Booking)
├── DateTimePicker (from Step3SelectDateTime)
├── MultipleTimeSlotSelector (from booking)
├── SelectedSlotsDisplay (from booking)
└── Action buttons
```

**Pre-population**: Initialize with current appointment's date and filtered available slots selected.

### State Management Strategy

**Extend Existing Store**: Add multi-slot support to existing appointment edit state management.

- Reuse existing `loadAppointmentForEdit()` with additional slot filtering
- Use existing `updateAppointment()` with multi-slot parameters
- Add `filteredAlternativeSlots` field to store available slots for editing

### User Interaction Flows

#### Flow: Patient Edits Multi-Time-Slot Appointment (Consistent with Booking)
1. **View Appointment**: Patient sees "待安排" status with edit button enabled
2. **Initiate Edit**: Click "修改預約" → opens same interface as booking flow
3. **Date/Time Selection**: Uses identical date picker and time slot selector as Step3SelectDateTime
4. **Slot Management**: Same "已選擇 X/10 個時段" counter and removable chips display
5. **Save Changes**:
   - **Multi-slot result**: "時段偏好已更新，將於稍後確認時間" → returns to "待安排" status
   - **Single-slot result**: "預約時間已確認" → shows confirmed time immediately

#### Flow: Clinic Integration
1. **Multi-slot edits**: Clinic receives notification, appointment enters review queue
2. **Single-slot edits**: No clinic notification needed, appointment confirmed automatically
3. **Review Process**: Same as new multi-slot bookings for appointments requiring review

### Edge Cases and Error Handling

#### Edit Permission Validation
- **Outside Window**: Edit button disabled with tooltip "已超過修改期限"
- **Already Confirmed**: Edit button hidden, shows "已確認時間"
- **API Failure**: Show error "無法載入編輯資料，請稍後再試"

#### Slot Availability Changes
- **All Unavailable**: Force patient to select new slots (cannot save with 0 selections)
- **Partial Unavailable**: Silently deselect unavailable, allow edit to continue
- **New Unavailable**: During editing session, show real-time availability updates

#### Race Conditions
- **Auto-Confirmation**: Edit operation cancels any pending auto-confirmation
- **Clinic Confirmation**: If clinic confirms while patient is editing, show conflict error
- **Concurrent Edits**: Backend optimistic locking prevents simultaneous edits

#### Validation Failures
- **No Slots Selected**: "請至少選擇一個時段"
- **Invalid Slots**: "部分時段無法預約，請重新選擇"
- **Recency Violation**: "已超過修改期限"

#### Additional Edge Cases
- **Single Slot Result**: Editing to single slot behaves exactly like single-slot appointment creation (immediate confirmation)
- **Zero Constraint**: If clinic sets edit restriction to 0, editing is disabled for all appointment types
- **Calendar Events**: Cancelled for multi-slot results, generated immediately for single-slot results
- **Mixed Availability**: Some slots available, some not - only available slots pre-selected
- **Multiple Edits**: Cannot edit multiple appointments simultaneously (same as single appointments)
- **Cross-Date Editing**: Patient can select slots on different dates, date picker stays flexible
- **Practitioner Changes**: Can change practitioner if appointment type allows patient selection, cannot if disabled
- **Confirmed Appointments**: Cannot edit appointments already confirmed by clinic
- **All Slots Unavailable**: While editing, if all slots become unavailable, show error and prevent save
- **Patient Double-Booking**: Cannot select slots that conflict with patient's other appointments (same validation as single-slot)

## Implementation Plan

### Phase 1: Backend API (1-2 days)
- [ ] Enhance `PUT /liff/appointments/{id}` to support `selected_time_slots` parameter
- [ ] Implement single-slot vs multi-slot confirmation logic
- [ ] Add slot availability filtering logic
- [ ] Update auto-confirmation service to handle edits

### Phase 2: Frontend Enhancement (2-3 days)
- [ ] Extend existing edit modal to show multi-slot UI conditionally
- [ ] Add slot pre-population and filtering to existing edit flow
- [ ] Update appointment store with multi-slot support

### Phase 3: Testing & Polish (1-2 days)
- [ ] Add E2E tests for multi-slot editing
- [ ] Test edge cases and error handling
- [ ] Update translations if needed

## Testing Requirements

### E2E Tests
- [ ] Multi-slot edit flow: select multiple slots, save, verify pending state and clinic notification
- [ ] Single-slot edit flow: select one slot, save, verify immediate confirmation
- [ ] Unavailable slot handling: unavailable slots automatically deselected
- [ ] Consistent UX: edit interface matches booking flow exactly
- [ ] Permission validation: edit blocked outside recency window

### Integration Tests
- [ ] API handles single-slot vs multi-slot confirmation logic
- [ ] Auto-confirmation service resets timer for multi-slot edits only
- [ ] Slot availability filtering works properly
- [ ] Calendar event generation for single-slot confirmations

### Unit Tests
- [ ] Single vs multi-slot confirmation logic
- [ ] Multi-slot validation and availability filtering
- [ ] State management for pre-populated slots

## Security Considerations

- [ ] **Permission Validation**: Strict edit window enforcement on backend
- [ ] **Data Integrity**: Atomic updates to prevent inconsistent states
- [ ] **Rate Limiting**: Prevent abuse of edit operations
- [ ] **Audit Logging**: Track all appointment edits for clinic oversight

## Success Metrics

- **Edit Completion Rate**: Percentage of edit attempts that complete successfully
- **Patient Satisfaction**: Survey responses on edit experience ease
- **Clinic Efficiency**: Reduction in back-and-forth about time preferences
- **System Reliability**: Error rates in edit operations

## Resolved Design Decisions

**Aligned with Single-Slot Editing**: All behaviors follow existing single appointment editing patterns.

### Implementation Decisions
1. **Edit Frequency Limits**: No limits (same as single-slot editing)
2. **Constraint Changes**: New clinic settings apply to existing appointments (same as single-slot)
3. **Appointment Type Validation**: Must respect original appointment type constraints (same as single-slot)

### Edge Case Resolutions
4. **Race Condition - Auto-confirmation**: Last operation wins (same conflict resolution as single-slot)
5. **Practitioner Assignment**: Can change practitioner if appointment type allows (`allow_patient_practitioner_selection = true`), cannot change if disabled (same as single-slot editing)
6. **Confirmed Single-Slot Appointments**: Cannot edit once clinic confirms any appointment (same as single-slot)
7. **Real-time Availability**: Refresh when practitioner changes (same as single-slot editing)

## Integration Points

- **Booking Flow Components**: Directly reuses `Step3SelectDateTime`, `MultipleTimeSlotSelector`, `SelectedSlotsDisplay`
- **Existing Edit Constraint**: Uses "預約取消/修改限制" setting from clinic configuration
- **Appointment Store**: Extends existing state management patterns
- **Notification System**: Integrates with existing LINE notification templates
- **Confirmation Logic**: Same single-slot vs multi-slot behavior as appointment creation
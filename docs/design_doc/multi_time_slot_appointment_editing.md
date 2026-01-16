# Multi-Time-Slot Appointment Editing - Business Logic & Technical Design

## Overview

This document defines the business logic and technical design for editing multi-time-slot appointments. Patients can modify their preferred time slots after booking, subject to clinic's edit recency constraints. The editing process mirrors the initial booking flow but operates within the existing cancellation/modification restrictions.

## Key Business Logic

### 1. Edit Permission Rules

**Core Rule**: Multi-time-slot appointments follow the same edit restrictions as single appointments, using the existing "預約取消/修改限制" (appointment cancellation/modification restriction) setting.

- **Edit Window**: Patients can edit multi-time-slot appointments within the clinic's configured edit restriction period
- **Post-Confirmation**: Cannot edit once clinic has confirmed the final time slot
- **Same Constraints**: Uses identical permission and timing rules as single appointment editing

### 2. Edit Process Flow

**Core Rule**: Editing multi-time-slot appointments allows full re-selection of preferred time slots, with automatic handling of unavailable slots.

#### Patient Edit Process
1. Patient views appointment with "待安排" status
2. Clicks "修改預約" (modify appointment) within edit restriction window
3. System loads current `alternative_time_slots` and checks availability
4. Automatically deselects any slots that are no longer available
5. Patient can modify selections using the same multi-slot interface as booking
6. Upon saving, appointment resets to `pending_time_confirmation = true`
7. Auto-confirmation timer restarts from edit timestamp

#### State Changes on Edit
- **Appointment Status**: Remains confirmed until edit is saved, then becomes pending
- **Time Confirmation**: Resets to `pending_time_confirmation = true`
- **Alternative Slots**: Updates with new patient selections
- **Temporary Slot**: Reassigns to earliest available slot from new selections
- **Auto-Confirmation**: Timer resets and restarts from edit time

### 3. Unavailable Slots Handling

**Core Rule**: When editing, unavailable slots are silently removed from selection without user notification.

#### Automatic Deselection Logic
- Load patient's current `alternative_time_slots`
- Validate each slot against current availability
- Remove unavailable slots from pre-selected state
- Pre-populate UI with only available slots selected
- Allow patient to continue editing with remaining selections

#### Minimum Selection Requirement
- If no slots remain available after deselection, patient must select at least 1 new slot
- Cannot save edit with 0 selected slots
- Validation prevents submission until minimum requirements met

### 4. Clinic Integration

**Core Rule**: Editing triggers clinic notifications and resets review workflow.

#### Clinic Notifications
- **Edit Notification**: Clinic receives notification when patient modifies preferences
- **Priority Handling**: Edited appointments may receive higher priority in pending review queue
- **Review State**: Any existing review progress resets on patient edit

#### Auto-Confirmation Behavior
- **Timer Reset**: Auto-confirmation timer restarts from edit timestamp
- **Fresh Review Window**: Gives clinic full review period after patient changes
- **Race Condition Prevention**: Edit operations take precedence over pending auto-confirmation

## Backend Technical Design

### API Endpoints

#### Enhanced `PUT /liff/appointments/{appointment_id}` (Patient Edit)
- **New Request Fields**:
  - `edit_multiple_slots?: boolean` - Flag indicating this is a multi-slot edit operation
  - `selected_time_slots?: string[]` - New array of preferred time slots
- **Logic**: When `edit_multiple_slots=true`, validate edit permissions, update slots, reset confirmation state
- **Validation**: Check edit recency constraint, slot availability, booking restrictions
- **Side Effects**: Reset `pending_time_confirmation=true`, reassign temporary slot, restart auto-confirmation timer, send clinic notification

#### Enhanced `GET /liff/appointments/{appointment_id}` (Load for Edit)
- **Response Enhancement**: Include `alternative_time_slots` and availability status for editing
- **New Response Fields**:
  - `can_edit_multiple_slots: boolean` - Whether appointment can be edited (within recency window)
  - `available_alternative_slots: string[]` - Currently available slots from patient's preferences
  - `edit_deadline: string` - ISO datetime when edit window expires

### Database Schema (No Changes Required)

The existing multi-time-slot schema supports editing:
- `pending_time_confirmation` - Reset to true on edit
- `alternative_time_slots` - Updated with new selections
- `confirmed_at` - Cleared on edit
- `confirmed_by_user_id` - Cleared on edit

### Business Logic Implementation

#### AppointmentService Enhancements
**New Methods**:
- `edit_multiple_slot_appointment()`: Handles multi-slot edit with validation and state reset
- `validate_edit_permissions()`: Checks edit recency constraints for multi-slot appointments
- `filter_available_slots()`: Returns only available slots from patient's current preferences

**Enhanced Methods**:
- `update_appointment()`: Support `edit_multiple_slots` parameter with special handling

#### Auto-Confirmation Service Updates
- **Edit Detection**: Skip auto-confirmation for appointments recently edited by patient
- **Timer Reset Logic**: Update last modification timestamp to restart countdown
- **Edit Window Respect**: Never auto-confirm within edit restriction period

## Frontend Technical Design

### Component Architecture

#### Enhanced Appointment Edit Flow
```
LiffApp
  └── AppointmentDetailsPage
      ├── AppointmentCard (Enhanced)
      │   ├── TimeDisplay (shows "待安排" with edit button)
      │   ├── EditButton (enabled when within edit window)
      │   └── EditModal (New Component)
      │       ├── DateTimePicker (Enhanced - highlights selected slots)
      │       ├── MultipleTimeSlotSelector (Reused)
      │       ├── SelectedSlotsDisplay (Reused)
      │       └── EditActions (Save/Cancel)
```

#### New Components
- **EditModal** (`frontend/src/liff/appointment/components/EditModal.tsx`)
  - **UI Description**: Full-screen modal for multi-slot editing with date picker and slot selection
  - **Behavior**: Pre-loads current selections, handles unavailable slot deselection, validates before save
  - **Props**: `appointment`, `onSave`, `onCancel`
  - **State**: Loading, editing state, validation errors

### State Management Strategy

#### Enhanced AppointmentStore
**New Actions**:
- `loadAppointmentForEdit()`: Load appointment data with availability checking
- `editMultipleSlots()`: Update appointment with new slot selections
- `validateEditPermissions()`: Check if edit is allowed

**State Updates**:
```typescript
interface AppointmentStore {
  // Existing state...
  editingAppointment: Appointment | null;
  availableSlotsForEdit: string[];
  editDeadline: string | null;
  canEditMultipleSlots: boolean;
}
```

### User Interaction Flows

#### Flow: Patient Edits Multi-Time-Slot Appointment
1. **View Appointment**: Patient sees appointment with "待安排" status and enabled edit button
2. **Initiate Edit**: Click "修改預約" → system checks edit permissions → opens edit modal
3. **Load Current State**: System loads `alternative_time_slots` → filters available slots → pre-selects available ones
4. **Modify Selections**: Patient can add/remove slots using familiar interface
5. **Validation & Save**: System validates selections → updates appointment → resets to pending state
6. **Confirmation**: Success message "時段偏好已更新" → appointment shows updated "待安排" status

#### Flow: Clinic Receives Edit Notification
1. **Notification**: Clinic receives "患者已修改時段偏好" alert
2. **Review Queue**: Appointment reappears in pending review with updated preferences
3. **Fresh Review**: Clinic reviews new patient preferences with full confirmation window

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

## Implementation Plan

### Phase 1: Backend API Enhancement (Week 1)
- [ ] Add `edit_multiple_slots` support to appointment update endpoint
- [ ] Implement edit permission validation using existing recency constraint
- [ ] Add slot availability filtering for edit operations
- [ ] Update auto-confirmation service to handle edit resets
- [ ] Add clinic notification for patient edits

### Phase 2: Frontend Edit Modal (Week 2)
- [ ] Create `EditModal` component reusing existing slot selection components
- [ ] Enhance appointment details page with edit button and permissions check
- [ ] Add edit state management to appointment store
- [ ] Implement pre-population with filtered available slots
- [ ] Add comprehensive validation and error handling

### Phase 3: Integration & Testing (Week 3)
- [ ] Update patient appointment list to show edit availability
- [ ] Add Chinese translations for edit interface
- [ ] Implement E2E tests for edit flow
- [ ] Add integration tests for permission validation
- [ ] Update documentation and edge case handling

## Testing Requirements

### E2E Tests
- [ ] **Edit Permission Check**: Verify edit button availability within/outside recency window
- [ ] **Unavailable Slot Handling**: Test automatic deselection of unavailable slots
- [ ] **Edit Flow**: Complete edit process with slot modifications and state reset
- [ ] **Clinic Notification**: Verify clinic receives edit notifications
- [ ] **Race Condition**: Test edit during auto-confirmation window

### Integration Tests
- [ ] **API Validation**: Edit permission checks and slot availability filtering
- [ ] **State Management**: Appointment state reset and timer restart
- [ ] **Notification System**: Clinic alerts for patient edits

### Unit Tests
- [ ] **EditModal Component**: Pre-population, validation, save logic
- [ ] **Appointment Service**: Edit permission validation and slot filtering
- [ ] **Auto-Confirmation**: Timer reset on patient edits

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

## Integration Points

- **Existing Edit Constraint**: Uses "預約取消/修改限制" setting from clinic configuration
- **Multi-Slot Components**: Reuses `MultipleTimeSlotSelector` and `SelectedSlotsDisplay`
- **Appointment Store**: Extends existing state management patterns
- **Notification System**: Integrates with existing LINE notification templates
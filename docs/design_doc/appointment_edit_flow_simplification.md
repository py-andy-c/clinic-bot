# Appointment Edit Flow Simplification - Business Logic & Technical Design

## Overview

Simplify appointment edit modal state management by removing complex auto-deselection and auto-expansion logic. Always preserve user's date/time selection, show conflicts as informational warnings rather than blocking progression. Enable "下一步" button regardless of conflicts while providing real-time feedback.

**Goals**: Reduce state complexity, improve UX predictability, allow users to proceed with conflict warnings.

**Additional Scope**:
- Align RecurrenceDateTimePickerWrapper behavior for consistent conflict resolution experience
- Add accessibility support for conflict warnings
- Document conflict types and blocking vs. informational behavior

---

## Key Business Logic

### 1. Conflict Warnings Are Informational

Users can see scheduling conflicts (time overlaps, practitioner unavailability, resource issues) but are not blocked from proceeding.

**Rationale**: Users may intentionally schedule conflicting appointments (rescheduling existing ones) or accept override conditions.

### 2. Preserve Date/Time Selection

Original appointment's date and time remain selected regardless of practitioner/type changes or conflicts.

**Rationale**: Maintains user context and prevents unexpected form clearing that confuses users.

---

## Frontend Technical Design

### State Management Strategy

#### Server State (API Data)
- [x] **Data Source**: `checkSchedulingConflicts()` API for real-time conflict detection
- [x] **React Query Hooks**:
  - No new hooks needed - conflicts checked via direct API call in component
- [x] **Query Keys**: N/A (not cached)
- [x] **Cache Strategy**:
  - `staleTime`: N/A (real-time checks)
  - `cacheTime`: N/A (not cached)
  - Invalidation triggers: N/A

#### Client State (UI State)
- [x] **Local Component State**: EditAppointmentModal
  - `conflictInfo`: Current scheduling conflicts (appointment overlaps, practitioner exceptions, etc.)
  - `isCheckingConflict`: Loading state during conflict check
  - `conflictCheckError`: Error message if conflict check fails

- [x] **useAppointmentForm Hook**:
  - Remove auto-deselection logic (lines 336-344)
  - Keep all existing form state: `selectedDate`, `selectedTime`, `selectedPractitionerId`, etc.

#### Form State
- [x] **React Hook Form**: N/A (uses custom form logic)
  - Form fields: appointment_type, practitioner, date, time, resources, notes
  - Validation rules: Basic field presence (no conflict validation)
  - Default values: Original appointment values

### Component Architecture

#### Component Hierarchy
```
EditAppointmentModal
├── AppointmentReferenceHeader
├── AppointmentTypeSelector
├── PractitionerSelector
├── DateTimePicker (collapsed by default)
│   └── ConflictDisplay (shows warnings)
├── ResourceSelection
└── ClinicNotesTextarea
```

#### Component List
- [x] **EditAppointmentModal** - Main modal container
  - Props: event, practitioners, appointmentTypes, onClose, onConfirm
  - State: conflictInfo, isCheckingConflict, conflictCheckError
  - Dependencies: useAppointmentForm, DateTimePicker, ConflictDisplay

- [x] **DateTimePicker** - Simplified date/time selector
  - Props: selectedDate, selectedTime, selectedPractitionerId, appointmentTypeId
  - State: isExpanded, conflictInfo, isCheckingConflict
  - Dependencies: ConflictDisplay

- [x] **ConflictDisplay** - Shows conflict warnings (unchanged)

### User Interaction Flows

#### Flow 1: Edit Modal Opens (Initial Load)
1. Modal opens with original appointment data pre-filled
2. Conflict check runs immediately for existing appointment
3. If conflicts exist, ConflictDisplay shows warnings below DateTimePicker
4. "下一步" button enabled regardless of conflicts
   - Edge case: Network error → show generic error, still allow progression
   - Error case: Conflict check fails → show "無法檢查時間衝突" warning

#### Flow 2: Practitioner Change
1. User selects different practitioner
2. Conflict check runs immediately with new practitioner + original time
3. ConflictDisplay updates with new warnings (or clears if no conflicts)
4. DateTimePicker stays collapsed, preserves original date/time
5. "下一步" button remains enabled
   - Edge case: Practitioner doesn't offer appointment type → conflict shown but user can proceed

#### Flow 3: DateTimePicker Expansion
1. User clicks collapsed DateTimePicker to expand
2. Wait for availability data to load (monthly calendar)
3. If selected time conflicts, **clear the selection** (user intent to reselect is clear)
4. User must select a new time from available slots
   - Edge case: Selected time not available → clear selection and show conflict warning

#### Flow 4: Form Submission with Conflicts
1. User clicks "下一步" despite conflict warnings
2. Form validates basic fields only (ignores conflicts)
3. Proceeds to review step with conflict warnings visible
4. User can still confirm and save conflicted appointment

## Conflict Types & Behavior

### Blocking Conflicts (Prevent Save)
- **Practitioner-Type Incompatibility**: "此治療師不提供此預約類型"
- **Time Unavailability**: "此時段不可用" (when `allow_override=false`)
- **Backend Validation**: All conflicts are validated during save, override mode bypasses availability checks but not type compatibility

### Informational Conflicts (Warnings Only)
- **Availability Conflicts**: Time outside practitioner's normal hours ("非正常可用時間")
- **Appointment Conflicts**: Overlapping with existing appointments
- **Exception Conflicts**: Conflicts with practitioner unavailability periods
- **Resource Conflicts**: Insufficient resources available
- **Past Appointments**: Appointment scheduled in the past

### Button Enablement Logic
- **Always enabled**: For informational conflicts (warnings shown, user can proceed)
- **Disabled only**: When basic form validation fails (missing required fields)
- **Never disabled**: Due to conflict warnings - conflicts are informational, not blocking

### DateTimePicker State Transitions

#### Conflict Display Behavior
- **Collapsed state**: Conflict warnings shown below picker button, conflicted time preserved
- **Expanded state**: Conflict warnings shown below time selection area, conflicted time cleared
- **Collapse after expand**: If user collapses without selecting new time, selection remains cleared

#### Expansion Triggers
- **User intent**: Clicking collapsed picker indicates intent to change time
- **Conflict resolution**: Clear conflicted selection to force user choice
- **State preservation**: No auto-expansion on practitioner/type changes

#### Resource Conflict Interaction
- **Independent checks**: Resource conflicts checked separately from time conflicts
- **Combined display**: All conflict types shown together in ConflictDisplay
- **Validation timing**: Resource conflicts validated after time selection
- **Override behavior**: Resource conflicts follow same informational vs blocking logic

#### Override Mode Integration
- **Conflict bypass**: Override mode allows proceeding despite time availability conflicts
- **Preserved validation**: Practitioner-type compatibility still enforced in override mode
- **UI behavior**: Same conflict display logic applies, but backend allows save
- **User choice**: Override toggle provides explicit opt-in for conflict acceptance

---

### State Management Strategy

#### Client State (UI State)
- [x] **Local Component State**: EditAppointmentModal
  - `conflictInfo`: Current scheduling conflicts (appointment overlaps, practitioner exceptions, etc.)
  - `isCheckingConflict`: Loading state during conflict check
  - `conflictCheckError`: Error message if conflict check fails

### Component Architecture

#### Component List
- [x] **ConflictDisplay** - Shows conflict warnings (needs accessibility improvements)
  - Accessibility: Add ARIA live regions for screen reader announcements
  - Features: High contrast warning colors, clear iconography

### Edge Cases and Error Handling

#### Edge Cases
- [x] **Race Condition**: Multiple practitioner changes → latest change wins, previous checks cancelled
  - **Solution**: AbortController cancels in-flight conflict checks
- [x] **Clinic Switching**: N/A (modal closes on clinic switch)
  - **Solution**: Component unmounts, requests abort
- [x] **Network Failure**: Conflict check fails → show error but allow progression
  - **Solution**: Graceful degradation with user-friendly error message
- [x] **Component Unmount**: Conflict check in progress → request aborted
  - **Solution**: useEffect cleanup with AbortController
- [x] **Accessibility**: Screen reader support for conflict warnings
  - **Solution**: Add ARIA live regions, proper labeling, high contrast colors
- [x] **DateTimePicker state transitions**: Conflict display behavior when expanding/collapsing
  - **Solution**: Clear conflicted selection on expand, preserve on collapse
- [x] **Conflict check debouncing**: Performance optimization during active user interaction
  - **Solution**: Immediate checks for practitioner/type changes, debounced for time selection
- [x] **Notification requirements**: Conflict impact on LINE notification logic
  - **Solution**: Conflicts don't affect notification requirements - backend handles separately
- [x] **Form state persistence**: Conflict visibility when returning from review step
  - **Solution**: Re-run conflict checks when re-entering edit step
- [x] **Resource-time conflict interaction**: How resource conflicts relate to time selection
  - **Solution**: Independent validation, combined display in ConflictDisplay

#### Error Scenarios
- [x] **API Errors**: Conflict check 5xx error
  - **User Message**: "無法檢查時間衝突，請稍後再試"
  - **Recovery Action**: Allow progression, backend validates on save
- [x] **Validation Errors**: N/A (no client-side conflict validation)
  - **User Message**: N/A
  - **Field-level Errors**: N/A
- [x] **Loading States**: Conflict check in progress
  - **Initial Load**: Spinner in DateTimePicker
  - **Practitioner Change**: Spinner in DateTimePicker during check

### Testing Requirements

#### E2E Tests (Playwright)
- [x] **Edit with conflicts**: Open edit modal with conflicting appointment
  - Steps: Open edit modal → verify conflict warning shown → click "下一步" → verify progression works
  - Assertions: Button enabled, conflict display visible, form submits successfully
- [x] **Practitioner change conflicts**: Change practitioner causing conflicts
  - Steps: Change practitioner → verify conflict updates → verify button stays enabled
  - Assertions: Conflict display updates, DateTimePicker stays collapsed

#### Integration Tests (MSW)
- [x] **Conflict check API**: Mock conflict response
  - Mock API responses: Various conflict types (appointment, exception, availability)
  - User interactions: Change practitioner, change time
  - Assertions: Conflict display updates, button remains enabled

#### Unit Tests
- [x] **useAppointmentForm**: Remove auto-deselection logic
  - Test cases: Practitioner change doesn't clear time, form stays valid
- [x] **DateTimePicker**: Conflict display logic
  - Test cases: Shows conflicts in collapsed/expanded state, doesn't block progression
- [x] **ConflictDisplay**: Accessibility features
  - Test cases: ARIA labels, screen reader announcements, high contrast colors

---

## Performance Considerations

- [x] **Data Loading**: Conflict checks use debouncing (300ms) and request cancellation
- [x] **Caching**: No caching for real-time conflict validation
- [x] **Optimistic Updates**: N/A (conflict checks are read-only)
- [x] **Lazy Loading**: N/A (conflict display is always loaded)
- [x] **Memoization**: ConflictDisplay component uses memo for performance
- [x] **Accessibility**: ARIA live regions for efficient screen reader updates

---

## Integration Points

### Backend Integration
- [x] Uses existing `checkSchedulingConflicts` API
- [x] No database changes required
- [x] API contracts unchanged

### Frontend Integration
- [x] **Shared components used**: DateTimePicker, ConflictDisplay (modified behavior)
- [x] **Shared hooks used**: useAppointmentForm (simplified)
- [x] **Shared stores used**: N/A
- [x] **Navigation/routing changes**: N/A

---

## Security Considerations

- [x] Authentication requirements: Existing modal auth
- [x] Authorization checks: Existing appointment permissions
- [x] Input validation: Backend validates conflicts on save
- [x] XSS prevention: Existing React sanitization
- [x] CSRF protection: Existing API protection

---

## Migration Plan

### Phase 1: Core Logic Changes
- [x] Remove auto-deselection from useAppointmentForm
- [x] Remove hasAvailableSlots from button disable condition
- [x] Add immediate conflict check on modal open

### Phase 2: DateTimePicker Simplification
- [x] Remove auto-expansion logic
- [x] Remove monthly availability fetch on practitioner change
- [x] Update conflict display to show in collapsed state

### Phase 3: Testing & Polish
- [x] Update E2E tests for new behavior
- [x] Test impact on CreateAppointmentModal and RescheduleFlow
- [x] Add loading states for conflict checks

### Phase 4: Recurrence Conflict Resolution Enhancement (Optional)
- [x] Align RecurrenceDateTimePickerWrapper with appointment edit modal behavior
- [x] Add conflict display on occurrence edit start
- [x] Add original time display for context
- [x] Add loading states during conflict checks
- [x] Add accessibility support (ARIA labels, screen reader announcements)
- [x] Update tests for enhanced conflict resolution experience

---

## Success Metrics

- [x] **Appointment editing efficiency**: Reduced time to complete appointment edits with conflicts
- [x] **Error reduction**: Fewer user reports about disabled buttons and unexpected UI behavior
- [x] **Conflict visibility**: Users can see and understand scheduling conflicts before proceeding
- [x] **UX consistency**: Unified editing experience across appointment edit modal and recurrence conflict resolution
- [x] **Accessibility compliance**: Conflict warnings are accessible to screen reader users

---

## Impact on Other DateTimePicker Users

### CreateAppointmentModal - Recurrent Appointments Conflict Resolution
- [x] **Current behavior**: Uses `RecurrenceDateTimePickerWrapper` in 'conflict-resolution' step for editing individual occurrences
- [x] **Impact**: ✅ **Low impact** - wrapper doesn't use `onHasAvailableSlotsChange`, conflict resolution logic differs
- [x] **Rationale**: Conflict resolution step allows proceeding with conflicts, doesn't use same validation as edit modal
- [x] **Details**:
  - `RecurrenceDateTimePickerWrapper` initializes with `selectedTime=''` to prevent auto-selection
  - Button enabled when `occurrences.length > 0` (not based on slot availability)
  - Users explicitly resolve conflicts by editing individual occurrences
  - Conflict resolution step proceeds regardless of remaining conflicts

### CreateAppointmentModal - Regular Appointments
- [x] **Current behavior**: Starts with empty date/time, no conflicts shown initially
- [x] **Impact**: ✅ **None** - component behavior unchanged, conflict checks only run when date/time selected
- [x] **Rationale**: Create flow doesn't pre-populate conflicting times, so simplified logic doesn't affect it

### LIFF Appointment Flow (Step3SelectDateTime)
- [x] **Current behavior**: Custom DateTimePicker implementation, no conflict checking
- [x] **Impact**: ✅ **None** - uses separate calendar component, not shared DateTimePicker
- [x] **Rationale**: LIFF flow has its own availability logic, doesn't use DateTimePicker conflict system

### RescheduleFlow
- [x] **Current behavior**: Not found in codebase search
- [x] **Impact**: ❓ **Unknown** - may not exist or use different component
- [x] **Rationale**: No references to DateTimePicker in reschedule-related files

### Overall Impact Assessment
- [x] **Low risk**: Changes isolated to EditAppointmentModal's DateTimePicker usage
- [x] **Backward compatible**: Other components continue working as before
- [x] **One low-impact change**: Recurrent appointment conflict resolution may be slightly affected but maintains existing behavior
- [x] **No breaking changes**: Simplified DateTimePicker behavior only affects conflict display logic

## Future Enhancements

### RecurrenceDateTimePickerWrapper Alignment
- [x] **Align with appointment edit modal behavior**: Make individual occurrence editing consistent with appointment editing
- [x] **Implementation**:
  - Check and display conflicts on wrapper mount (when editing starts)
  - Display original time statically (e.g., "原預約時間：2026/1/27(二) 09:00")
  - Show conflict warnings but allow proceeding with conflicts
  - Disable editing during conflict check loading states
- [x] **Benefits**: Consistent UX across all appointment editing contexts, better conflict visibility
- [x] **Scope**: Separate enhancement after core simplification is complete

## Open Questions

- [x] **DateTimePicker expansion behavior**: ✅ **Resolved** - Clear conflicted time on expansion, preserve on collapse
- [x] **Conflict acknowledgment**: ✅ **Resolved** - No explicit acknowledgment needed, warnings are sufficient
- [x] **Performance optimization**: ✅ **Resolved** - Immediate for practitioner/type changes, debounced for time selection

---

## References

- [Current DateTimePicker implementation](../frontend/src/components/calendar/DateTimePicker.tsx)
- [EditAppointmentModal](../frontend/src/components/calendar/EditAppointmentModal.tsx)
- [ConflictDisplay component](../frontend/src/components/shared/ConflictDisplay.tsx)

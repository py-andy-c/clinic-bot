# Appointment Checkout Status and Receipt Management Design Document

## Overview

This document describes the design for displaying checkout status indicators for appointments and managing receipt access throughout the application. The goal is to clearly show which appointments are checked out, provide receipt viewing capabilities, and enforce critical business constraints to maintain accounting integrity.

## Objectives

1. **Visual Clarity**: Add checkout status indicators to all appointment display locations
2. **Receipt Access**: Enable patients and clinic users to view receipts appropriately
3. **Data Integrity**: Enforce critical constraints preventing modification of appointments with receipts
4. **Consistency**: Use consistent visual indicators across calendar, modals, and lists

## Critical Business Constraints

### Constraint 1: Previously Checked Out Appointments Cannot Be Modified
- **Rule**: If an appointment has **any receipt** (active or voided), it is considered "previously checked out"
- **Restrictions**: Previously checked out appointments **cannot** be:
  - **Deleted**: Appointment deletion is blocked (enforced by both database FK constraint `ON DELETE RESTRICT` and application validation)
  - **Edited**: All appointment fields are immutable:
    - Time (start_time, end_time)
    - Practitioner (user_id)
    - Appointment type (appointment_type_id)
    - Patient notes (notes)
    - Clinic notes (clinic_notes)
    - Custom event name (custom_event_name)
  - **Rescheduled**: Time/practitioner changes are blocked
  - **Cancelled**: Status change to cancelled is blocked (applies to both `canceled_by_patient` and `canceled_by_clinic`)
- **Applies to**: Both clinic users and patients
- **Rationale**: Maintains accounting integrity and audit trail
- **Note**: Once an appointment has any receipt (even if voided), it can never be modified or cancelled
- **Bulk operations**: Bulk cancel/delete operations should check all appointments first and fail atomically if any have receipts

### Constraint 2: Cancelled Appointments Cannot Be Checked Out
- **Rule**: Cancelled appointments cannot have receipts created
- **Enforcement**: Already implemented in `ReceiptService.create_receipt()` (validates `status == "confirmed"`)
- **Corollary**: A cancelled appointment should never have a receipt (active or voided)
- **Note**: "Cancelled" includes both `canceled_by_patient` and `canceled_by_clinic` statuses

### Constraint 3: Receipt Visibility
- **Patients**: Can only see **active receipts** (not voided)
- **Clinic Users**: Can see **all receipts** (active and voided)

## Current State

### Backend Support
- Receipt data is currently available in API responses:
  - `has_receipt`: Whether appointment has any receipt (voided or active)
  - `receipt_id`: ID of receipt (if exists)
  - `is_receipt_voided`: Whether the returned receipt is voided
- Available in:
  - Calendar API (`CalendarEventResponse`)
  - Patient appointments API (`AppointmentListItem`)
  - LINE appointments API

**Note**: Current implementation has ambiguity:
- `has_receipt = true` means there's at least one receipt (could be voided)
- Checkout status requires: `has_receipt && !is_receipt_voided`
- This is confusing and error-prone

### Existing Validations
- ✅ Receipt creation validates appointment status is "confirmed" (prevents checkout on cancelled)
- ❌ No validation preventing edit/delete/reschedule/cancel on appointments with receipts

## Proposed API Changes

### New Fields
- **Replace** `has_receipt` + `is_receipt_voided` with:
  - `has_active_receipt`: Boolean indicating if appointment has an active (non-voided) receipt
  - `has_any_receipt`: Boolean indicating if appointment has any receipt (active or voided) - **NEW**
  - `receipt_id`: ID of active receipt (null if no active receipt)
  - `receipt_ids`: List of all receipt IDs (always included, empty array if none) - **NEW**
  
**Note**: `is_receipt_voided` is removed entirely. The boolean flags (`has_active_receipt`, `has_any_receipt`) are sufficient and clearer.

### Checkout Status Logic
- **Checked Out**: `has_active_receipt === true`
- **Not Checked Out**: `has_active_receipt === false`
- **Previously Checked Out**: `has_any_receipt === true` (used for constraint enforcement)

## Design Decisions

### Q1: Database Column for Checkout Status?
**Decision**: No new column needed.

**Rationale**:
- Checkout status is derived from receipt relationship
- Avoids data duplication and synchronization issues
- Current design already supports this via `appointment.receipt` relationship
- Only one active (non-voided) receipt can exist per appointment

### Q2: API Field Naming?
**Decision**: Use `has_active_receipt` and `has_any_receipt`.

**Rationale**:
- `has_active_receipt`: Directly answers "is this appointment checked out?"
- `has_any_receipt`: Directly answers "can this appointment be modified?" (constraint enforcement)
- Clear separation of concerns

### Q3: Multiple Void/Reissue Cycles?
**Decision**: Always check for active receipt only for checkout status.

**Handling**:
- System allows multiple receipts per appointment (one active, others voided)
- Checkout status is determined by: `has_active_receipt === true`
- Constraint enforcement uses: `has_any_receipt === true`
- If receipt is voided → not checked out, but still "previously checked out"
- If new receipt is created → checked out again
- This logic naturally handles any number of void/reissue cycles

## Patient View Changes

### LIFF Appointment List Redesign

**Current**: Simple list of upcoming appointments
**New**: Tabbed interface similar to clinic admin patient detail page

**Tabs**:
1. **未來預約** (Future / 未来预约): Confirmed appointments in the future
2. **已完成** (Past / 已完成): Confirmed appointments in the past
3. **已取消** (Cancelled / 已取消): Cancelled appointments (by patient or clinic)

**Features**:
- Each appointment card shows:
  - Appointment details (time, practitioner, type)
  - Status badge
  - **"查看收據" button** (only if `has_active_receipt === true`)
- Previously checked out appointments:
  - No edit/delete/reschedule/cancel buttons
  - Clear indication that appointment cannot be modified

**UX Considerations**:
- **Mobile responsiveness**: Tabs should be swipeable on mobile devices
- **Card layout**: Receipt button should be prominently placed but not interfere with appointment details
- **Tab navigation**: Use standard mobile tab patterns (bottom navigation or top tabs with scroll)
- **Loading states**: Show loading indicators when switching tabs

### Receipt Viewing (Patient)

**Access**: Only for appointments with `has_active_receipt === true`

**Display**:
- HTML receipt view (read-only)
- **Download PDF** button
- No access to voided receipts

**Implementation**:
- New endpoint: `GET /liff/appointments/{appointment_id}/receipt`
- **Authorization**: 
  - Verify patient owns the appointment (via LINE user)
  - Verify receipt exists and is active
  - Return 404 (not 403) if receipt doesn't exist (security best practice)
- Returns active receipt only (filters out voided)
- Uses existing receipt HTML/PDF generation endpoints
- **Error handling**: 
  - 404 if appointment not found or doesn't belong to patient
  - 404 if no active receipt exists (button should be hidden when `has_active_receipt === false`)

## Clinic Side Changes

### Calendar View

**Visual Indicators**:
- Checked out appointments styled differently but **maintain practitioner color theme**
- Options:
  - Green checkmark icon overlay (top-right corner)
  - Subtle border accent (green border)
  - Background pattern/texture (e.g., diagonal stripes)
- **Multi-practitioner view**: Each practitioner's color preserved, checkout indicator added

**Implementation**:
- Update `eventStyleGetter` in `CalendarView.tsx`
- Add checkout indicator to `CustomEventComponent`
- Ensure practitioner colors remain visible

### Event Modal

**Receipt Access**:
- **"檢視收據" button** appears if `has_any_receipt === true`
- **Single receipt**: Direct to HTML view + PDF download
- **Multiple receipts**: Show receipt list modal, then HTML view + PDF download for selected receipt

**Receipt List Modal** (when multiple receipts exist):
- List all receipts (active and voided)
- **Ordering**: Sort by issue date (newest first) - more meaningful to users than creation date
- **Display**: Show receipt number, issue date, void status (clearly indicate active vs voided)
- **Selection**: Click receipt → show HTML view + PDF download
- **PDF Access**: Clinic users can view/download PDFs of all receipts (active and voided) for audit purposes
- **Pagination**: Not needed (typically 1-3 receipts per appointment, max ~5 in edge cases)
- **Visual distinction**: Highlight active receipt, gray out voided receipts

**Previously Checked Out Indicator**:
- Clear visual/text indication that appointment cannot be modified
- Disable/hide edit, delete, reschedule, cancel buttons
- Show reason: "此預約已有收據，無法修改"

### Patient Appointments List

- Checkout status badge in appointment card
- "檢視收據" button if `has_any_receipt === true`
- Previously checked out appointments: no edit/delete buttons

## Global Constraints Implementation

### Backend Validation

**Add validation to prevent modification of appointments with receipts:**

1. **AppointmentService.update_appointment()**:
   ```python
   # Lock appointment row to prevent race conditions
   # Use NOWAIT to fail fast if another transaction is modifying
   appointment = db.query(Appointment).filter(
       Appointment.calendar_event_id == appointment_id
   ).with_for_update(nowait=True).first()
   
   if not appointment:
       raise HTTPException(status_code=404, detail="預約不存在")
   
   # Check if appointment has any receipt (within same transaction)
   # Use single query for efficiency
   receipts = db.query(Receipt).filter(
       Receipt.appointment_id == appointment_id
   ).all()
   
   if len(receipts) > 0:
       raise HTTPException(
           status_code=status.HTTP_403_FORBIDDEN,
           detail="此預約已有收據，無法修改"
       )
   
   # Continue with update...
   # Transaction is committed or rolled back by caller
   ```

**Error Handling for Lock Timeouts**:
```python
from sqlalchemy.exc import OperationalError

try:
    appointment = db.query(Appointment).filter(
        Appointment.calendar_event_id == appointment_id
    ).with_for_update(nowait=True).first()
except OperationalError as e:
    # Handle lock timeout - another transaction is modifying
    db.rollback()
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="此預約正在被其他操作修改，請稍後再試"
    )
```

2. **AppointmentService.cancel_appointment()**:
   ```python
   # Lock appointment row to prevent race conditions
   appointment = db.query(Appointment).filter(
       Appointment.calendar_event_id == appointment_id
   ).with_for_update(nowait=True).first()
   
   if not appointment:
       raise HTTPException(status_code=404, detail="預約不存在")
   
   # Check if appointment has any receipt (within same transaction)
   receipts = db.query(Receipt).filter(
       Receipt.appointment_id == appointment_id
   ).all()
   
   if len(receipts) > 0:
       raise HTTPException(
           status_code=status.HTTP_403_FORBIDDEN,
           detail="此預約已有收據，無法取消"
       )
   
   # Continue with cancellation...
   # Transaction is committed or rolled back by caller
   ```

**Error Handling for Lock Timeouts** (same as update_appointment):
```python
from sqlalchemy.exc import OperationalError

try:
    appointment = db.query(Appointment).filter(
        Appointment.calendar_event_id == appointment_id
    ).with_for_update(nowait=True).first()
except OperationalError as e:
    db.rollback()
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="此預約正在被其他操作修改，請稍後再試"
    )
```

**Transaction Boundaries**:
- Validation and modification must occur within the same database transaction
- Use `with_for_update(nowait=True)` to fail fast on concurrent modifications
- Handle `OperationalError` (lock timeout) and return appropriate error to user
- All constraint checks happen before any modifications are made

3. **Appointment deletion** (if implemented):
   - Same validation as above

4. **ReceiptService.create_receipt()**:
   - ✅ Already validates: `appointment.status == "confirmed"` (prevents checkout on cancelled)

### Frontend Validation

**Disable UI elements for previously checked out appointments:**
- Check `has_any_receipt` before showing edit/delete/reschedule/cancel buttons
- Show disabled state or hide buttons entirely
- Display message: "此預約已有收據，無法修改"

**Note**: Frontend validation is for UX only. Backend validation is the source of truth.

**Error Messages**:
- **Language**: Error messages are in Chinese (繁體中文) for user-facing errors
- **i18n**: Consider using i18n keys for future multi-language support
- **Consistency**: Use consistent error message format across all endpoints
- **Examples**:
  - Edit: "此預約已有收據，無法修改" (This appointment has a receipt and cannot be modified)
  - Cancel: "此預約已有收據，無法取消" (This appointment has a receipt and cannot be cancelled)
  - Checkout cancelled: "已取消的預約無法結帳" (Cancelled appointments cannot be checked out)

## Edge Cases and Questions

### Edge Cases

1. **Receipt created, then appointment cancelled**
   - **Prevention**: Constraint 2 prevents this (cannot checkout cancelled appointments)
   - **If it happens**: Data integrity issue - need database constraint or cleanup

2. **Appointment cancelled, then receipt creation attempted**
   - **Prevention**: Already handled by `ReceiptService.create_receipt()` validation
   - **Status**: ✅ Implemented

3. **Appointment with voided receipt, user tries to edit**
   - **Prevention**: Constraint 1 prevents this (`has_any_receipt === true`)
   - **Status**: ⚠️ Needs implementation

4. **Appointment with active receipt, user tries to delete**
   - **Prevention**: Constraint 1 prevents this
   - **Status**: ⚠️ Needs implementation

5. **Multiple receipts scenario - patient view**
   - **Decision**: Patient only sees active receipt (if exists)
   - **Implementation**: Filter to active receipts only in patient API

6. **Appointment checked out, receipt voided, appointment cancelled**
   - **Prevention**: Constraint 1 prevents cancellation after checkout (even if receipt is voided)
   - **Important**: Even if receipt is voided, `has_any_receipt === true` (voided receipt still exists), so appointment cannot be cancelled
   - **If cancelled first**: Cannot checkout (Constraint 2)
   - **Note**: Once an appointment has any receipt (active or voided), it can never be modified or cancelled

7. **Receipt voiding impact on checkout status**
   - **When receipt is voided**: 
     - `has_active_receipt` changes from `true` → `false` (checkout status: "checked out" → "not checked out")
     - `has_any_receipt` remains `true` (appointment remains "previously checked out")
     - Appointment cannot be modified (Constraint 1 still applies)
   - **UI updates**: Checkout indicator should update immediately (via refresh or real-time update), but modification buttons remain disabled
   - **Receipt re-issuance**: After voiding, clinic users can create a new receipt for the same appointment (separate action, not automatic)

8. **Receipt voiding during appointment edit attempt**
   - **Scenario**: User A voids receipt while User B is trying to edit appointment
   - **Behavior**: User B's edit attempt is blocked by Constraint 1 (voided receipt still counts as "any receipt")
   - **Status**: ✅ Correctly handled - voiding doesn't change `has_any_receipt`, so constraint still applies

9. **Bulk operations on appointments with receipts**
   - **Scenario**: Clinic tries to bulk cancel/delete appointments, some of which have receipts
   - **Behavior**: 
     - Check all appointments first (before any modifications)
     - Return list of which ones failed and why
     - Don't partially succeed (atomic operation - all or nothing)
     - Error message should indicate which appointments have receipts

10. **Appointment deletion with receipts**
   - **Database constraint**: `ON DELETE RESTRICT` on `receipts.appointment_id` FK prevents appointment deletion if receipts exist
   - **Application constraint**: Constraint 1 also prevents deletion
   - **Status**: ✅ Handled by both database FK constraint and application validation

### Questions

1. **Receipt deletion**: Should we allow deletion of receipts?
   - **Decision**: **NEVER** - Receipts are immutable legal documents. Only voiding is allowed to maintain audit trail and comply with legal requirements (7+ year retention).

2. **Historical data**: What about existing appointments with receipts that were modified?
   - **Decision**: **Not applicable** - The receipt feature has not been launched yet, so there is no historical data to worry about. Constraints will be enforced from the start.

3. **Error messages**: Should error messages be more specific?
   - **Clarification**: The question was whether to provide actionable guidance in error messages (e.g., "如需修改，請先作廢收據").
   - **Decision**: **No** - Voiding receipts is an accounting action, not a workflow step for modifying appointments. Error message should be clear but not suggest voiding receipts as a workaround: "此預約已有收據，無法修改" (This appointment has a receipt and cannot be modified).

4. **Database triggers**: Should we implement database-level constraints as a safety net?
   - **Recommendation**: **Yes** - For critical accounting constraints, database triggers provide a safety net against application bugs, race conditions, or direct database access. However, application-level validation should still be the primary mechanism for better error messages and user experience.
   - **Implementation**: Add trigger to prevent receipt creation on cancelled appointments (Constraint 2). Constraint 1 (preventing modification) is harder to enforce at database level but application validation with proper locking should be sufficient.

## Implementation Plan

### Phase 0: Database Constraints (Safety Net)

**Create Alembic Migration Script**:
- Create migration file for database triggers and indexes
- Include rollback strategy for trigger/index removal if needed
- Test migration on staging before production

**Add database trigger to prevent checkout on cancelled appointments** (Constraint 2):
```sql
-- Verify column name matches schema (appointment_id is FK in receipts table)
CREATE OR REPLACE FUNCTION prevent_checkout_cancelled()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM appointments 
    WHERE calendar_event_id = NEW.appointment_id 
    AND status != 'confirmed'
  ) THEN
    RAISE EXCEPTION 'Cannot create receipt for cancelled appointment';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_checkout_cancelled_trigger
  BEFORE INSERT ON receipts
  FOR EACH ROW
  EXECUTE FUNCTION prevent_checkout_cancelled();
```

**Performance**: Add indexes if not present:
```sql
CREATE INDEX IF NOT EXISTS idx_receipts_appointment_id ON receipts(appointment_id);
CREATE INDEX IF NOT EXISTS idx_receipts_is_voided ON receipts(is_voided);
CREATE INDEX IF NOT EXISTS idx_receipts_appointment_voided ON receipts(appointment_id, is_voided);
```

**Unique Constraint**: Ensure only one active receipt per appointment:
```sql
-- Partial unique index prevents multiple active receipts per appointment
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_one_active_per_appointment 
ON receipts(appointment_id) 
WHERE is_voided = false;
```

**Note**: This database-level constraint prevents race conditions where two concurrent checkout attempts could create multiple active receipts.

### Phase 1: Backend API Changes

1. **Update API responses**:
   - Add `has_active_receipt: bool`
   - Add `has_any_receipt: bool` (NEW)
   - Add `receipt_ids: List[int]` (for clinic users, all receipts)
   - Keep `receipt_id: Optional[int]` (active receipt ID)
   - Update `CalendarEventResponse` and `AppointmentListItem`

2. **Service Layer Updates**:
   - `appointment_service.py`: Update list methods to include new fields
   - `clinic.py`: Update calendar endpoint
   - Logic (optimized single query):
     ```python
     # Single query for efficiency (avoid N+1)
     receipts = db.query(Receipt).filter(
         Receipt.appointment_id == appointment_id
     ).all()
     
     # Compute all fields from single query result
     has_any_receipt = len(receipts) > 0
     active_receipt = next((r for r in receipts if not r.is_voided), None)
     has_active_receipt = active_receipt is not None
     receipt_id = active_receipt.id if active_receipt else None
     receipt_ids = [r.id for r in receipts]  # Always include, empty if none
     ```

3. **Add Constraint Validations**:
   - `AppointmentService.update_appointment()`: Check `has_any_receipt`
   - `AppointmentService.cancel_appointment()`: Check `has_any_receipt`
   - Add helper method: `_check_appointment_modifiable()`

### Phase 2: Patient View (LIFF)

1. **Redesign Appointment List**:
   - Convert to tabbed interface (future, past, cancelled)
   - Add "查看收據" button for appointments with `has_active_receipt === true`
   - Hide edit/delete/reschedule/cancel buttons for `has_any_receipt === true`

2. **Receipt Viewing**:
   - New endpoint: `GET /liff/appointments/{appointment_id}/receipt`
   - Returns active receipt only
   - HTML view + PDF download button

3. **Update Components**:
   - `AppointmentList.tsx`: Tabbed interface
   - `AppointmentCard.tsx`: Add receipt button, disable actions for previously checked out

### Phase 3: Clinic Side

1. **Calendar View**:
   - Update `eventStyleGetter` to show checkout indicator
   - Maintain practitioner color theme
   - Add checkout icon/indicator to `CustomEventComponent`

2. **Event Modal**:
   - Add "檢視收據" button if `has_any_receipt === true`
   - Single receipt: Direct to HTML view
   - Multiple receipts: Receipt list modal → HTML view
   - Disable edit/delete/cancel for `has_any_receipt === true`

3. **Receipt List Modal** (NEW):
   - Show all receipts (active and voided)
   - Receipt number, issue date, void status
   - Click → HTML view + PDF download

4. **Patient Appointments List**:
   - Add checkout status badge
   - Add "檢視收據" button
   - Disable actions for previously checked out

### Phase 4: Frontend Utility Functions

Create `frontend/src/utils/checkoutStatus.ts`:

```typescript
/**
 * Determine if appointment is checked out.
 * Checked out = has active (non-voided) receipt.
 */
export function isCheckedOut(hasActiveReceipt: boolean): boolean {
  return hasActiveReceipt === true;
}

/**
 * Determine if appointment can be modified.
 * Previously checked out = has any receipt (active or voided).
 */
export function canModifyAppointment(hasAnyReceipt: boolean): boolean {
  return !hasAnyReceipt;
}

/**
 * Get checkout status for display.
 * Returns null for cancelled appointments (no status shown).
 */
export function getCheckoutStatus(
  hasActiveReceipt: boolean,
  appointmentStatus: string
): 'checked_out' | 'not_checked_out' | null {
  if (appointmentStatus !== 'confirmed') {
    return null;
  }
  return hasActiveReceipt ? 'checked_out' : 'not_checked_out';
}
```

### Phase 5: Type Updates

**Specific TypeScript interfaces to update**:
- `CalendarEvent` interface in `frontend/src/utils/calendarDataAdapter.ts`:
  - Remove: `has_receipt`, `is_receipt_voided`
  - Add: `has_active_receipt`, `has_any_receipt`, `receipt_ids`
- `Appointment` interface in `frontend/src/components/patient/PatientAppointmentsList.tsx`
- `Appointment` interface in `frontend/src/liff/query/AppointmentList.tsx`
- `AppointmentListItem` type in API service types
- `CalendarEventResponse` type in API service types

**Shared types file** (recommended):
- Create `frontend/src/types/receipt.ts` for receipt-related types
- Export shared interfaces to ensure backend/frontend type sync
- Consider using OpenAPI schema generation for type safety

## Testing Strategy

### Unit Tests

1. **Backend Service Tests**:
   - `test_appointment_modification_with_receipt()`: Verify edit fails when receipt exists
   - `test_appointment_cancellation_with_receipt()`: Verify cancel fails when receipt exists
   - `test_checkout_cancelled_appointment()`: Verify checkout fails on cancelled appointment
   - `test_multiple_receipts_constraint()`: Verify constraint with voided receipts

2. **API Endpoint Tests**:
   - Test all modification endpoints with receipts
   - Test receipt viewing endpoints (patient vs clinic)
   - Test error messages

### Integration Tests

1. **Constraint Enforcement**:
   - Create appointment → Checkout → Try to edit (should fail)
   - Create appointment → Checkout → Void receipt → Try to edit (should fail)
   - Create appointment → Checkout → Try to cancel (should fail)
   - Cancel appointment → Try to checkout (should fail)

2. **Receipt Access**:
   - Patient can see active receipt
   - Patient cannot see voided receipt
   - Clinic can see all receipts
   - Multiple receipts display correctly

3. **UI State**:
   - Buttons disabled/hidden for previously checked out appointments
   - Checkout indicators display correctly
   - Receipt viewing works correctly

4. **Concurrent Modification** (Race Conditions):
   - Two users try to edit same appointment simultaneously
   - User tries to checkout while another user edits appointment
   - User tries to void receipt while another user edits appointment
   - Verify proper locking and error handling
   - Test lock timeout error handling (`OperationalError` → 409 response)
   - Test transaction rollback on constraint violation

5. **Database Trigger Tests**:
   - Attempt to create receipt for cancelled appointment (should fail at DB level)
   - Verify trigger error message is caught and handled gracefully by application
   - Test with both `canceled_by_patient` and `canceled_by_clinic` statuses

6. **Receipt Voiding Workflow Tests**:
   - Test that voiding receipt doesn't allow subsequent appointment edits
   - Test receipt re-issuance workflow (void → create new receipt)
   - Test UI updates when receipt is voided in another session

7. **Bulk Operations Tests**:
   - Test bulk cancel with mixed receipt statuses
   - Verify atomic behavior (all or nothing)
   - Verify error messages indicate which appointments failed

8. **Performance Tests**:
   - Query performance with receipt checks (measure N+1 query impact)
   - Bulk appointment loading with receipt data
   - API response time with new fields
   - Database trigger performance impact

### Database Constraints (Prevention Strategy)

**Defense-in-Depth Approach**:
- **Database Triggers**: Safety net for Constraint 2 (prevent checkout on cancelled) - implemented in Phase 0
- **Application-Level Validation**: Primary mechanism for both constraints
  - Service layer validation (already implemented for checkout)
  - Add validation for edit/cancel operations (Constraint 1)
  - Use row-level locking (`with_for_update(nowait=True)`) to prevent race conditions
  - Provides better error messages and user experience
- **Why both**: Database triggers protect against application bugs, race conditions, and direct database access. Application validation provides better UX with clear error messages.

**Note**: Constraint 1 (preventing modification) is harder to enforce at database level because:
- Would require triggers on multiple tables (`appointments`, `calendar_events`)
- Would need to handle multiple operation types (UPDATE, DELETE)
- Application validation with proper locking is more maintainable and provides better error messages
- Database FK constraint (`ON DELETE RESTRICT`) already prevents deletion at DB level

### Test Data Scenarios

Create test fixtures for:
1. Appointment with active receipt
2. Appointment with voided receipt
3. Appointment with multiple receipts (one active, others voided)
4. Cancelled appointment (no receipts)
5. Future appointment with receipt
6. Past appointment with receipt

### Regression Testing

**Critical paths to test after changes**:
1. ✅ Checkout workflow (existing)
2. ⚠️ Edit appointment (add constraint)
3. ⚠️ Cancel appointment (add constraint)
4. ⚠️ Delete appointment (add constraint if implemented)
5. ✅ Void receipt workflow (existing)
6. ⚠️ Receipt viewing (new)

## Migration Notes

### Breaking Changes
- API field changes: `has_receipt` → `has_active_receipt` + `has_any_receipt`
- New constraint: Previously checked out appointments cannot be modified
- LIFF appointment list UI change (tabbed interface)

### Data Migration
- No database migration needed (fields are computed)
- **Note**: Receipt feature has not been launched yet, so there is no historical data to migrate
- Constraints will be enforced from the start

### Backward Compatibility
- **Decision**: **Clean break** - Since receipt feature has not been launched, remove old fields (`has_receipt`, `is_receipt_voided`) entirely
- No deprecation period needed
- All frontend code must be updated to use new fields
- Update all API consumers at once

## Visual Design

### Checkout Status Badge
- **Checked Out**: Green badge with checkmark icon, text "已結帳"
- **Not Checked Out**: No badge (or subtle gray if needed)

### Calendar Event Indicator
- Small green checkmark icon in top-right corner
- Maintains practitioner color theme
- Subtle enough not to interfere with color coding

### Previously Checked Out Indicator
- Disabled state for action buttons
- Tooltip/message: "此預約已有收據，無法修改"
- Visual distinction (e.g., grayed out, lock icon)

## Summary

This document covers:
- Checkout status indicators for appointments
- Receipt viewing capabilities for patients and clinic users
- Critical business constraints preventing modification of appointments with receipts
- LIFF appointment list redesign with tabbed interface
- Calendar view enhancements maintaining practitioner color themes
- Comprehensive testing and prevention strategies

All open questions have been resolved. The design is ready for implementation.

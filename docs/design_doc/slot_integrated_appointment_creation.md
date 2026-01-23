# Slot-Integrated Appointment Creation - Design Document

## Overview

This design document outlines a **NEW feature** to auto-populate practitioner and start time in the Create Appointment Modal when a user clicks on a specific time slot under a specific practitioner column in the daily calendar view. The design focuses on respecting user selections, maintaining clarity, and handling edge cases gracefully with warnings instead of blocking actions.

> **Note:** This document describes **proposed changes** to be implemented. The current codebase does not yet support slot-based pre-population with practitioner context.

### Scope

- **Affected Users:** Clinic users only (admin dashboard / AvailabilityPage)
- **NOT Affected:** Patient-facing LIFF booking flow (keeps strict practitioner-type filtering)
- **Permission:** Any authenticated clinic user can use this feature (no admin role required)

---

## Business Logic Summary

### Rule of Thumb (Priority Order)

1. **Respect User Selections** - The user's explicit selections (from UI interactions) always take precedence. Never silently override what the user has chosen.
2. **Simplicity and Clarity** - The field interaction logic should be predictable and easy to understand. Avoid complex cascading behaviors that confuse users.
3. **Convenience with Transparency** - Auto-population is helpful but should be transparent. When auto-populated values create conflicts or issues, show warnings but allow proceeding.
4. **Allow "Invalid" Combinations with Warnings** - Users can select practitioners that don't offer the chosen appointment type, times that conflict with existing appointments, etc. Show prominent warnings but don't block.

### Field Dependency Matrix

The appointment form has 4 key fields with dependencies:

| Field | Dependencies | Current Behavior | New Behavior |
|-------|--------------|------------------|--------------|
| **Patient** | None | First field selected | No change |
| **Appointment Type** | Filters available practitioners | Required before practitioner selection | Can be selected after practitioner (with warnings) |
| **Practitioner** | Depends on appointment type for filtering | Auto-selected based on patient's assigned practitioners | Can be pre-populated from slot click; may be "outside" filtered list |
| **Date/Time** | Depends on practitioner & appointment type for conflict checking | Requires appointment type and practitioner first | Start time can be pre-populated from slot click |

---

## Proposed Field Interaction Logic (Redesigned)

### Core Principles

1. **Independent Selection** - Each field can be selected/changed independently. No field forces deselection of another.
2. **Validation at Submit** - All fields are validated together when submitting; warnings shown for problematic combinations.
3. **Visual Feedback** - Problematic selections show immediate inline warnings (not blocking).
4. **Soft Filtering** - Filtered lists show all items but highlight/label problematic ones.

### Field Interaction Flows

#### Flow 1: Normal Create Appointment (No Pre-population)
1. User clicks "+" button to create appointment
2. Modal opens with no pre-populated fields
3. User selects fields in any order (though guided order is: Patient → Appointment Type → Practitioner → Time)
4. Auto-selection behaviors:
   - When **Patient** is selected: If patient has assigned practitioners, those are highlighted in practitioner selection (but NOT auto-selected - removing current auto-selection for simplicity)
   - When **Appointment Type** is selected: Practitioner list shows all practitioners, but labels which ones don't offer this type
   - When **Practitioner** is selected: Enables date/time picker
5. Conflict checking runs in background; warnings displayed inline

#### Flow 2: Slot Click Pre-population (NEW)
1. User clicks a time slot under a practitioner column in daily view
2. Modal opens with:
   - **Practitioner**: Pre-populated with the clicked practitioner
   - **Start Time**: Pre-populated with the clicked slot time
   - **Date**: Pre-populated with the current calendar date
   - Other fields: Empty
3. User sees pre-populated values with visual indicators (e.g., "(從行事曆)" label)
4. User continues to fill in remaining fields:
   - **Patient**: User selects (no auto-population of assigned practitioner - respecting slot selection)
   - **Appointment Type**: User selects; if selected type is NOT offered by pre-populated practitioner, show warning but allow
5. User can change any pre-populated value at any time

#### Flow 3: Patient Detail Page (Existing)
1. User navigates from patient detail page
2. Modal opens with:
   - **Patient**: Pre-populated
3. Normal flow continues (current behavior maintained)

#### Flow 4: Appointment Duplication (Existing)
1. User duplicates an existing appointment
2. Modal opens with all fields pre-populated except time
3. Normal flow continues (current behavior maintained)

---

## State Management

### Source of Pre-population

We need to track WHERE each pre-populated value came from to properly handle conflicts:

```typescript
interface AppointmentFormContext {
  // Pre-populated values with their sources
  prePopulatedFrom: {
    practitioner?: 'slot_click' | 'patient_assignment' | 'duplication' | 'user_selection';
    time?: 'slot_click' | 'duplication' | 'user_selection';
    patient?: 'url_navigation' | 'duplication' | 'user_selection';
    appointmentType?: 'duplication' | 'user_selection';
  };
}
```

### State After User Interaction

| Pre-populated Field | User Changes Field | Result |
|--------------------|--------------------|--------|
| Practitioner (from slot) | User selects different practitioner | New selection wins, source = 'user_selection' |
| Time (from slot) | User selects different time | New selection wins, source = 'user_selection' |
| Practitioner (from slot) | User selects appointment type not offered by practitioner | Keep practitioner, show warning |
| Practitioner (from slot) | User selects patient with different assigned practitioner | Keep pre-populated practitioner, NO auto-change |

---

## UI Changes

### 1. CreateAppointmentModal Changes

#### New Props
```typescript
interface CreateAppointmentModalProps {
  // Existing props...
  preSelectedPatientId?: number;
  preSelectedAppointmentTypeId?: number;
  preSelectedPractitionerId?: number;
  preSelectedTime?: string | null;
  initialDate?: string | null;
  
  // NEW: Source indicator for slot-based pre-population
  prePopulatedFromSlot?: boolean;
}
```

#### Visual Indicators for Pre-populated Fields

When `prePopulatedFromSlot` is true, show subtle indicators:
- Practitioner field: "(從行事曆選擇)" badge
- Time field: "(從行事曆選擇)" badge

### 2. PractitionerSelectionModal Changes

Currently, the modal only shows practitioners that offer the selected appointment type. We need to change this to:

**New Behavior:**
- Show ALL practitioners always
- Add label/badge for practitioners that DON'T offer the selected appointment type: "⚠️ 不提供此服務類型"
- Keep existing labels: "負責治療師" (assigned), conflict indicators
- Allow selecting any practitioner (with warnings)

```typescript
interface PractitionerSelectionModalProps {
  // Existing props...
  
  // NEW: List of practitioner IDs that offer the selected appointment type
  appointmentTypePractitionerIds?: number[];
  
  // NEW: Currently selected appointment type name (for warning message)
  selectedAppointmentTypeName?: string;
}
```

### 3. ServiceItemSelectionModal (Appointment Type Selection) Changes

When practitioner is already selected (from slot click), the modal should:
- Show ALL appointment types always
- Add warning badge for types NOT offered by the selected practitioner: "⚠️ 所選治療師不提供"

```typescript
interface ServiceItemSelectionModalProps {
  // Existing props...
  
  // NEW: List of appointment type IDs offered by selected practitioner
  practitionerAppointmentTypeIds?: number[];
  
  // NEW: Currently selected practitioner name (for warning message)
  selectedPractitionerName?: string;
}
```

### 4. Warning Display in Form

Add a new warning section in the form footer (above submit button) that shows contextual warnings:

```tsx
// Warning types to display
interface FormWarning {
  type: 'practitioner_type_mismatch' | 'time_conflict' | 'outside_hours';
  message: string;
  severity: 'warning' | 'info';
}
```

**Warning Examples:**
- "⚠️ 所選治療師不提供此服務類型" (practitioner doesn't offer selected appointment type)
- "⚠️ 此時段與其他預約衝突" (time conflict with existing appointment)
- "ℹ️ 此時段在治療師的正常可用時間外" (outside normal hours)

### 5. CalendarGrid Changes

Update `onSlotClick` callback to include practitioner information:

```typescript
interface SlotInfo {
  start: Date;
  end: Date;
  practitionerId?: number;  // NEW: Which practitioner column was clicked
  resourceId?: number;      // For future: Which resource column was clicked
}

interface CalendarGridProps {
  onSlotClick?: (slotInfo: SlotInfo) => void;
}
```

---

## Conflict and Warning Handling

### Case 1: Time Conflict

**Scenario:** User clicks a slot, then selects an appointment type. The calculated end time overlaps with an existing appointment.

**Handling:**
1. Conflict check runs automatically when all required fields are filled
2. ConflictDisplay shows warning with details
3. ConflictWarningButton appears next to "下一步" button
4. User can proceed (confirm step shows warning again)

**No Change Needed:** Current conflict checking mechanism handles this well.

### Case 2: Practitioner Doesn't Offer Appointment Type

**Scenario:** User clicks a practitioner's slot (practitioner A), then selects an appointment type that practitioner A doesn't offer.

#### Backend Current State

The backend currently validates practitioner-appointment type compatibility in `appointment_service.py` lines 524-535:

```python
if requested_practitioner_id:
    practitioner = next(
        (p for p in practitioners if p.id == requested_practitioner_id),
        None
    )
    if not practitioner:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="找不到治療師或該治療師不提供此預約類型"
        )
```

#### Decision: Allow "Invalid" Combinations with Warning ✅

Following our **"Respect User Selection"** principle, we want to give users full control for one-off appointments without forcing them to change global clinic settings. 

**Approach:**
1. **Frontend:** Show prominent warning when practitioner-appointment type mismatch is detected
2. **Backend Change Required:** Remove the strict validation, allow appointment creation with any practitioner
3. User sees warning but CAN proceed to create the appointment
4. Useful for edge cases like one-off appointments, training, or temporary coverage

**Backend Change (Required):**
```python
# BEFORE: Strict validation - rejects if practitioner not in type's list
if requested_practitioner_id:
    practitioner = next(
        (p for p in practitioners if p.id == requested_practitioner_id),
        None
    )
    if not practitioner:
        raise HTTPException(...)

# AFTER: Allow any practitioner, just verify they exist and are active
if requested_practitioner_id:
    practitioner = db.query(User).filter(
        User.id == requested_practitioner_id,
        User.is_active == True
    ).first()
    if not practitioner:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="找不到治療師"
        )
    # Note: We allow scheduling with any practitioner
    # Frontend shows warning if practitioner doesn't normally offer this type
```

**Frontend Warning Display:**
```tsx
{selectedAppointmentTypeId && selectedPractitionerId &&
 !practitionerOffersTtype(selectedPractitionerId, selectedAppointmentTypeId) && (
  <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-md">
    <div className="flex items-start gap-2 text-amber-800">
      <span className="text-lg">⚠️</span>
      <div>
        <div className="font-medium text-sm">所選治療師通常不提供此服務類型</div>
        <div className="text-xs mt-1">若確定要建立此預約，請繼續。否則請更換治療師或服務類型。</div>
      </div>
    </div>
  </div>
)}
```

**Rationale:**
1. **User Control:** Clinics may need to schedule one-off appointments outside normal configurations
2. **No Forced Global Changes:** Users shouldn't need to modify clinic settings for edge cases
3. **Transparency:** Clear warning communicates the unusual nature of the selection
4. **Consistency:** Matches our handling of other conflicts (time conflicts, outside hours) - warn but allow

### Case 3: Patient Has Different Assigned Practitioner

**Scenario:** User clicks practitioner A's slot, pre-populating practitioner A. Then user selects a patient who has practitioner B as assigned practitioner.

**Current Behavior:** Auto-selects practitioner B, overriding the slot selection. ❌

**New Behavior:**
1. Keep practitioner A (slot selection)
2. Show subtle info message: "此病患的負責治療師為 [治療師 B]"
3. User can manually change practitioner if desired

**Implementation:** Remove or modify the `useEffect` that auto-selects assigned practitioner (lines 345-369 in CreateAppointmentModal.tsx). Only auto-select if no practitioner is pre-selected.

### Case 4: Weekly View Slot Click (Time Only, No Practitioner)

**Scenario:** User is in weekly view and clicks a slot. No practitioner column exists.

**Handling:**
1. Pre-populate only date and time
2. Practitioner field remains empty (user must select)
3. Normal creation flow continues

### Case 5: No Practitioners in Calendar View

**Scenario:** No practitioners are added to the calendar view, user clicks empty calendar slot.

**Handling:**
1. Pre-populate only date and time
2. Practitioner field remains empty
3. Normal creation flow continues

### Case 6: Resource Column Click (Future Consideration)

**Scenario:** User clicks under a resource column instead of practitioner column.

**Handling (Keep Simple for Now):**
1. Treat like a time-only click (Case 4)
2. Pre-populate date and time only
3. Future enhancement: Could auto-select the clicked resource

---

## Implementation Details

> **Important:** Phases are ordered by dependency. Phase 1 (Backend) MUST be deployed before frontend changes (Phases 2-5) to avoid users seeing warnings but getting 404 errors on submit.

### Phase 1: Backend Change (Deploy First)

**File:** `backend/src/services/appointment_service.py`

**Change:** Relax the strict practitioner-appointment type validation in `_assign_practitioner` method for **clinic-initiated appointments only**.

```python
# In _assign_practitioner method, change from:
if requested_practitioner_id:
    practitioner = next(
        (p for p in practitioners if p.id == requested_practitioner_id),
        None
    )
    if not practitioner:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="找不到治療師或該治療師不提供此預約類型"
        )

# To:
if requested_practitioner_id:
    # Verify practitioner exists and is active in clinic, but don't require
    # them to be in the appointment type's practitioner list.
    # This allows one-off appointments outside normal configurations.
    # Note: LIFF patient bookings should continue to filter by type (handled upstream)
    from models.user_clinic_association import UserClinicAssociation
    association = db.query(UserClinicAssociation).filter(
        UserClinicAssociation.user_id == requested_practitioner_id,
        UserClinicAssociation.clinic_id == clinic_id,
        UserClinicAssociation.is_active == True
    ).first()
    
    if not association:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="找不到治療師"
        )
    
    # Check availability (existing logic)
    if not AppointmentService._is_practitioner_available_at_slot(
        schedule_data, requested_practitioner_id, slot_start_time, slot_end_time, allow_override=allow_override
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="時段不可用"
        )
    
    return requested_practitioner_id
```

**Important Considerations:**
- This change only affects appointments with an explicitly requested practitioner from clinic users
- Auto-assignment logic (when practitioner_id is None) still filters by appointment type
- LIFF patient booking flow should continue to only show practitioners who offer the selected type (frontend filtering in LIFF remains unchanged)

### Phase 2: CalendarGrid and AvailabilityPage Changes

1. **Update SlotInfo interface** in CalendarGrid.tsx:
   ```typescript
   interface SlotInfo {
     start: Date;
     end: Date;
     practitionerId?: number;  // NEW: Which practitioner column was clicked
   }
   ```

2. **Update handleSlotClick** in CalendarGrid.tsx to pass practitionerId:
   ```typescript
   const handleSlotClick = (hour: number, minute: number, practitionerId?: number) => {
     if (onSlotClick) {
       const slotDate = createTimeSlotDate(currentDate, hour, minute);
       onSlotClick({
         start: slotDate,
         end: new Date(slotDate.getTime() + 15 * 60 * 1000),
         practitionerId,
       });
     }
   };
   ```

3. **Update slot div onClick** in practitioner columns to pass practitionerId:
   ```typescript
   onClick={() => handleSlotClick(slot.hour, slot.minute, practitionerId)}
   ```

4. **Update AvailabilityPage** to capture and pass slot info:
   ```typescript
   const [slotInfo, setSlotInfo] = useState<SlotInfo | null>(null);
   
   const handleSlotClick = useCallback((info: SlotInfo) => {
     setSlotInfo(info);
     setIsCreateAppointmentModalOpen(true);
   }, []);
   
   // When rendering CreateAppointmentModal:
   <CreateAppointmentModal
     initialDate={slotInfo?.start ? getDateString(slotInfo.start) : getDateString(currentDate)}
     preSelectedPractitionerId={slotInfo?.practitionerId}
     preSelectedTime={slotInfo?.start ? formatTimeString(slotInfo.start) : undefined}
     prePopulatedFromSlot={!!slotInfo?.practitionerId}
     // ... other props
   />
   ```

### Phase 3: useAppointmentForm Hook Changes

1. **Track if practitioner was pre-selected from slot**:
   ```typescript
   const [practitionerSource, setPractitionerSource] = useState<'slot' | 'auto' | 'user' | null>(null);
   ```

2. **Track practitioner-type compatibility for warning display**:
   ```typescript
   // Fetch all practitioners and their supported types for mismatch detection
   const [allPractitioners, setAllPractitioners] = useState<Practitioner[]>([]);
   const [practitionerTypeMap, setPractitionerTypeMap] = useState<Map<number, number[]>>(new Map());
   
   // Computed property for warning display
   const hasPractitionerTypeMismatch = useMemo(() => {
     if (!selectedPractitionerId || !selectedAppointmentTypeId) return false;
     const supportedTypes = practitionerTypeMap.get(selectedPractitionerId) || [];
     return !supportedTypes.includes(selectedAppointmentTypeId);
   }, [selectedPractitionerId, selectedAppointmentTypeId, practitionerTypeMap]);
   ```

3. **Keep practitioner selection when appointment type changes** (DON'T clear):
   - When appointment type changes, keep the practitioner selected
   - Only update the warning state
   - This respects user's slot/manual selection
   
   ```typescript
   // In the useEffect that handles appointment type change:
   useEffect(() => {
     if (isInitialMountRef.current || isInitialLoading) return;
     
     const fetchPractitioners = async () => {
       const filtered = await apiService.getPractitioners(selectedAppointmentTypeId);
       setAvailablePractitioners(filtered);
       
       // NEW: Do NOT clear practitioner if already selected
       // Just let hasPractitionerTypeMismatch compute the warning
       // User can still submit with mismatch - backend now allows it
     };
     
     fetchPractitioners();
   }, [selectedAppointmentTypeId, ...]);
   ```

4. **Add prop for slot-based pre-population**:
   ```typescript
   interface UseAppointmentFormProps {
     // ... existing props
     prePopulatedFromSlot?: boolean;
   }
   ```

5. **Expose mismatch state for warning display**:
   ```typescript
   return {
     // ... existing returns
     hasPractitionerTypeMismatch,  // NEW: for warning display in modal
   };
   ```

### Phase 4: CreateAppointmentModal Changes

1. **Modify auto-selection of assigned practitioner** (lines 345-369):
   - Only auto-select if NO practitioner is currently selected
   - If practitioner was set from slot click, do NOT override with assigned practitioner
   
   ```typescript
   useEffect(() => {
     // Only auto-select if:
     // 1. Patient is selected and loaded
     // 2. Appointment type is selected  
     // 3. Available practitioners are loaded
     // 4. NO practitioner is currently selected (don't override slot/user selection)
     // 5. NOT pre-populated from slot
     if (
       currentPatient &&
       selectedAppointmentTypeId &&
       availablePractitioners.length > 0 &&
       !selectedPractitionerId &&  // Only if empty
       !isLoadingPractitioners &&
       !prePopulatedFromSlot  // NEW: Don't auto-select if slot pre-populated
     ) {
       // ... existing auto-selection logic ...
     }
   }, [...]);
   ```

2. **Pass slot info to useAppointmentForm hook**:
   ```typescript
   const {
     // ... existing returns
   } = useAppointmentForm({
     mode: isDuplication ? 'duplicate' : 'create',
     // ... existing props
     prePopulatedFromSlot: !!preSelectedPractitionerId && prePopulatedFromSlot,
   });
   ```

3. **Add info message when patient has different assigned practitioner**:
   ```tsx
   {selectedPractitionerId && 
    prePopulatedFromSlot && 
    currentPatient && 
    getAssignedPractitionerIds(currentPatient).length > 0 &&
    !getAssignedPractitionerIds(currentPatient).includes(selectedPractitionerId) && (
     <div className="text-xs text-gray-500 mt-1">
       ℹ️ 此病患的負責治療師為：{assignedPractitionerNames.join(', ')}
     </div>
   )}
   ```

### Phase 5: Selection Modal Changes

Since we're allowing "invalid" combinations, the selection modals should show ALL items with appropriate labels:

1. **PractitionerSelectionModal**:
   - Show ALL practitioners (not just those offering the selected type)
   - Add badge for practitioners that don't offer the selected appointment type: "⚠️ 不提供此服務類型"
   - User can still select them (warning shown in form)
   
   ```typescript
   interface PractitionerSelectionModalProps {
     // Existing props...
     appointmentTypePractitionerIds?: number[];  // NEW: IDs that offer the type
   }
   ```

2. **ServiceItemSelectionModal**:
   - Show ALL appointment types (not just those offered by selected practitioner)
   - Add badge for types not offered by selected practitioner: "⚠️ 所選治療師不提供"
   - User can still select them (warning shown in form)
   
   ```typescript
   interface ServiceItemSelectionModalProps {
     // Existing props...
     practitionerAppointmentTypeIds?: number[];  // NEW: IDs offered by practitioner
   }
   ```

### Phase 6: Reset Slot Info After Modal Close

In AvailabilityPage.tsx, ensure slot info is cleared when modal closes to prevent stale state:

```typescript
const handleCloseCreateModal = useCallback(() => {
  setIsCreateAppointmentModalOpen(false);
  setSlotInfo(null);  // Clear slot info
}, []);

// Use this handler for both onClose and after successful creation
<CreateAppointmentModal
  onClose={handleCloseCreateModal}
  onConfirm={async (formData) => {
    // ... create appointment ...
    handleCloseCreateModal();
  }}
/>
```

---

## Testing Requirements

### E2E Tests (Playwright)

1. **Slot Click → Pre-population Test**
   - Click slot under practitioner A at 10:00
   - Verify practitioner A and 10:00 are pre-populated
   - Complete appointment creation
   - Verify appointment appears at correct time/practitioner

2. **Warning Display and Allow Invalid Combination Test**
   - Click slot under practitioner A
   - Select appointment type not offered by A
   - Verify warning appears: "所選治療師通常不提供此服務類型"
   - Verify "下一步" button is still enabled (not blocked)
   - Complete appointment creation
   - Verify appointment is created successfully

3. **Patient Selection Doesn't Override Slot Practitioner**
   - Click slot under practitioner A
   - Select patient assigned to practitioner B
   - Verify practitioner A is still selected
   - Verify info message about assigned practitioner appears

### Integration Tests (MSW)

1. **Conflict checking with slot pre-population**
2. **Form validation with mismatched practitioner-type**

---

## Migration Notes

1. **Backward Compatibility**: All existing flows (create from button, create from patient detail, duplication) work unchanged
2. **No Database Changes**: This feature requires no database schema changes
3. **Deployment Order**: Backend change (Phase 1) must be deployed BEFORE frontend changes (Phases 2-6)
4. **LIFF Unaffected**: Patient-facing LIFF booking flow continues to strictly filter practitioners by appointment type
5. **No Feature Flags**: Team decision - no feature flag infrastructure for this feature
6. **Rollback Strategy**: If issues arise, revert the commit(s) and redeploy. Standard git-based rollback.

---

## Additional Edge Cases

### Concurrent Bookings

**Scenario:** User A clicks slot 10:00 for practitioner X. Before submitting, User B books the same slot.

**Handling:**
- Conflict check runs before submission, will detect and show warning
- User can proceed (existing conflict handling) or pick a different time
- Standard race condition handling - last writer wins, conflicts shown

### Mobile Calendars

The daily view with practitioner columns works on mobile. Slot click behavior is consistent across screen sizes.

### Keyboard Navigation

Existing keyboard navigation in CalendarGrid focuses slots. Pressing Enter on a focused slot will trigger `handleSlotClick` with the same practitioner context.

### Recurring Appointments

Slot click pre-populates the FIRST occurrence's date/time. The recurring appointment flow continues as normal from there.

### Multi-Clinic Practitioners

A practitioner may offer type X in clinic A but not clinic B. The validation is clinic-scoped - this feature respects the current clinic context.

---

## Permissions

| User Type | Can Use Slot Pre-population | Can Override Practitioner-Type Mismatch |
|-----------|----------------------------|----------------------------------------|
| Clinic Admin | ✅ Yes | ✅ Yes (with warning) |
| Clinic Practitioner | ✅ Yes | ✅ Yes (with warning) |
| Other Clinic User | ✅ Yes | ✅ Yes (with warning) |
| Patient (LIFF) | ❌ N/A (no calendar access) | ❌ No (strict filtering maintained) |

---

## Open Questions

1. **Q: Should we remove the auto-selection of assigned practitioner entirely?**
   - Current: When patient is selected, auto-select their assigned practitioner
   - Proposed: Only highlight assigned practitioners, don't auto-select
   - **Recommendation:** Keep auto-selection ONLY when no practitioner is pre-selected:
     - If slot pre-selected practitioner → Do NOT auto-select assigned practitioner
     - If no practitioner selected → Auto-select assigned practitioner (current behavior)
   - **Rationale:** This respects slot selection while maintaining convenience for non-slot flows.

2. ~~**Q: Should backend validate practitioner-appointment type compatibility on creation?**~~
   - **ANSWERED:** No - we will remove the strict validation for clinic users.
   - **Approach:** Backend allows any practitioner for any appointment type (clinic users). Frontend shows warning but allows proceeding.
   - **Rationale:** Respects user control for one-off appointments without forcing global setting changes.
   - **Note:** LIFF patient booking continues to filter by type (unchanged).

3. ~~**Q: Do we need feature flags?**~~
   - **ANSWERED:** No - team decision.
   - **Rollback:** Standard git revert and redeploy if issues arise.

4. ~~**Q: Should this require admin permission?**~~
   - **ANSWERED:** No - any authenticated clinic user can use this feature.
   - **Rationale:** All clinic users are trusted internal users who may need flexibility for edge cases.

5. **Q: Should slot click from resource column pre-populate the resource?**
   - Current proposal: No (keep simple)
   - **Recommendation:** Future enhancement, not in initial scope

---

## Summary of Changes to Current Behavior

| Current Behavior | New Behavior | Rationale |
|------------------|--------------|-----------|
| Auto-select assigned practitioner when patient selected | Only auto-select if NO practitioner is pre-selected | Respects slot selection |
| Practitioner list filtered by appointment type | Show ALL practitioners, label incompatible ones with warning | Allows any selection with transparency |
| Clear practitioner when appointment type changes (if not in filtered list) | KEEP practitioner, show warning instead | Respects user selection, gives full control |
| Backend rejects practitioner-type mismatch with 404 | Backend ALLOWS any combination | Gives user full control for one-off appointments |
| No slot interaction with appointment creation | Slot click pre-populates practitioner, date, and time | New feature |
| Slot click only passes time | Slot click passes time AND practitioner (when clicked under practitioner column) | New feature |

---

## Dependencies

### Frontend
- **AvailabilityPage.tsx** - Slot click handling
- **CalendarGrid.tsx** - Slot click callback enhancement
- **CreateAppointmentModal.tsx** - Pre-population handling, warning display
- **useAppointmentForm.ts** - Field interaction logic, mismatch detection
- **PractitionerSelectionModal.tsx** - Show all practitioners with labels
- **ServiceItemSelectionModal.tsx** - Show all types with labels

### Backend
- **appointment_service.py** - Remove strict practitioner-type validation

---

## Success Metrics

1. **Usability:** Users can successfully create appointments from slot clicks
2. **No Regressions:** Existing appointment creation flows work unchanged
3. **Error Rate:** Minimal increase in "invalid" appointment creations (monitor backend logs)

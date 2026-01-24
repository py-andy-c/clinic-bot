# Slot-Integrated Appointment Creation - Implementation Plan

## Overview

This document outlines the technical changes needed to implement unconditional field rendering and flexible field selection order in the Create Appointment form.

**Key Principle:** All fields are always visible. User can select fields in any order. Show warnings for mismatches but never block or auto-clear selections.

---

## Requirements Summary

### DateTimePicker Behavior

| State | Display | On Click |
|-------|---------|----------|
| No selection (+ button) | Collapsed, shows "選擇日期時間" | Show warning, don't expand |
| Pre-selected from slot | Collapsed, shows "2026-01-23 10:00" | Show warning if missing deps, don't expand |
| Has practitioner + appointmentType | Collapsed, shows selected date/time | Expand normally |

### Field Dependencies (Warnings Only)

- **Practitioner ↔ AppointmentType:** Show warning badge if selected practitioner doesn't offer selected appointment type
- **DateTimePicker → Practitioner + AppointmentType:** Cannot expand picker until both are selected (need these to fetch available slots)

### What Changes

| Before | After |
|--------|-------|
| DateTimePicker hidden until practitioner + appointmentType selected | Always visible |
| Practitioner button disabled until appointmentType selected | Always enabled |
| Cascading deselection (clear practitioner when type cleared) | No auto-clearing |
| Practitioner list filtered by appointment type | All practitioners shown with warning badges |
| Appointment type list filtered by practitioner | All types shown with warning badges |

---

## Technical Changes

### 1. useAppointmentForm.ts

**Goal:** Simplify state initialization, remove cascading deselection.

#### 1.1 Direct State Initialization

```typescript
// BEFORE: Initialize to null, set in async useEffect
const [selectedPractitionerId, setSelectedPractitionerId] = useState<number | null>(null);
const [selectedAppointmentTypeId, setSelectedAppointmentTypeId] = useState<number | null>(null);
const [selectedDate, setSelectedDate] = useState<string | null>(null);
const [selectedTime, setSelectedTime] = useState<string>('');

// AFTER: Initialize directly from props
const [selectedPractitionerId, setSelectedPractitionerId] = useState<number | null>(
  preSelectedPractitionerId ?? event?.resource.practitioner_id ?? null
);
const [selectedAppointmentTypeId, setSelectedAppointmentTypeId] = useState<number | null>(
  preSelectedAppointmentTypeId ?? event?.resource.appointment_type_id ?? null
);
const [selectedDate, setSelectedDate] = useState<string | null>(
  initialDate ?? (event ? moment(event.start).tz('Asia/Taipei').format('YYYY-MM-DD') : null)
);
const [selectedTime, setSelectedTime] = useState<string>(
  preSelectedTime ?? (event ? moment(event.start).tz('Asia/Taipei').format('HH:mm') : '')
);
```

#### 1.2 Delete Cascading Deselection Logic

**Delete these useEffects entirely (lines ~324-347):**

```typescript
// DELETE: Auto-deselection when appointment type is cleared
useEffect(() => {
  if (isInitialMountRef.current || isInitialLoading) return;
  if (mode === 'edit') return;

  if (selectedAppointmentTypeId === null && (selectedPractitionerId !== null || selectedTime !== '')) {
    setSelectedPractitionerId(null);
    setSelectedDate(null);
    setSelectedTime('');
  }
}, [mode, selectedAppointmentTypeId, selectedPractitionerId, selectedTime, isInitialLoading]);

// DELETE: Auto-deselection when practitioner is cleared
useEffect(() => {
  if (isInitialMountRef.current || isInitialLoading) return;
  if (mode === 'edit') return;

  if (selectedPractitionerId === null && (selectedDate !== null || selectedTime !== '')) {
    setSelectedDate(null);
    setSelectedTime('');
  }
}, [mode, selectedPractitionerId, selectedDate, selectedTime, isInitialLoading]);
```

#### 1.3 Simplify init() Function

With direct state initialization, the async `init()` can be simplified to only handle:
- Fetching practitioners for the appointment type (if type is pre-selected)
- Fetching resources (for edit/duplicate mode)
- Fetching availability (for edit mode)

State setting inside `init()` should be reduced or removed since props are now used directly.

---

### 2. CreateAppointmentModal.tsx

**Goal:** Remove conditional rendering, always show DateTimePicker.

#### 2.1 Always Render DateTimePicker

```tsx
// BEFORE (line ~1004):
{selectedAppointmentTypeId && selectedPractitionerId && (
  <DateTimePicker
    selectedDate={selectedDate}
    selectedTime={selectedTime}
    selectedPractitionerId={selectedPractitionerId}
    appointmentTypeId={selectedAppointmentTypeId}
    ...
  />
)}

// AFTER:
<DateTimePicker
  selectedDate={selectedDate}
  selectedTime={selectedTime}
  selectedPractitionerId={selectedPractitionerId}   // May be null
  appointmentTypeId={selectedAppointmentTypeId}     // May be null
  canExpand={!!selectedPractitionerId && !!selectedAppointmentTypeId}  // NEW PROP
  onDateSelect={handleDateSelect}
  onTimeSelect={setSelectedTime}
  error={error}
  allowOverride={true}
  prePopulatedFromSlot={prePopulatedFromSlot}
/>
```

#### 2.2 Remove Practitioner Button Disable Dependency

```tsx
// BEFORE (line ~954):
disabled={!selectedAppointmentTypeId || isLoadingPractitioners}

// AFTER:
disabled={isLoadingPractitioners}
```

---

### 3. DateTimePicker.tsx

**Goal:** Add locked expansion behavior, show warning when trying to expand without required fields.

#### 3.1 Add New Props

```typescript
interface DateTimePickerProps {
  // ... existing props
  selectedPractitionerId?: number | null;  // Optional, may be null
  appointmentTypeId?: number | null;       // Optional, may be null
  canExpand?: boolean;                      // NEW: false = locked, show warning on click
}
```

#### 3.2 Add Locked Warning State

```typescript
const [showLockedWarning, setShowLockedWarning] = useState(false);
```

#### 3.3 Modify Expansion Logic

```typescript
const handleHeaderClick = () => {
  if (canExpand === false) {
    setShowLockedWarning(true);
    // Auto-hide warning after 3 seconds
    setTimeout(() => setShowLockedWarning(false), 3000);
    return;  // Don't expand
  }
  setShowLockedWarning(false);
  setIsExpanded(!isExpanded);
};
```

#### 3.4 Add Warning UI

```tsx
// In the collapsed header section
<div 
  className="cursor-pointer p-3 border rounded-lg hover:bg-gray-50"
  onClick={handleHeaderClick}
>
  <div className="flex items-center justify-between">
    <span className="text-sm text-gray-700">
      {selectedDate && selectedTime 
        ? `${formatDisplayDate(selectedDate)} ${selectedTime}` 
        : '選擇日期時間'}
    </span>
    <ChevronIcon />
  </div>
  
  {showLockedWarning && (
    <div className="mt-2 text-sm text-amber-600 flex items-center gap-1">
      <span>⚠️</span>
      <span>請先選擇治療師與預約類型</span>
    </div>
  )}
</div>
```

#### 3.5 Handle Edge Cases

- If `canExpand` becomes true while warning is showing, auto-hide warning
- If already expanded and `canExpand` becomes false, collapse and show warning

---

### 4. PractitionerSelectionModal.tsx

**Goal:** Remove filtering, show all practitioners with warning badges.

#### 4.1 Remove Filtering Logic

```typescript
// BEFORE: Filter practitioners
const displayPractitioners = useMemo(() => {
  if (!selectedAppointmentTypeId) return practitioners;
  return practitioners.filter(p => 
    appointmentTypePractitionerIds?.includes(p.id)
  );
}, [practitioners, selectedAppointmentTypeId, appointmentTypePractitionerIds]);

// AFTER: Show all practitioners
const displayPractitioners = practitioners;
```

#### 4.2 Keep/Enhance Warning Badges

```tsx
// For each practitioner in the list
<div className="flex items-center justify-between">
  <span>{practitioner.full_name}</span>
  <div className="flex items-center gap-2">
    {/* Existing: assigned practitioner badge */}
    {assignedPractitionerIds?.has(practitioner.id) && (
      <span className="text-xs text-blue-600">負責治療師</span>
    )}
    
    {/* NEW: Type mismatch warning */}
    {selectedAppointmentTypeId && 
     !practitioner.offered_types?.includes(selectedAppointmentTypeId) && (
      <span className="text-xs text-amber-600 flex items-center gap-0.5">
        <span>⚠️</span>
        <span>不提供此服務類型</span>
      </span>
    )}
    
    {/* Existing: Conflict indicator */}
    {practitionerConflicts?.[practitioner.id]?.has_conflict && (
      <ConflictIndicator ... />
    )}
  </div>
</div>
```

---

### 5. ServiceItemSelectionModal.tsx

**Goal:** Remove filtering, show all appointment types with warning badges.

#### 5.1 Add New Props

```typescript
interface ServiceItemSelectionModalProps {
  // ... existing props
  selectedPractitionerId?: number | null;           // NEW
  practitionerOfferedTypeIds?: number[];            // NEW: types offered by selected practitioner
}
```

#### 5.2 Remove Filtering Logic

```typescript
// BEFORE: Filter by practitioner's offered types
const displayTypes = appointmentTypes.filter(t => 
  practitionerOfferedTypeIds?.includes(t.id)
);

// AFTER: Show all types
const displayTypes = appointmentTypes;
```

#### 5.3 Add Warning Badges

```tsx
// For each appointment type in the list
<div className="flex items-center justify-between">
  <span>{type.name}</span>
  
  {/* NEW: Practitioner mismatch warning */}
  {selectedPractitionerId && 
   practitionerOfferedTypeIds && 
   !practitionerOfferedTypeIds.includes(type.id) && (
    <span className="text-xs text-amber-600 flex items-center gap-0.5">
      <span>⚠️</span>
      <span>所選治療師不提供</span>
    </span>
  )}
</div>
```

---

## State Management Simplification Summary

### Before

```
useState(null) → async init() sets value → cascading useEffect clears value → race condition
```

### After

```
useState(prop ?? fallback) → value set immediately → no cascading → no race
```

### Deleted State Logic

1. **Cascading deselection useEffects** - 2 effects deleted
2. **Conditional rendering checks** - Always render, control via props
3. **Filtering logic** - Show all items, add warning badges

---

## Files Modified

1. `frontend/src/hooks/useAppointmentForm.ts` - Simplify state init, remove cascades
2. `frontend/src/components/calendar/CreateAppointmentModal.tsx` - Always render DateTimePicker
3. `frontend/src/components/calendar/DateTimePicker.tsx` - Add locked expansion behavior
4. `frontend/src/components/calendar/PractitionerSelectionModal.tsx` - Remove filtering, add warnings
5. `frontend/src/components/calendar/ServiceItemSelectionModal.tsx` - Remove filtering, add warnings

---

## Testing Considerations

### Manual Testing Scenarios

1. **+ 預約 button:** Form opens with all fields empty, DateTimePicker visible but locked
2. **Slot click:** Form opens with practitioner + time pre-populated, DateTimePicker shows values but locked until type selected
3. **Select fields in any order:** All combinations should work
4. **Mismatch warnings:** Select practitioner A, then type not offered by A → warning shown, both remain selected
5. **Expand DateTimePicker:** Only works after selecting both practitioner and type

### Existing Tests to Update

- `CreateAppointmentModal.test.tsx` - Remove expectations about conditional rendering
- `useAppointmentForm.test.ts` (if exists) - Remove cascade behavior tests

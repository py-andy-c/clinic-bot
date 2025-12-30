# Allow Patient Practitioner Selection Setting

## Overview

This feature adds a new appointment type setting that controls whether patients can specify a practitioner when booking appointments via LIFF. When disabled, appointments are automatically assigned and patients cannot select or change practitioners.

## Feature Description

### New Setting: `allow_patient_practitioner_selection`

- **Location**: Per appointment type (similar to `allow_patient_booking`)
- **Default Value**: `True` (backward compatible)
- **Label**: "開放病患指定治療師"
- **Purpose**: When set to `False`, patients cannot specify practitioners during booking or rescheduling

## Expected Behavior

### Appointment Creation Flow (LIFF)

1. **When `allow_patient_practitioner_selection = True` (default)**:
   - Patient selects appointment type (Step 1)
   - Patient selects practitioner (Step 2) - **shown**
   - Patient selects date/time (Step 3)
   - Patient selects patient (Step 4)
   - Patient adds notes (Step 5)
   - Confirmation (Step 6)

2. **When `allow_patient_practitioner_selection = False`**:
   - Patient selects appointment type (Step 1)
   - ~~Patient selects practitioner (Step 2)~~ - **skipped**
   - Patient selects date/time (Step 3) - **auto-advances from Step 1**
   - Patient selects patient (Step 4)
   - Patient adds notes (Step 5)
   - Confirmation (Step 6)
   - Appointment is created with `practitioner_id = null` and `is_auto_assigned = True`

### Reschedule Flow (LIFF)

1. **When `allow_patient_practitioner_selection = True` (default)**:
   - Practitioner dropdown is **visible**
   - Patient can select a different practitioner, keep current, or choose "不指定"

2. **When `allow_patient_practitioner_selection = False`**:
   - Practitioner dropdown is **hidden**
   - Patient can only change date/time and notes
   - If appointment was originally manually assigned (patient selected practitioner), patient can keep the current practitioner
   - If patient tries to change practitioner via API, backend rejects the request

### Admin Settings UI

- New checkbox in `ServiceItemsSettings.tsx`:
  - Label: "開放病患指定治療師"
  - Position: Below "開放病患自行預約" checkbox
  - Default: Checked (True)
  - Only editable by clinic admins

## Implementation Details

### Backend Changes

#### 1. Database Model

**File**: `backend/src/models/appointment_type.py`

Add new field:
```python
allow_patient_practitioner_selection: Mapped[bool] = mapped_column(default=True)
"""Whether patients can specify a practitioner when booking. Default: true."""
```

#### 2. Database Migration

Create Alembic migration to:
- Add `allow_patient_practitioner_selection` column to `appointment_types` table
- Set default value to `True` for existing records
- Make column non-nullable

#### 3. API Response Models

**File**: `backend/src/api/responses.py`

Update `AppointmentTypeResponse`:
```python
allow_patient_practitioner_selection: bool = True
```

#### 4. LIFF Endpoints

**File**: `backend/src/api/liff.py`

**`list_appointment_types` endpoint**:
- Include `allow_patient_practitioner_selection` in response

**`get_appointment_details` endpoint**:
- Include appointment type information with `allow_patient_practitioner_selection` field
- This allows frontend to check the setting during reschedule

**`create_appointment` endpoint**:
- Validate: If `allow_patient_practitioner_selection = False` and `practitioner_id` is provided, reject with error:
  ```python
  HTTPException(
      status_code=status.HTTP_400_BAD_REQUEST,
      detail="此服務類型不允許指定治療師"
  )
  ```
- If setting is False, force `practitioner_id = None` (auto-assignment)

**`reschedule_appointment` endpoint**:
- Load appointment type to check `allow_patient_practitioner_selection`
- Validate: If setting is False and patient tries to change practitioner (different from current), reject:
  ```python
  HTTPException(
      status_code=status.HTTP_400_BAD_REQUEST,
      detail="此服務類型不允許變更治療師"
  )
  ```
- Allow keeping current practitioner even if setting is False (for backward compatibility with existing appointments)

#### 5. Service Layer

**File**: `backend/src/services/appointment_service.py`

The existing `_assign_practitioner` logic already handles `practitioner_id = None` for auto-assignment, so no changes needed. The validation in the API layer ensures `practitioner_id` is set to `None` when the setting is False.

### Frontend Changes

#### 1. Type Definitions

**File**: `frontend/src/types/index.ts`

Update `AppointmentType` interface:
```typescript
export interface AppointmentType {
  // ... existing fields
  allow_patient_practitioner_selection?: boolean | undefined;
}
```

#### 2. Appointment Creation Flow

**File**: `frontend/src/liff/appointment/Step1SelectType.tsx`

Modify `handleTypeSelect`:
```typescript
const handleTypeSelect = (type: AppointmentType) => {
  setAppointmentType(type.id, type);
  
  // Skip practitioner selection if not allowed
  if (type.allow_patient_practitioner_selection === false) {
    // Auto-assign: set practitioner to null and mark as auto-assigned
    setPractitioner(null, undefined, true); // This will advance to step 3
  }
};
```

**File**: `frontend/src/liff/appointment/AppointmentFlow.tsx`

Update step rendering logic:
```typescript
const renderCurrentStep = () => {
  const appointmentType = useAppointmentStore.getState().appointmentType;
  const skipPractitionerStep = appointmentType?.allow_patient_practitioner_selection === false;
  
  switch (step) {
    case 1:
      return <Step1SelectType />;
    case 2:
      // Skip step 2 if practitioner selection not allowed
      if (skipPractitionerStep) {
        return <Step3SelectDateTime />;
      }
      return <Step2SelectPractitioner />;
    case 3:
      return <Step3SelectDateTime />;
    // ... rest of steps
  }
};
```

**File**: `frontend/src/stores/appointmentStore.ts`

Update `setAppointmentType` to handle skipping step 2:
```typescript
setAppointmentType: (id, type) => {
  const skipPractitionerStep = type.allow_patient_practitioner_selection === false;
  
  set({
    appointmentTypeId: id,
    appointmentType: type,
    step: skipPractitionerStep ? 3 : 2, // Skip to step 3 if practitioner selection disabled
    practitionerId: skipPractitionerStep ? null : null, // Always reset
    practitioner: null,
    isAutoAssigned: skipPractitionerStep ? true : false, // Auto-assign if skipped
    date: null,
    startTime: null,
  });
}
```

#### 3. Reschedule Flow

**File**: `frontend/src/liff/appointment/RescheduleFlow.tsx`

1. Load appointment type when loading appointment details:
```typescript
// Add to appointment details state
const [appointmentType, setAppointmentType] = useState<AppointmentType | null>(null);

// In loadAppointmentDetails, also fetch appointment type
const appointmentType = await liffApiService.getAppointmentType(appointmentDetails.appointment_type_id);
setAppointmentType(appointmentType);
```

2. Conditionally render practitioner dropdown:
```typescript
{appointmentType?.allow_patient_practitioner_selection !== false && (
  <div>
    <label>治療師</label>
    <select
      value={selectedPractitionerId !== null ? selectedPractitionerId : ''}
      onChange={...}
    >
      {/* practitioner options */}
    </select>
  </div>
)}
```

**Note**: Need to add `getAppointmentType` endpoint or include type info in `getAppointmentDetails` response.

#### 4. Settings UI

**File**: `frontend/src/components/ServiceItemsSettings.tsx`

Add new checkbox after "開放病患自行預約":
```typescript
{/* Allow Patient Practitioner Selection */}
<div>
  <label className="flex items-center">
    <input
      type="checkbox"
      checked={type.allow_patient_practitioner_selection !== false}
      onChange={(e) => onUpdateType(index, 'allow_patient_practitioner_selection', e.target.checked)}
      className="mr-2"
      disabled={!isClinicAdmin}
    />
    <span className="text-sm font-medium text-gray-700">開放病患指定治療師</span>
    <InfoButton onClick={() => setShowAllowPractitionerSelectionModal(true)} />
  </label>
</div>
```

Add info modal explaining the setting.

#### 5. API Service Updates

**File**: `frontend/src/services/liffApi.ts`

Update `getAppointmentDetails` return type to include appointment type:
```typescript
async getAppointmentDetails(appointmentId: number): Promise<{
  // ... existing fields
  appointment_type?: AppointmentType;
}> {
  // Response should include appointment_type with allow_patient_practitioner_selection
}
```

Or add separate endpoint:
```typescript
async getAppointmentType(appointmentTypeId: number): Promise<AppointmentType> {
  const response = await this.client.get(`/liff/appointment-types/${appointmentTypeId}`);
  return response.data;
}
```

## Edge Cases

### 1. Reschedule with Setting Change

**Scenario**: Appointment was created when setting was `True` (patient selected practitioner), but setting is now `False`.

**Behavior**: 
- Patient can keep current practitioner (no change)
- Patient cannot select a different practitioner
- Practitioner dropdown is hidden in UI
- Backend validates: if `practitioner_id` changes, reject

### 2. API Direct Access

**Scenario**: Patient somehow sends `practitioner_id` when setting is `False`.

**Behavior**: 
- Backend validation rejects with clear error message
- Defense in depth: even though UI prevents this, backend enforces the rule

### 3. Progress Indicator

**Scenario**: Step 2 is skipped but progress bar shows all steps.

**Behavior**: 
- No visual change to progress indicator (as per requirements)
- Steps are numbered 1, 2, 3, 4, 5, 6 but step 2 is skipped in flow
- Progress bar still shows 6 steps total

### 4. Default Value for Existing Records

**Scenario**: Existing appointment types don't have the new field.

**Behavior**: 
- Migration sets default to `True` for all existing records
- Frontend treats `undefined` as `True` (backward compatible)
- Code uses `!== false` pattern to handle undefined gracefully

## Testing Considerations

### Backend Tests

1. **Create appointment with setting = False**:
   - Verify `practitioner_id` is forced to `None`
   - Verify `is_auto_assigned = True`
   - Verify rejection if `practitioner_id` is provided

2. **Reschedule with setting = False**:
   - Verify can keep current practitioner
   - Verify rejection if trying to change practitioner
   - Verify can change date/time

3. **API validation**:
   - Test direct API calls bypassing frontend
   - Verify proper error messages

### Frontend Tests

1. **Appointment creation flow**:
   - Verify step 2 is skipped when setting is False
   - Verify auto-advance to step 3
   - Verify `isAutoAssigned` is set correctly

2. **Reschedule flow**:
   - Verify practitioner dropdown is hidden
   - Verify can still reschedule date/time

3. **Settings UI**:
   - Verify checkbox appears and works
   - Verify default value is True
   - Verify admin-only editing

## Migration Strategy

1. Create Alembic migration to add column with default `True`
2. Deploy backend changes first
3. Deploy frontend changes
4. No data migration needed (all existing records get `True` by default)

## Backward Compatibility

- Existing appointment types: Default to `True` (no behavior change)
- Existing appointments: No impact
- API: New field is optional in responses, defaults to `True` if missing
- Frontend: Uses `!== false` pattern to handle undefined gracefully

## Related Features

- **`allow_patient_booking`**: Controls whether patients can book the service type at all
- **`allow_patient_practitioner_selection`**: Controls whether patients can specify practitioner (requires `allow_patient_booking = True`)

These are independent settings, but logically:
- If `allow_patient_booking = False`, practitioner selection is irrelevant (service not bookable)
- If `allow_patient_booking = True` and `allow_patient_practitioner_selection = False`, service is bookable but practitioner is auto-assigned


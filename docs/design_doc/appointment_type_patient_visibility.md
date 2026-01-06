# Appointment Type Patient Visibility - Business Logic & Technical Design

## Overview

This document defines the replacement of the single `allow_patient_booking` field with two separate visibility controls: `新病患可自行預約` (new patients can self-book) and `舊病患可自行預約` (existing patients can self-book). This change allows clinics to have different appointment types available for new vs returning patients.

---
## Key Business Logic

### 1. Patient Classification

**新病患 (New Patients)**: Patients who have no assigned practitioners in the clinic system.

**舊病患 (Existing Patients)**: Patients who have at least one assigned practitioner in the clinic system.

### 2. Appointment Type Visibility Rules

#### Current Single Field
- `allow_patient_booking`: Controls whether patients can book this service via LIFF (default: true)

#### New Dual Fields
- `allow_new_patient_booking`: Whether new patients can book this service via LIFF (**default: true**)
- `allow_existing_patient_booking`: Whether existing patients can book this service via LIFF (**default: true**)

**Default Behavior**: Both fields default to `true` for new appointment types, maintaining the permissive booking policy where all services are available to all patients by default. Clinics can then selectively restrict visibility for specific services.

#### Visibility Logic
Appointment types are shown to patients based on the following rules:

| Patient Status | Patient Selected? | Has Assigned Practitioners? | Show Appointment Types |
|----------------|------------------|----------------------------|----------------------|
| New LINE User | No | N/A | `allow_new_patient_booking = true` |
| Existing LINE User (new patient) | Yes | No | `allow_new_patient_booking = true` |
| Existing LINE User (existing patient) | Yes | Yes | `allow_existing_patient_booking = true` |

**Rationale**: Clinics may want different services available for new patients vs returning patients with established practitioner relationships.

#### LIFF-Only Field Warnings
When both `allow_new_patient_booking = false` AND `allow_existing_patient_booking = false`, the following fields show warning icons (⚠️) because they only affect LIFF booking:
- 說明 (description)
- 開放病患指定治療師 (allow_patient_practitioner_selection)
- 要求填寫備註 (require_notes)
- 備註填寫指引 (notes_instructions)
- 預約確認訊息（病患自行預約） (patient_confirmation_message)

**Warning Condition**: `!allow_new_patient_booking && !allow_existing_patient_booking`

**Implementation**: Update existing `WarningPopover` conditions from `!allow_patient_booking` to the new dual condition.

#### Notifications Feature Update
The notifications feature currently filters appointment types using `allow_patient_booking`. Update to use new dual-field logic:

**New Filter Logic**: Show appointment types where `allow_new_patient_booking = true OR allow_existing_patient_booking = true`

**Migration Handling**: During transition period, fall back to old `allow_patient_booking` field if new fields are unavailable.

### 3. LIFF Flow Integration

#### Flow 1: New LINE Users (No Existing Patients)
1. Patient selects appointment type (no patient context yet)
2. Shows appointment types where `allow_new_patient_booking = true`
3. Patient created after appointment type selection

#### Flow 2: Existing LINE Users (Has Patients)
1. Patient selects existing patient first
2. Patient classification determined by checking if selected patient has assigned practitioners
3. Shows appointment types based on patient classification:
   - If patient has no assigned practitioners: `allow_new_patient_booking = true`
   - If patient has assigned practitioners: `allow_existing_patient_booking = true`

### 4. Backward Compatibility

**Migration Strategy**:
- Existing `allow_patient_booking = true` → Both new fields set to `true`
- Existing `allow_patient_booking = false` → Both new fields set to `false`

**Rationale**: Maintains existing behavior where clinic users can still book "hidden" appointments, while allowing patients to see appropriate services based on their status.

---

## Backend Technical Design

### Database Schema Changes

#### AppointmentType Table
```sql
-- Add new columns
ALTER TABLE appointment_types
ADD COLUMN allow_new_patient_booking BOOLEAN DEFAULT TRUE,
ADD COLUMN allow_existing_patient_booking BOOLEAN DEFAULT TRUE;

-- Migrate existing data
UPDATE appointment_types
SET allow_new_patient_booking = allow_patient_booking,
    allow_existing_patient_booking = allow_patient_booking
WHERE allow_patient_booking IS NOT NULL;

-- Drop old column (after migration)
ALTER TABLE appointment_types DROP COLUMN allow_patient_booking;
```

#### Model Updates
```python
class AppointmentType(Base):
    # ... existing fields ...
    allow_new_patient_booking: Mapped[bool] = mapped_column(default=True)
    allow_existing_patient_booking: Mapped[bool] = mapped_column(default=True)
```

#### Database Indexing
Add composite index on `patient_practitioner_assignments` table for optimal patient classification query performance:
```sql
CREATE INDEX idx_patient_practitioner_assignments_classification
ON patient_practitioner_assignments (patient_id, clinic_id, is_active);
```

### API Endpoints

#### `GET /liff/appointment-types`
- **Description**: List appointment types available for booking via LIFF
- **New Parameters**:
  - `patient_id` (optional): Patient ID to determine visibility rules
- **Response**: Filtered appointment types based on patient status
- **Logic**:
  - If no `patient_id`: Show `allow_new_patient_booking = true`
  - If `patient_id` provided: Check patient practitioner assignments
    - If patient has assigned practitioners: Show `allow_existing_patient_booking = true`
    - If patient has no assigned practitioners: Show `allow_new_patient_booking = true`

#### API Response Model Updates
- **AppointmentTypeResponse**: Add `allow_new_patient_booking`, `allow_existing_patient_booking` fields
- **Remove**: `allow_patient_booking` field after migration complete

#### Clinic Settings API Updates
- **Appointment Type CRUD operations**: Handle new `allow_new_patient_booking`, `allow_existing_patient_booking` fields
- **Bulk update operations**: Update both new fields when processing appointment type changes

#### `GET /clinic/appointment-types`
- **Description**: List all appointment types for clinic admin (unchanged filtering)

#### `POST /clinic/appointment-types` / `PUT /clinic/appointment-types/{id}`
- **Request Body**: Include `allow_new_patient_booking`, `allow_existing_patient_booking`
- **Validation**: Both fields can be `false` independently (clinic users can still book these appointments manually)

### Business Logic Implementation

#### Patient Classification Service
```python
class PatientService:
    @staticmethod
    def has_assigned_practitioners(db: Session, patient_id: int, clinic_id: int) -> bool:
        """Check if patient has any assigned practitioners at the clinic."""
        # Query patient_practitioner_assignments table
        return db.query(PatientPractitionerAssignment).filter(
            PatientPractitionerAssignment.patient_id == patient_id,
            PatientPractitionerAssignment.clinic_id == clinic_id,
            PatientPractitionerAssignment.is_active == True
        ).count() > 0
```

#### Appointment Type Filtering Service
```python
class AppointmentTypeService:
    @staticmethod
    def list_appointment_types_for_patient_booking(
        db: Session,
        clinic_id: int,
        patient_id: Optional[int] = None
    ) -> List[AppointmentType]:
        """List appointment types available for patient booking based on patient status."""

        # Get base query (active types with practitioners)
        base_query = get_active_appointment_types_for_clinic_with_active_practitioners(db, clinic_id)

        if patient_id is None:
            # No patient selected - show new patient types
            return base_query.filter(AppointmentType.allow_new_patient_booking == True).all()

        # Patient selected - check patient status
        has_practitioners = PatientService.has_assigned_practitioners(db, patient_id, clinic_id)

        if has_practitioners:
            # Existing patient - show existing patient types
            return base_query.filter(AppointmentType.allow_existing_patient_booking == True).all()
        else:
            # New patient (no practitioners) - show new patient types
            return base_query.filter(AppointmentType.allow_new_patient_booking == True).all()
```

---

## Frontend Technical Design

### State Management Strategy

#### Server State (API Data)
- [x] **Data Source**: Updated `/liff/appointment-types` endpoint with patient context
- [x] **React Query Hooks**:
  - `useAppointmentTypesQuery(patientId?: number)` - List appointment types for booking
    - Query key: `['appointment-types', clinicId, patientId]`
    - Cache: 5 minutes staleTime, refetch on patient change
- [x] **Cache Strategy**:
  - Cache by `clinicId` and `patientId` to avoid unnecessary refetches
  - Invalidate when patient selection changes

#### Client State (UI State)
- [x] **Appointment Store**: Track patient selection for filtering
  - `patientId`, `patient` - Current selected patient
  - `flowType` - 'flow1' | 'flow2' for different user journeys

#### Form State
- [x] **Appointment Type Settings**: Two separate checkboxes
  - `allow_new_patient_booking`: "新病患可自行預約"
  - `allow_existing_patient_booking`: "舊病患可自行預約"
- [x] **Warning System**: Update existing `WarningPopover` conditions
  - Change from `!allow_patient_booking` to `!allow_new_patient_booking && !allow_existing_patient_booking`
  - Warnings show immediately based on form state, not just database state

### Component Updates
- **Step1SelectType**: Update to use `useAppointmentTypesQuery(null)` for new patient types
- **Step2SelectType**: Create for Flow 2 with `useAppointmentTypesQuery(patientId)` based on patient status
- **AppointmentTypeField**: Replace single checkbox with two checkboxes for new/existing patient booking

### User Interaction Flows

#### Flow 1: New LINE Users (No Existing Patients)
1. User starts appointment booking
2. System detects no existing patients → Flow 1
3. Step 1: Appointment Type Selection
   - API call: `GET /liff/appointment-types` (no patient_id)
   - Shows: `allow_new_patient_booking = true` types
4. User selects appointment type
5. Continues to practitioner selection...

#### Flow 2: Existing LINE Users
1. User starts appointment booking
2. System detects existing patients → Flow 2
3. Step 1: Patient Selection
   - User selects existing patient
4. Step 2: Appointment Type Selection
   - API call: `GET /liff/appointment-types?patient_id={selected_patient_id}`
   - Backend determines patient status and filters accordingly
   - Shows: Based on whether patient has assigned practitioners
5. User selects appointment type
6. Continues to practitioner selection...

### Edge Cases and Error Handling

#### Key Edge Cases
- **Patient Selection Changes**: Refetch appointment types when patient changes in Flow 2
- **Clinic Switching**: Cache invalidation and refetch with new clinic context
- **No Appointment Types Available**: Show appropriate empty state message
- **Mixed Active/Inactive Assignments**: Explicitly count as "existing patient" if they have ANY active assignments within the clinic. Inactive assignments are ignored for classification purposes.

#### Error Scenarios
- **API Failure**: Show "無法載入服務項目，請重新整理" with retry option
- **Patient Data Load Failure**: Default to showing new patient types

### Testing Requirements

- **E2E Tests**: Verify correct appointment types shown for new vs existing patients
- **Integration Tests**: Test API filtering by patient status
- **Unit Tests**: Test patient classification logic and warning conditions

---

## Integration Points

### Backend Integration
- [x] **Database Migration**: Add new columns, migrate data, drop old column
- [x] **API Updates**: Modify appointment types endpoint to accept patient_id parameter
- [x] **Business Logic**: New patient classification and filtering logic

### Frontend Integration
- [x] **API Service Updates**: Update `liffApiService.getAppointmentTypes()` to accept patient_id
- [x] **Component Updates**: Modify appointment type selection components to use patient context
- [x] **Store Updates**: Ensure patient selection state triggers appointment type refetch

---

## Security Considerations

- [x] **Data Isolation**: Patient appointment type visibility respects clinic boundaries
- [x] **Patient Privacy**: Patient practitioner assignment data only used for visibility logic
- [x] **Input Validation**: Boolean fields validated, at least one booking option required
- [x] **API Authorization**: LIFF endpoints require valid LINE user context

---

## Migration Plan

### Phase 1: Database Migration
- [x] Add new columns `allow_new_patient_booking`, `allow_existing_patient_booking`
- [x] Run data migration script to copy `allow_patient_booking` values
- [x] Update backend models and schemas

### Phase 2: Backend API Updates
- [x] Update appointment types endpoint to accept `patient_id` parameter
- [x] Implement patient classification logic
- [x] Update filtering logic in `AppointmentTypeService`

### Phase 3: Frontend Updates
- [x] Update API service to pass patient context
- [x] Modify appointment type selection components
- [x] Update admin settings forms with dual checkboxes

### Phase 4: Testing & Validation
- [x] Update tests to cover new filtering logic
- [x] Test both Flow 1 and Flow 2 scenarios
- [x] Validate backward compatibility

### Phase 5: Cleanup
- [x] Drop old `allow_patient_booking` column
- [x] Remove old frontend code
- [x] Update documentation

---

## Success Metrics

- [x] **User Experience**: Patients see appropriate appointment types based on their status
- [x] **Clinic Control**: Clinics can configure different services for new vs existing patients
- [x] **Backward Compatibility**: Existing configurations continue to work
- [x] **Performance**: No significant impact on appointment type loading

---

## Open Questions / Future Enhancements

- [x] **Patient Status Caching**: Should patient practitioner assignments be cached?
- [x] **Dynamic Updates**: Should appointment types update immediately when patient assignments change?
- [x] **Admin Visibility**: Should admins see both fields clearly labeled?

---

## References

- [Appointment Design Doc](./appointments.md)
- [Current LIFF Flow Implementation](../frontend/src/liff/appointment/)
- [Appointment Type Settings](../frontend/src/components/AppointmentTypeField.tsx)

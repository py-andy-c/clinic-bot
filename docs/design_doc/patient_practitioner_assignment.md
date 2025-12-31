# Patient-Practitioner Assignment - Business Logic & Technical Design

## Overview

This feature allows clinics to assign one or more practitioners as the main responsible person(s) for a patient. This assignment affects appointment booking flows and patient management.

---

## Key Business Logic

### 1. Patient-Practitioner Assignment

**Purpose**: Assign specific practitioners as responsible for patient care and appointment management.

**Structure**:
- Each patient can have multiple assigned practitioners
- Practitioners can be assigned to multiple patients
- Assignment is clinic-specific (same practitioner-patient pair can exist in different clinics)
- Assignment affects appointment booking restrictions when enabled

**Business Rules**:
- Assignment is optional (patients can exist without assigned practitioners)
- Assignment affects LIFF booking flow when `restrict_to_assigned_practitioners = True`
- Assignment prompts clinic users to assign practitioners during appointment creation/editing
- Assignment is informational for clinic users (helps with patient management)

### 2. Appointment Settings Integration

**New Setting**: `restrict_to_assigned_practitioners` (default: `False`)

**When `False` (default)**:
- Patients can book with any practitioner (current behavior)
- Assigned practitioners highlighted visually in LIFF (when patient known)

**When `True`**:
- Patients can only book with assigned practitioners
- Fallback to all practitioners if no assigned practitioners or none offer selected appointment type
- Applied only when patient is known (after patient selection in flow)

### 3. LIFF Appointment Flow Changes

**Conditional Patient Selection Timing**: Patient selection happens at different points based on whether LINE user has existing patients.

**Flow Detection**:
- Query existing patients on AppointmentFlow mount
- Determine flow based on `patients.length > 0`
- Handle errors/timeouts gracefully (default to Flow 1)

**Flow 1: New LINE Users (No Existing Patients)**:
1. Select Appointment Type
2. Select Practitioner (all shown, no filtering - patient unknown)
3. Select Date/Time
4. Select/Create Patient
5. Add Notes
6. Confirmation

**Flow 2: Existing LINE Users (Has Patients)**:
1. Select/Create Patient (moved to first step)
2. Select Appointment Type
3. Select Practitioner (filtered by assigned if setting enabled)
4. Select Date/Time
5. Add Notes
6. Confirmation

**Practitioner Filtering Rules**:
- Only applied when patient is known and setting is enabled
- Show only assigned practitioners
- Fallback to all practitioners if no assigned practitioners
- Fallback to all practitioners if selected appointment type not offered by assigned practitioners
- Always highlight assigned practitioners visually

### 4. Clinic-Side Assignment Prompts

**When Shown**:
- After appointment save/update if selected practitioner not assigned to patient
- Applies to: appointment creation, editing (practitioner changed), duplication, pending review reassignment

**Prompt Flow**:
1. Check if selected practitioner is assigned to patient
2. If not assigned → Show prompt: "此治療師並非此病患的負責人員。是否要將此治療師設為負責人員？"
3. If Yes → Add practitioner to patient's assigned practitioners
4. Show confirmation with all assigned practitioners

**Edge Cases**:
- Practitioner already assigned: Don't prompt
- Practitioner didn't change: Don't prompt
- Auto-assigned practitioner ("不指定"): Don't prompt
- Patient changed: Check new patient's assigned practitioners

---

## Backend Technical Design

### API Endpoints

#### `GET /clinic/patients/{patient_id}/assigned-practitioners`
- **Description**: Get practitioners assigned to patient
- **Path Parameters**: `patient_id`
- **Response**: `Practitioner[]` (assigned practitioners)
- **Errors**: 404 (patient not found), 500

#### `POST /clinic/patients/{patient_id}/assigned-practitioners`
- **Description**: Assign practitioner to patient
- **Path Parameters**: `patient_id`
- **Request Body**: `{ practitioner_id: number }`
- **Response**: `{ success: true, assigned_practitioners: Practitioner[] }`
- **Errors**:
  - 400: Practitioner already assigned
  - 404: Patient or practitioner not found
  - 500: Internal server error

#### `DELETE /clinic/patients/{patient_id}/assigned-practitioners/{practitioner_id}`
- **Description**: Remove practitioner assignment from patient
- **Path Parameters**: `patient_id`, `practitioner_id`
- **Response**: `{ success: true, assigned_practitioners: Practitioner[] }`
- **Errors**: 404, 500

#### `GET /clinic/practitioners/{practitioner_id}/assigned-patients`
- **Description**: Get patients assigned to practitioner
- **Path Parameters**: `practitioner_id`
- **Query Parameters**: `page`, `pageSize`, `search`
- **Response**: Paginated patient list
- **Errors**: 404, 500

### Database Schema

**PatientPractitionerAssignments Table**:
- `id`: Primary key
- `clinic_id`: Foreign key to clinics
- `patient_id`: Foreign key to patients
- `practitioner_id`: Foreign key to users (practitioners only)
- `assigned_by_user_id`: Foreign key to users (who assigned)
- `created_at`: DateTime
- `updated_at`: DateTime

**Constraints**:
- Unique composite key: `(clinic_id, patient_id, practitioner_id)` (prevent duplicate assignments)
- Foreign key constraints ensure referential integrity
- Index on `(clinic_id, patient_id)` for efficient queries
- Index on `(clinic_id, practitioner_id)` for efficient queries

### Business Logic Implementation

**PatientPractitionerService** (`backend/src/services/patient_practitioner_service.py`):
- `assign_practitioner()`: Assign practitioner with validation
- `remove_assignment()`: Remove assignment
- `get_assigned_practitioners()`: Get practitioners for patient
- `get_assigned_patients()`: Get patients for practitioner
- `is_practitioner_assigned()`: Check assignment status

**AppointmentService Integration**:
- Assignment prompts integrated into appointment save/update flows
- Practitioner filtering logic for LIFF booking
- Assignment checks during appointment operations

**Key Business Logic**:
- Assignment validation prevents duplicates
- Clinic isolation enforced on all operations
- Permission checks for assignment operations
- Integration with existing appointment workflows

---

## Frontend Technical Design

### State Management Strategy

#### Server State (API Data)
- [x] **Data Source**: Assignment APIs, patient data with assignments
- [x] **Current Implementation**: Using `useApiData` hook
  - **Note**: Migration to React Query planned for Phase 2 (Weeks 3-5) per `ai_frontend_dev.md`
- [x] **Query Keys** (when migrated to React Query):
  - `['patient-assigned-practitioners', patientId]` - Patient's assigned practitioners
  - `['practitioner-assigned-patients', practitionerId, page, search]` - Practitioner's assigned patients
- [x] **Cache Strategy**:
  - **Current**: Custom cache with TTL (5 minutes default)
  - **Future (React Query)**:
    - `staleTime`: 5 minutes (assignments don't change frequently)
    - `cacheTime`: 10 minutes

#### Client State (UI State)
- [x] **PatientDetailPage**: Assignment management state
  - Edit mode toggle, assignment form state
  - Assignment confirmation dialogs

- [x] **AppointmentFlow (LIFF)**: Practitioner filtering state
  - Flow detection (new vs existing user)
  - Patient selection state
  - Practitioner filtering based on assignments

- [x] **PractitionerAssignmentPromptModal**: Post-appointment assignment prompt
  - Assignment confirmation, multiple practitioner display

#### Form State
- [x] **Assignment Management**: Simple forms for adding/removing assignments
- [x] **Patient Selection**: Complex state management in appointment flow
- [x] **Practitioner Selection**: Filtered dropdowns based on assignments and settings

### Component Architecture

#### Component Hierarchy
```
PatientDetailPage
  ├── PatientInfoSection
  └── PatientAssignmentsSection
      ├── AssignedPractitionersList
      ├── AddPractitionerForm
      │   ├── PractitionerSelector
      │   └── AssignButton
      └── RemoveAssignmentButton[]

AppointmentFlow (LIFF)
  ├── PatientSelectionStep (Flow 2) / PatientCreationStep (Flow 1)
  ├── AppointmentTypeStep
  ├── PractitionerStep
  │   ├── PractitionerSelector (filtered)
  │   └── AssignedPractitionerIndicator
  ├── DateTimeStep
  ├── NotesStep
  └── ConfirmationStep

PractitionerAssignmentPromptModal
  ├── AssignmentPrompt
  ├── PractitionerInfo
  ├── YesNoButtons
  └── ConfirmationDisplay
```

#### Component List
- [x] **PatientAssignmentsSection** (`frontend/src/components/patient/PatientAssignmentsSection.tsx`)
  - **Props**: `patientId`, `canEdit`
  - **State**: Assignment list, add form visibility
  - **Dependencies**: `useApiData` (assignments), practitioner selector

- [x] **PractitionerAssignmentPromptModal** (`frontend/src/components/PractitionerAssignmentPromptModal.tsx`)
  - **Props**: `isOpen`, `practitioner`, `patient`, `onConfirm`, `onCancel`
  - **State**: Confirmation state, assignment status
  - **Dependencies**: Assignment API calls

- [x] **AppointmentFlow** (`frontend/src/liff/appointment/AppointmentFlow.tsx`)
  - **Props**: Clinic context, navigation
  - **State**: Current step, flow type, patient selection, practitioner filtering
  - **Dependencies**: `appointmentStore`, step components, assignment logic

- [x] **PractitionerSelector** (LIFF component)
  - **Props**: `appointmentTypeId`, `selectedPatient`, `restrictToAssigned`
  - **State**: Filtered practitioners list
  - **Dependencies**: Assignment data, clinic settings

### User Interaction Flows

#### Flow 1: Patient Assignment Management (Clinic)
1. Navigate to patient detail page
2. View assigned practitioners section
3. Click "編輯" to enter edit mode
4. View current assigned practitioners
5. Click "新增負責人員" to add practitioner
6. Select practitioner from dropdown (filtered to clinic practitioners)
7. Click "確認" to assign
8. Practitioner added to list
9. Click "移除" next to practitioner to remove assignment
10. Confirm removal in dialog
   - **Edge case**: Practitioner already assigned → Show error message
   - **Error case**: API failure → Show error, allow retry

#### Flow 2: LIFF Appointment Flow with Filtering (New User)
1. Open LIFF appointment booking
2. System detects no existing patients
3. Follow Flow 1: Appointment Type → Practitioner (all shown) → Date/Time → Patient Selection → Notes → Confirmation
4. In practitioner step: Show all practitioners, no highlighting (patient unknown)
5. Patient selects/creates patient
6. After appointment created, clinic can assign practitioners later

#### Flow 3: LIFF Appointment Flow with Filtering (Existing User)
1. Open LIFF appointment booking
2. System detects existing patients, shows Flow 2
3. Patient selects existing patient (or creates new)
4. Select appointment type
5. In practitioner step: 
   - If `restrict_to_assigned_practitioners = True`: Show only assigned practitioners (or all if none/fallback)
   - Highlight assigned practitioners visually
6. Continue to date/time, notes, confirmation
   - **Edge case**: No assigned practitioners → Show all practitioners
   - **Edge case**: Appointment type not offered by assigned → Show all practitioners

#### Flow 4: Assignment Prompt After Appointment (Clinic)
1. Clinic user creates/edits appointment
2. Selects practitioner not assigned to patient
3. Appointment saves successfully
4. `PractitionerAssignmentPromptModal` opens
5. Show prompt: "此治療師並非此病患的負責人員。是否要將此治療師設為負責人員？"
6. User clicks "是"
7. Practitioner assigned to patient
8. Show confirmation with all assigned practitioners
9. Modal closes
   - **Edge case**: User clicks "否" → Modal closes, no assignment
   - **Edge case**: Multiple practitioners → Show all in confirmation

#### Flow 5: Patient List Filtering by Practitioner
1. Navigate to patients page
2. Use practitioner filter dropdown
3. Select practitioner
4. Patient list filtered to show only assigned patients
5. Clear filter to show all patients
   - **Note**: Filtering is client-side for now, could be server-side if needed

### Edge Cases and Error Handling

#### Edge Cases
- [x] **Race Condition**: User switches clinic during assignment operations
  - **Solution**: `useApiData` includes clinic ID in cache keys, automatically refetches

- [x] **Concurrent Assignments**: Multiple users assign same practitioner simultaneously
  - **Solution**: Database unique constraint prevents duplicates, shows error to second user

- [x] **Component Unmount**: Assignment modal unmounts during API call
  - **Solution**: `useApiData` checks `isMountedRef`, prevents memory leaks

- [x] **Network Failure**: Assignment API fails
  - **Solution**: Error message shown, user can retry assignment

- [x] **Stale Data**: Assignment list outdated when viewing
  - **Solution**: Manual refresh available, or auto-refresh on page focus

- [x] **Patient Deleted**: Patient soft-deleted while managing assignments
  - **Solution**: Assignment operations fail gracefully, redirect if needed

- [x] **Practitioner Deactivated**: Assigned practitioner deactivated
  - **Solution**: Assignment remains but practitioner shown as inactive

- [x] **Settings Change**: `restrict_to_assigned_practitioners` changed mid-flow
  - **Solution**: Settings cached, changes take effect on next flow start

#### Error Scenarios
- [x] **API Errors (4xx, 5xx)**:
  - **User Message**: "指派失敗" or "取得負責人員失敗"
  - **Recovery Action**: User can retry operation
  - **Implementation**: `getErrorMessage()` utility, error displays

- [x] **Validation Errors**:
  - **User Message**: "此治療師已被指派" or "治療師不存在"
  - **Recovery Action**: User selects different practitioner
  - **Implementation**: Backend validation, frontend error handling

- [x] **Loading States**:
  - **Initial Load**: Loading assignment lists
  - **Assignment**: Loading during add/remove operations
  - **Flow Detection**: Loading during patient check in LIFF
  - **Implementation**: `useApiData` loading states

- [x] **Permission Errors (403)**:
  - **User Message**: "無權限管理負責人員"
  - **Recovery Action**: Contact admin for permissions
  - **Implementation**: Backend permission checks

### Testing Requirements

#### E2E Tests (Playwright)
- [ ] **Test Scenario**: Patient assignment management
  - Steps:
    1. Navigate to patient detail page
    2. Click edit assignments
    3. Add practitioner
    4. Verify assignment added
    5. Remove practitioner
    6. Verify assignment removed
  - Assertions: Assignments managed correctly, UI updates properly

- [ ] **Test Scenario**: LIFF practitioner filtering
  - Steps:
    1. Set `restrict_to_assigned_practitioners = true`
    2. Assign practitioner to patient
    3. Open LIFF as that patient
    4. Verify only assigned practitioner shown
  - Assertions: Filtering works, fallback to all practitioners when appropriate

- [ ] **Test Scenario**: Assignment prompt after appointment
  - Steps:
    1. Create appointment with unassigned practitioner
    2. Verify assignment prompt appears
    3. Click yes to assign
    4. Verify practitioner assigned
  - Assertions: Prompt appears correctly, assignment works

#### Integration Tests (MSW)
- [ ] **Test Scenario**: Assignment CRUD operations
  - Mock API responses: Assignment list, add, remove
  - User interactions: Add/remove assignments
  - Assertions: API calls correct, UI updates properly

- [ ] **Test Scenario**: Practitioner filtering logic
  - Mock API responses: Assignments, settings, practitioners
  - User interactions: Select patient, see filtered practitioners
  - Assertions: Filtering logic works correctly

- [ ] **Test Scenario**: Error handling
  - Mock API responses: 400, 403, 404, 500 errors
  - User interactions: Trigger errors
  - Assertions: Errors handled gracefully

#### Unit Tests
- [ ] **Component**: `PatientAssignmentsSection`
  - Test cases: Renders assignments, handles add/remove, error states
- [ ] **Component**: `PractitionerAssignmentPromptModal`
  - Test cases: Shows prompt, handles confirmation, displays assignments
- [ ] **Hook**: Assignment filtering logic
  - Test cases: Filters practitioners correctly based on settings and assignments
- [ ] **Service**: Patient-practitioner assignment service
  - Test cases: Assignment validation, duplicate prevention, permission checks

### Performance Considerations

- [x] **Data Loading**: 
  - Assignment lists loaded efficiently with caching
  - Practitioner filtering done client-side for LIFF performance
  - Assignment checks during appointment save are fast

- [x] **Caching**: 
  - Current: Custom cache with clinic ID injection
  - Future: React Query will provide better caching

- [x] **Optimistic Updates**: 
  - Assignment add/remove could use optimistic updates
  - Currently waits for server confirmation

- [x] **Lazy Loading**: 
  - Assignment sections loaded on demand
  - LIFF flow components lazy loaded

- [x] **Memoization**: 
  - Filtered practitioner lists memoized
  - Assignment status checks cached

---

## Integration Points

### Backend Integration
- [x] **Dependencies on other services**:
  - Assignment service integrates with patient and practitioner management
  - Appointment service checks assignments for filtering and prompts
  - Settings service provides `restrict_to_assigned_practitioners` setting

- [x] **Database relationships**:
  - Assignment table links patients and practitioners within clinics
  - Foreign key constraints ensure data integrity

- [x] **API contracts**:
  - RESTful API for assignment CRUD operations
  - Consistent error response format

### Frontend Integration
- [x] **Shared components used**:
  - `BaseModal`, `LoadingSpinner`, `ErrorMessage`
  - Form components for practitioner selection

- [x] **Shared hooks used**:
  - `useApiData` (assignment data, patient data)
  - `useAuth` (permissions)

- [x] **Shared stores used**:
  - `appointmentStore` (LIFF flow state)

- [x] **Navigation/routing changes**:
  - Patient detail page includes assignment management
  - LIFF flow adapts based on patient selection timing

---

## Security Considerations

- [x] **Authentication requirements**:
  - All assignment operations require authenticated clinic user
  - LIFF operations require valid LINE user token

- [x] **Authorization checks**:
  - Assignment management requires admin or practitioner role
  - Viewing assignments requires clinic membership
  - LIFF filtering respects clinic settings

- [x] **Input validation**:
  - Practitioner IDs validated as clinic members
  - Patient IDs validated as clinic patients
  - Assignment uniqueness enforced

- [x] **XSS prevention**:
  - User input in assignment displays sanitized
  - React automatically escapes content

- [x] **CSRF protection**:
  - API operations protected with authentication
  - Tokens validated on every request

- [x] **Data isolation**:
  - Clinic isolation enforced on all assignment operations
  - Users can only manage assignments within their clinic

---

## Summary

This document covers:
- Patient-practitioner assignment business logic and rules
- Appointment settings integration (`restrict_to_assigned_practitioners`)
- LIFF appointment flow changes (conditional patient selection, practitioner filtering)
- Clinic-side assignment prompts and management
- Edge cases (multiple patients, no assignments, fallback behavior)
- Backend technical design (API endpoints, database schema, services)
- Frontend technical design (state management, components, user flows, testing)

All business rules are enforced at both frontend (UX) and backend (source of truth) levels.

**Migration Status**: This document has been migrated to the new template format. Frontend sections reflect current implementation using `useApiData` and `appointmentStore`. React Query migration is planned for Phase 2 (Weeks 3-5) per `ai_frontend_dev.md`.

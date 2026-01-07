# Patient Management - Business Logic & Technical Design

## Overview

This document defines the business logic and technical design for patient management, including patient creation, editing, patient detail page, and appointment viewing.

---

## Key Business Logic

### 1. Patient Creation

**Manual Patient Creation** (Clinic Users):
- **Who**: Clinic admins and practitioners can create patients
- **Required Field**: Full name only
- **Optional Fields**: Phone number, Birthday (both always shown)
- **Phone Validation**: Only if provided (empty phone allowed)
- **Duplicate Phone Numbers**: Allowed (multiple patients can share same phone number)
- **Duplicate Name Detection**: Real-time warning as user types name (debounced, 400ms)
  - Exact name matching (case-insensitive)
  - Shows count of existing patients with same name
  - Non-blocking warning (does not prevent creation)

**Rationale**: Allows clinics to register walk-in patients, patients who don't use LINE, and patients who visit before setting up their LINE account.

### 2. Patient Detail Page

**Purpose**: Dedicated page for viewing and editing patient information, along with viewing their appointment history.

**Patient Information Section**:
- **Display Fields**: Full name, Phone number, Birthday (if available), LINE user link (if linked), Created date
- **Edit Capability**: 
  - "Edit" button toggles edit mode
  - Inline edit form (edit directly on the page, not in a modal)
  - Editable fields: `full_name`, `phone_number`, `birthday`
  - Save/Cancel buttons (shown in edit mode)
  - Validation (same as patient creation)

**Appointments Section**:
- **Three Tabs**: Future (upcoming confirmed), Completed (past confirmed), Cancelled (all cancelled)
- **Appointment Display**: Date and time, Practitioner name, Appointment type, Status badge, Notes (patient-provided notes shown for future appointments only)
- **Display-Only**: Appointments are not clickable, not editable on patient detail page
- **No Pagination**: Show all appointments

**Rationale**: Provides comprehensive patient view with appointment history, while keeping appointment editing on calendar/event modal.

### 3. Soft-Deleted Patients

**Scenario**: Patient deletes their own account via LIFF (soft delete).

**Behavior**:
- **Detail Page**: Display warning banner: "此病患已自行刪除帳號。病患無法自行預約，但診所仍可查看、編輯此病患資料，並為其安排預約。"
- **List Page**: Warning icon (⚠️) with tooltip next to patient name
- **Clinic Actions**: Clinic can still view, edit, and schedule appointments for soft-deleted patients
- **LINE Notifications**: LINE user will receive notifications for appointments scheduled by clinic

**Rationale**: Preserves clinic's ability to manage existing appointments and patient relationships even if patient deletes their account.

### 4. Patient Permissions

**View Patient Details**: All clinic members (admin, practitioner, read-only)

**Edit Patient Information**: Admin and Practitioner only (read-only users cannot edit)

**View Appointments**: All clinic members

**Edit Appointments**: Not allowed on patient detail page (appointments are display-only, editing happens on calendar/event modal)

**Rationale**: Maintains appropriate access control while allowing all clinic members to view patient information for coordination.

---

## Backend Technical Design

### API Endpoints

#### `GET /clinic/patients`
- **Description**: List patients with pagination and search
- **Query Parameters**: 
  - `page`: Page number (default: 1)
  - `pageSize`: Items per page (default: 25, max: 100)
  - `search`: Search query (searches name and phone)
- **Response**: `{ patients: Patient[], total: number, page: number, pageSize: number }`
- **Errors**: 400 (invalid params), 500

#### `POST /clinic/patients`
- **Description**: Create new patient
- **Request Body**: `{ full_name: string, phone_number?: string, birthday?: string }`
- **Response**: `{ success: true, patient: Patient }`
- **Errors**: 
  - 400: Validation errors
  - 500: Internal server error

#### `GET /clinic/patients/:id`
- **Description**: Get patient details
- **Path Parameters**: `id` (patient ID)
- **Response**: `Patient` object with full details
- **Errors**: 
  - 404: Patient not found
  - 500: Internal server error

#### `PUT /clinic/patients/:id`
- **Description**: Update patient information
- **Path Parameters**: `id` (patient ID)
- **Request Body**: `{ full_name?: string, phone_number?: string, birthday?: string }`
- **Response**: `{ success: true, patient: Patient }`
- **Errors**:
  - 400: Validation errors
  - 403: Permission denied (read-only users)
  - 404: Patient not found
  - 500: Internal server error

#### `GET /clinic/patients/:id/appointments`
- **Description**: Get appointments for patient
- **Path Parameters**: `id` (patient ID)
- **Query Parameters**:
  - `status`: Filter by status ('confirmed', 'canceled_by_patient', 'canceled_by_clinic')
  - `upcoming_only`: Boolean (true = only future appointments)
- **Response**: `Appointment[]` array
- **Errors**: 404, 500

#### `GET /clinic/patients/check-duplicate?name={name}`
- **Description**: Check for duplicate patient names
- **Query Parameters**: `name` (patient name to check)
- **Response**: `{ count: number }` (number of existing patients with same name)
- **Errors**: 400, 500

### Database Schema

**Patients Table**:
- `id`: Primary key
- `clinic_id`: Foreign key to clinics
- `full_name`: String (required, max 255)
- `phone_number`: String (optional, nullable)
- `birthday`: Date (optional, nullable)
- `line_user_id`: Foreign key to line_users (nullable, for LINE-linked patients)
- `is_deleted`: Boolean (soft delete flag, set when patient deletes own account)
- `created_at`: DateTime
- `updated_at`: DateTime

**Relationships**:
- One patient → One clinic
- One patient → One LINE user (nullable)
- One patient → Many appointments
- One patient → Many receipts

**Constraints**:
- `full_name` required, max 255 characters
- `phone_number` optional, validated if provided (Taiwan format: 10 digits, starts with 09)
- `birthday` optional, cannot be in the future

### Business Logic Implementation

**PatientService** (`backend/src/services/patient_service.py`):
- `create_patient()`: Creates patient with validation
- `update_patient()`: Updates patient with permission checks
- `get_patient()`: Gets patient with clinic isolation
- `list_patients()`: Lists patients with pagination and search
- `check_duplicate_name()`: Checks for duplicate names (case-insensitive)

**Key Business Logic**:
- Permission checks: Read-only users cannot edit patients
- Clinic isolation: Users can only access patients in their active clinic
- Soft delete: `is_deleted` flag preserves data while preventing patient self-service
- Duplicate detection: Non-blocking warning, allows legitimate duplicates

---

## Frontend Technical Design

### State Management Strategy

#### Server State (API Data)
- [x] **Data Source**: Multiple API endpoints for patients, appointments
- [x] **Current Implementation**: Using `useApiData` hook
  - **Note**: Migration to React Query planned for Phase 2 (Weeks 3-5) per `ai_frontend_dev.md`
- [x] **Query Keys** (when migrated to React Query):
  - `['patients', clinicId, page, pageSize, search]` - Patient list
  - `['patient', patientId]` - Single patient
  - `['patient-appointments', patientId, status, upcomingOnly]` - Patient appointments
  - `['duplicate-check', name]` - Duplicate name check
- [x] **Cache Strategy**:
  - **Current**: Custom cache with TTL (5 minutes default), clinic ID auto-injection
  - **Future (React Query)**:
    - `staleTime`: 5 minutes (patient data)
    - `staleTime`: 1 minute (appointment data - changes frequently)
    - `cacheTime`: 10 minutes
    - Invalidation triggers: Patient create/update, clinic switch

#### Client State (UI State)
- [x] **Local Component State**: 
  - `PatientsPage`: Search input, pagination, modal states (create, success, appointment)
  - `PatientDetailPage`: Edit mode toggle, form state, active tab (Future/Completed/Cancelled)
  - `PatientCreationModal`: Form fields (name, phone, birthday), duplicate warning, loading state
  - `PatientAppointmentsList`: Active tab, selected event, edit/delete states

#### Form State
- [x] **React Hook Form**: Used in `PatientCreationModal` and `PatientDetailPage` edit mode
  - **Form Fields**: `full_name` (required), `phone_number` (optional), `birthday` (optional)
  - **Validation Rules**: 
    - Full name: Required, max 255 characters
    - Phone number: If provided, must be valid Taiwan phone (10 digits, starts with 09)
    - Birthday: If provided, must be valid date, cannot be in future
  - **Default Values**: Empty for create, current patient data for edit

### Component Architecture

#### Component Hierarchy
```
PatientsPage
  ├── PatientCreationModal
  │   └── Form (React Hook Form)
  ├── PatientCreationSuccessModal
  │   └── CreateAppointmentModal (optional)
  └── PatientList
      └── PatientRow (clickable → navigate to detail)

PatientDetailPage
  ├── PatientInfoSection
  │   ├── Display Mode
  │   └── Edit Mode (inline form)
  └── PatientAppointmentsList
      ├── Tabs (Future/Completed/Cancelled)
      └── AppointmentCard[] (display-only)
```

#### Component List
- [x] **PatientsPage** (`frontend/src/pages/PatientsPage.tsx`)
  - **Props**: None
  - **State**: Search input, pagination (page, pageSize), modal states, created patient data
  - **Dependencies**: `useApiData` (patients list), `PatientCreationModal`, `PatientCreationSuccessModal`, `CreateAppointmentModal`

- [x] **PatientDetailPage** (`frontend/src/pages/PatientDetailPage.tsx`)
  - **Props**: Route params (`id`)
  - **State**: Edit mode, form state, active tab
  - **Dependencies**: `useApiData` (patient, appointments), `PatientInfoSection`, `PatientAppointmentsList`

- [x] **PatientCreationModal** (`frontend/src/components/PatientCreationModal.tsx`)
  - **Props**: `isOpen`, `onClose`, `onSuccess`
  - **State**: Form state via React Hook Form, duplicate warning, loading
  - **Dependencies**: `useForm`, `useApiData` (duplicate check), `useDebounce`

- [x] **PatientCreationSuccessModal** (`frontend/src/components/PatientCreationSuccessModal.tsx`)
  - **Props**: `isOpen`, `onClose`, `patient` (created patient data), `onCreateAppointment`
  - **State**: None (display only)
  - **Dependencies**: None

- [x] **PatientInfoSection** (`frontend/src/components/patient/PatientInfoSection.tsx`)
  - **Props**: `patient`, `onUpdate`, `canEdit`
  - **State**: Edit mode, form state
  - **Dependencies**: `useForm`, `useApiData` (update patient)

- [x] **PatientAppointmentsList** (`frontend/src/components/patient/PatientAppointmentsList.tsx`)
  - **Props**: `patientId`, `practitioners`, `appointmentTypes`, `onRefetchReady`
  - **State**: Active tab, selected event, edit/delete states
  - **Dependencies**: `useApiData` (appointments), `EventModal`, `EditAppointmentModal`, `CreateAppointmentModal`

### User Interaction Flows

#### Flow 1: Create Patient
1. User clicks "新增病患" button on `PatientsPage`
2. `PatientCreationModal` opens
3. User enters full name (required)
4. System checks for duplicate names (debounced, 400ms after typing stops)
5. If duplicates found: Warning shown "發現 {count} 位同名病患"
6. User enters phone number (optional, validated if provided)
7. User selects birthday (optional, date picker)
8. User clicks "確認"
9. Form validates
10. If valid: Patient created via API
11. Modal closes, `PatientCreationSuccessModal` opens
12. Success modal shows patient name and "新增預約" button
13. User can close modal or click "新增預約" to create appointment immediately
   - **Edge case**: Duplicate name warning → Non-blocking, user can still create
   - **Error case**: Validation error → Field-level errors shown
   - **Error case**: API error → Error message shown, user can retry

#### Flow 2: View Patient List
1. User navigates to `/admin/clinic/patients`
2. `PatientsPage` loads
3. System fetches patients list (paginated, 25 per page)
4. User can search by name or phone
5. User can navigate pages
6. User clicks patient row → Navigates to `PatientDetailPage`
   - **Edge case**: Soft-deleted patient → Warning icon (⚠️) shown with tooltip

#### Flow 3: View Patient Detail
1. User clicks patient on list → Navigates to `/admin/clinic/patients/:id`
2. `PatientDetailPage` loads
3. System fetches patient details and appointments
4. Patient info section shows: Name, phone, birthday, LINE link, created date
5. Appointments section shows three tabs: Future, Completed, Cancelled
6. User clicks tab → Appointments filtered by status
7. Appointments displayed (date, practitioner, type, status, notes)
   - **Edge case**: Soft-deleted patient → Warning banner shown at top
   - **Edge case**: No appointments → Empty state message shown

#### Flow 4: Edit Patient Information
1. User clicks "編輯" button on `PatientDetailPage`
2. Patient info section switches to edit mode (inline form)
3. Form pre-fills with current patient data
4. User modifies fields (name, phone, birthday)
5. User clicks "儲存"
6. Form validates
7. If valid: Patient updated via API
8. Success message shown, edit mode exits
9. If invalid: Validation errors shown
   - **Edge case**: Read-only user → Edit button hidden
   - **Error case**: Permission denied → Error message shown
   - **Error case**: Patient not found → 404 error, redirect to list

#### Flow 5: Create Appointment from Patient Detail
1. User views patient detail page
2. User clicks "新增預約" button
3. `CreateAppointmentModal` opens with patient pre-selected
4. User completes appointment creation flow
5. Appointment created, modal closes
6. Patient appointments list refreshes, new appointment appears in Future tab

### Edge Cases and Error Handling

#### Edge Cases
- [x] **Race Condition**: User switches clinic during patient fetch
  - **Solution**: `useApiData` includes clinic ID in cache keys, automatically refetches on clinic switch
  - **Future (React Query)**: Query invalidation on clinic switch

- [x] **Concurrent Updates**: Multiple users edit same patient simultaneously
  - **Solution**: Last write wins (no conflict detection), backend validates permissions

- [x] **Clinic Switching**: User switches clinic while viewing patient detail
  - **Solution**: Patient data refetches, or redirect to list if patient not in new clinic

- [x] **Component Unmount**: Component unmounts during API call
  - **Solution**: `useApiData` checks `isMountedRef` before state updates, prevents memory leaks

- [x] **Network Failure**: API call fails (network error, timeout)
  - **Solution**: Error message shown to user, retry option available
  - **Implementation**: `useApiData` handles errors, shows user-friendly messages

- [x] **Stale Data**: User views patient, another user modifies it, first user tries to edit
  - **Solution**: Last write wins (no conflict detection), second save overwrites first

- [x] **Duplicate Name Detection**: User types name that matches existing patients
  - **Solution**: Real-time API call (debounced 400ms), warning shown, non-blocking
  - **Implementation**: `useDebounce` hook, `useApiData` for duplicate check

- [x] **Patient Soft-Deleted**: Patient deletes own account while clinic user viewing
  - **Solution**: Warning banner shown immediately when `is_deleted` flag detected
  - **Implementation**: Patient data includes `is_deleted` flag, UI shows warning

- [x] **Patient Created in Another Tab**: Patient created while user viewing list
  - **Solution**: List doesn't auto-refresh, user can manually refresh or navigate away and back

#### Error Scenarios
- [x] **API Errors (4xx, 5xx)**:
  - **User Message**: User-friendly error messages extracted from API response
  - **Recovery Action**: User can retry operation, or cancel and try again
  - **Implementation**: `getErrorMessage()` utility, `useApiData` displays errors

- [x] **Validation Errors**:
  - **User Message**: Field-level error messages (e.g., "請輸入姓名", "電話號碼格式不正確")
  - **Field-level Errors**: Shown inline next to form fields via React Hook Form
  - **Implementation**: Zod schema validation, React Hook Form error display

- [x] **Loading States**:
  - **Initial Load**: Loading spinner shown while fetching patient list or detail
  - **Refetch**: Loading indicator shown during search or pagination
  - **Mutation**: Submit button disabled, loading spinner shown during create/update
  - **Implementation**: `useApiData` provides `loading` state, components show spinners

- [x] **Permission Errors (403)**:
  - **User Message**: "您沒有權限執行此操作"
  - **Recovery Action**: User cannot proceed, must contact admin
  - **Implementation**: Backend returns 403, frontend shows error message, edit button hidden for read-only users

- [x] **Not Found Errors (404)**:
  - **User Message**: "病患不存在"
  - **Recovery Action**: Redirect to patient list
  - **Implementation**: Backend returns 404, frontend redirects or shows error

### Testing Requirements

#### E2E Tests (Playwright)
- [ ] **Test Scenario**: Create patient flow
  - Steps:
    1. Login as admin
    2. Navigate to patients page
    3. Click "新增病患"
    4. Enter name, phone, birthday
    5. Click "確認"
    6. Verify success modal
    7. Click "新增預約" (optional)
  - Assertions: Patient created, success modal shown, appointment modal opens (if clicked)
  - Edge cases: Test duplicate name warning, test validation errors

- [ ] **Test Scenario**: View patient list and search
  - Steps:
    1. Navigate to patients page
    2. Verify patient list displayed
    3. Enter search query
    4. Verify filtered results
    5. Click patient row
  - Assertions: List displayed, search works, navigation to detail page works

- [ ] **Test Scenario**: View patient detail
  - Steps:
    1. Navigate to patient detail page
    2. Verify patient info displayed
    3. Click appointments tabs
    4. Verify appointments filtered
  - Assertions: Patient info correct, appointments displayed, tabs work

- [ ] **Test Scenario**: Edit patient information
  - Steps:
    1. Navigate to patient detail page
    2. Click "編輯"
    3. Modify fields
    4. Click "儲存"
    5. Verify changes persisted
  - Assertions: Edit mode works, changes saved, form validation works

- [ ] **Test Scenario**: Soft-deleted patient warning
  - Steps:
    1. View soft-deleted patient
    2. Verify warning banner shown
  - Assertions: Warning displayed, patient still viewable/editable

#### Integration Tests (MSW)
- [ ] **Test Scenario**: Patient creation with duplicate check
  - Mock API responses: Duplicate check, create patient
  - User interactions: Type name, submit form
  - Assertions: Duplicate warning shown, patient created successfully

- [ ] **Test Scenario**: Patient list pagination and search
  - Mock API responses: Paginated patient list, search results
  - User interactions: Navigate pages, search
  - Assertions: Pagination works, search filters correctly

- [ ] **Test Scenario**: Error handling
  - Mock API responses: 400, 403, 404, 500 errors
  - User interactions: Submit form, trigger errors
  - Assertions: Appropriate error messages shown, user can retry

#### Unit Tests
- [ ] **Component**: `PatientCreationModal`
  - Test cases: Renders correctly, validates form, shows duplicate warning, handles API errors
- [ ] **Component**: `PatientDetailPage`
  - Test cases: Renders correctly, toggles edit mode, saves changes, shows appointments
- [ ] **Component**: `PatientAppointmentsList`
  - Test cases: Renders tabs, filters appointments, displays correctly
- [ ] **Utility**: Duplicate name check
  - Test cases: Debouncing works, API called with correct params, warning displayed

### Performance Considerations

- [x] **Data Loading**: 
  - Patient list paginated (25 per page, max 100)
  - Search debounced to prevent excessive API calls
  - Duplicate name check debounced (400ms) to reduce API calls

- [x] **Caching**: 
  - Current: Custom cache with clinic ID injection, TTL-based invalidation
  - Future: React Query will provide better caching with automatic invalidation

- [x] **Optimistic Updates**: 
  - Not currently used (planned for React Query migration)
  - Patient creation/update waits for server response

- [x] **Lazy Loading**: 
  - Patient detail page lazy loaded via React Router
  - Appointment modals loaded on demand

- [x] **Memoization**: 
  - Patient list rows memoized to prevent unnecessary re-renders
  - Search input debounced to reduce re-renders

---

## Integration Points

### Backend Integration
- [x] **Dependencies on other services**:
  - Patient creation may link to LINE user (if LINE user exists)
  - Patient appointments fetched from appointment service
  - Patient receipts fetched from receipt service

- [x] **Database relationships**:
  - Patients linked to clinics, LINE users, appointments, receipts
  - Foreign key constraints enforce data integrity

- [x] **API contracts**:
  - RESTful API with consistent request/response models
  - Pagination and search standardized

### Frontend Integration
- [x] **Shared components used**:
  - `PageHeader`, `SearchInput`, `LoadingSpinner`, `ErrorMessage`, `PaginationControls`
  - `BaseModal`, form components (`TextInput`, `DatePicker`, etc.)

- [x] **Shared hooks used**:
  - `useApiData` (data fetching)
  - `useAuth` (authentication context)
  - `useModal` (modal management)
  - `useDebounce` (search debouncing)
  - `useHighlightRow` (row highlighting on navigation)

- [x] **Shared stores used**:
  - None (uses local component state)

- [x] **Navigation/routing changes**:
  - Patient list: `/admin/clinic/patients`
  - Patient detail: `/admin/clinic/patients/:id`
  - Integration with appointment creation flow

---

## Security Considerations

- [x] **Authentication requirements**:
  - All patient endpoints require authenticated clinic user

- [x] **Authorization checks**:
  - View patients: All clinic members
  - Edit patients: Admin and Practitioner only (read-only users cannot edit)
  - Backend validates permissions before allowing operations

- [x] **Input validation**:
  - All API requests validated using Pydantic models
  - Frontend validation via React Hook Form and Zod schemas
  - Phone number format validation (Taiwan format)
  - Birthday validation (cannot be in future)

- [x] **XSS prevention**:
  - User input sanitized before display
  - React automatically escapes content

- [x] **CSRF protection**:
  - API uses JWT authentication tokens
  - Tokens validated on every request

- [x] **Data isolation**:
  - Clinic isolation enforced via `ensure_clinic_access()` dependency
  - Users can only access patients in their active clinic
  - Patient search scoped to active clinic

---

## Summary

This document covers:
- Patient creation (manual creation by clinic users, duplicate name detection)
- Patient detail page (information display/edit, appointment history with tabs)
- Soft-deleted patients (warning indicators, clinic can still manage)
- Patient permissions (view/edit access control)
- Edge cases (duplicate names, duplicate phones, empty phones, concurrent operations)
- Backend technical design (API endpoints, database schema, business logic)
- Frontend technical design (state management, components, user flows, testing requirements)

All business rules are enforced at both frontend (UX) and backend (source of truth) levels.

**Migration Status**: ✅ COMPLETED. This document has been migrated to the new template format. Frontend sections now use React Query hooks instead of the old `useApiData` implementation. Migration completed in Phase 2 Week 5.

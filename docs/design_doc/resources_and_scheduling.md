# Resources & Scheduling - Business Logic & Technical Design

## Overview

This document defines the business logic and technical design for resource management, resource constraints, availability checking, and scheduling in the clinic system. It covers resource types, resource requirements, automatic allocation, conflict detection, and override availability scheduling.

---

## Key Business Logic

### 1. Resource Types and Resources

**Resource Types**: Categories of resources (e.g., "治療室" - Treatment Room, "設備" - Equipment)
- Clinic-specific
- Each resource type has a name (unique within clinic)

**Resources**: Individual instances of a resource type (e.g., "治療室1", "治療室2")
- Belong to a resource type
- Have a name (required, unique within type) and description (optional)
- Auto-generated names with sequential numbering (e.g., "治療室1", "治療室2")
- Support soft delete (`is_deleted` flag)

**Rationale**: Allows clinics to manage facility resources (rooms, equipment) separately from practitioner availability.

### 2. Resource Requirements

**Location**: Defined at the service item (appointment type) level only.

**Structure**: Each service item specifies which resource types it needs and the quantity required.

**Example**: "物理治療" appointment type requires 1 "治療室" resource.

**Rationale**: Resource requirements are service-specific, not practitioner-specific. This is the single source of truth for resource requirements.

### 3. Resource Allocation

**Automatic Allocation**: When an appointment is created, system allocates required resources automatically.

**Allocation Strategy**:
- Simple: First available resource ordered by name (deterministic)
- Future: Can extend to round-robin, least-recently-used, or resource preferences

**Multiple Resources**: One appointment can use multiple resources (of same or different types).

**Storage**: Allocation is stored as appointment-resource relationships (`appointment_resource_allocations` table).

**Rationale**: Ensures appointments have required resources without manual intervention, while maintaining flexibility for manual override.

### 4. Slot Calculation with Resource Constraints

**Available Slot Calculation**: Slot is only available if both practitioner AND resources are available.

**Priority Order**:
1. Check if practitioner is available (existing logic)
2. Check if required resources are available
3. Slot is only available if both conditions are met

**Resource Availability Check**:
- For a given time slot (start_time, end_time):
  - Query all appointments that overlap with this time slot
  - **Exclude cancelled appointments** (only count confirmed appointments)
  - **Exclude current appointment** when editing (use `exclude_calendar_event_id` parameter)
  - For each overlapping appointment, get its allocated resources
  - Count how many resources of each type are allocated
  - **Exclude soft-deleted resources** from total count (only count active resources)
  - Available quantity = Total active resources of type - Allocated resources of type

**Rationale**: Prevents double-booking of resources while maintaining flexibility for clinic users to override constraints.

### 5. Conflict Detection Priority

All conflicts are detected and returned to the frontend. Priority determines the order of display:

1. **Past Appointment** (Highest Priority)
2. **Appointment Conflict**
3. **Availability Exception Conflict**
4. **Outside Default Availability**
5. **Resource Conflict** (Lowest Priority)

**Multiple Conflicts**: If multiple conflict types exist (e.g., appointment conflict + resource conflict), ALL are displayed to the user.

**Rationale**: Resource conflicts are lowest priority because they can be overridden by clinic users, while appointment conflicts are hard conflicts.

### 6. Override Availability Scheduling

**Purpose**: Allow clinic users (admins and practitioners) to schedule appointments at any time, regardless of practitioner default availability or availability exceptions.

**Override Mode**:
- **Default Mode (Override Toggle OFF)**: Shows only available time slots within practitioner's default availability
- **Override Mode (Toggle ON)**:
  - All dates become selectable (even if no normal availability)
  - Time selection changes to **free-form time input** (12-hour format: H:MM AM/PM or 24-hour: HH:MM)
  - Allows any time selection regardless of availability, including **past dates/times**
  - Real-time conflict detection and display (warnings, not blockers)

**Permissions**:
- Clinic admins: ✅ Always available
- Practitioners: ✅ Always available
- Read-only users: ❌ Not available (cannot create appointments anyway)

**Rationale**: Provides flexibility for urgent appointments, special arrangements, or administrative overrides while maintaining transparency (conflicts shown as warnings).

### 7. Resource Selection During Appointment Creation

**Auto-Selection**: System automatically selects suggested resources when available.

**Selection Logic**:
- When appointment time, practitioner, and appointment type are selected:
  1. Get all required resource types and quantities (from appointment type requirements)
  2. For each required resource type:
     - Find available resources at that time slot
     - Auto-select the required quantity of resources (first available)
     - If insufficient resources available, auto-select what's available and show quantity warning
  3. Selection updates in real-time as user selects time (with debouncing, ~300ms)

**Manual Override**: Users can manually change resource selection (select any resource, available or unavailable).

**Rationale**: Reduces manual work while allowing flexibility for special cases.

---

## Backend Technical Design

### API Endpoints

#### `GET /clinic/resource-types`
- **Description**: List resource types for clinic
- **Response**: `ResourceType[]`
- **Errors**: 500

#### `POST /clinic/resource-types`
- **Description**: Create resource type
- **Request Body**: `{ name: string }`
- **Response**: `{ id: number, name: string }`
- **Errors**: 400 (duplicate name), 500

#### `GET /clinic/resources`
- **Description**: List resources for clinic
- **Query Parameters**: `resource_type_id` (optional filter)
- **Response**: `Resource[]`
- **Errors**: 500

#### `POST /clinic/resources`
- **Description**: Create resource
- **Request Body**: `{ resource_type_id: number, name?: string, description?: string }`
- **Response**: `{ id: number, name: string, ... }`
- **Errors**: 400 (validation), 500

#### `PUT /clinic/resources/{id}`
- **Description**: Update resource
- **Request Body**: `{ name?: string, description?: string }`
- **Response**: `{ success: true }`
- **Errors**: 400, 404, 500

#### `DELETE /clinic/resources/{id}`
- **Description**: Soft delete resource
- **Response**: `{ success: true }`
- **Errors**: 400 (has allocations), 404, 500

#### `GET /clinic/appointments/resource-availability`
- **Description**: Get resource availability for time slot
- **Query Parameters**: `appointment_type_id`, `practitioner_id`, `date`, `start_time`, `end_time`, `exclude_calendar_event_id`
- **Response**: `ResourceAvailabilityResponse`
- **Errors**: 400, 500

### Database Schema

**ResourceTypes Table**:
- `id`: Primary key
- `clinic_id`: Foreign key to clinics
- `name`: String (unique within clinic)
- `is_deleted`: Boolean (soft delete)
- `created_at`: DateTime
- `updated_at`: DateTime

**Resources Table**:
- `id`: Primary key
- `clinic_id`: Foreign key to clinics
- `resource_type_id`: Foreign key to resource_types
- `name`: String (unique within resource type)
- `description`: String (nullable)
- `is_deleted`: Boolean (soft delete)
- `created_at`: DateTime
- `updated_at`: DateTime

**AppointmentResourceRequirements Table**:
- `id`: Primary key
- `appointment_type_id`: Foreign key to appointment_types
- `resource_type_id`: Foreign key to resource_types
- `quantity`: Integer (> 0)
- `created_at`: DateTime

**AppointmentResourceAllocations Table**:
- `id`: Primary key
- `appointment_id`: Foreign key to appointments
- `resource_id`: Foreign key to resources
- `created_at`: DateTime

**Constraints**:
- Resource type names unique per clinic
- Resource names unique per resource type
- Foreign key constraints prevent orphaned records
- Soft delete prevents hard deletion of allocated resources

### Business Logic Implementation

**ResourceService** (`backend/src/services/resource_service.py`):
- `create_resource_type()`: Create with name validation
- `create_resource()`: Create with auto-naming if needed
- `check_resource_availability()`: Check availability for time slot
- `allocate_resources()`: Auto-allocate required resources
- `deallocate_resources()`: Release resources on appointment changes

**AvailabilityService Integration**:
- `check_slot_availability()`: Combined practitioner + resource availability
- Resource conflicts detected and prioritized
- Override mode bypasses resource constraints

**Key Business Logic**:
- Resource allocation happens during appointment creation/editing
- Allocation is deterministic (first available, ordered by name)
- Resource constraints are checked but can be overridden by clinic users
- Soft deletes preserve data integrity

---

## Frontend Technical Design

### State Management Strategy

#### Server State (API Data)
- [x] **Data Source**: Resource APIs, availability API, appointment creation APIs
- [x] **Current Implementation**: Using `useApiData` hook
  - **Note**: Migration to React Query planned for Phase 2 (Weeks 3-5) per `ai_frontend_dev.md`
- [x] **Query Keys** (when migrated to React Query):
  - `['resource-types', clinicId]` - Resource types
  - `['resources', clinicId, resourceTypeId]` - Resources
  - `['resource-availability', appointmentTypeId, practitionerId, date, time]` - Availability
- [x] **Cache Strategy**:
  - **Current**: Custom cache with TTL (5 minutes default)
  - **Future (React Query)**:
    - `staleTime`: 5 minutes (resource data)
    - `staleTime`: 1 minute (availability data - changes frequently)
    - `cacheTime`: 10 minutes
    - Invalidation triggers: Resource creation/deletion, appointment create/update

#### Client State (UI State)
- [x] **ResourceSelection Component State** (`frontend/src/components/calendar/ResourceSelection.tsx`):
  - **State Properties**:
    - `selectedResources`: Map of resource type ID to selected resource IDs
    - `expandedSections`: Which resource type sections are expanded
    - `availableResources`: Cached availability data per time slot
    - `conflicts`: Resource conflicts for current selection
  - **Actions**:
    - Toggle section expansion
    - Select/deselect resources
    - Auto-select resources based on availability
    - Validate selection against requirements
  - **Usage**: Complex resource selection in appointment creation/editing

- [x] **DateTimePicker Integration**:
  - Resource availability affects slot display
  - Conflicts shown with appropriate warnings

#### Form State
- [x] **Resource Selection**: Complex multi-step selection with validation
  - **Validation Rules**: Required quantities met, conflicts checked
  - **Dependencies**: Selection depends on appointment type and time slot
  - **Auto-selection**: System suggests optimal resource allocation

### Component Architecture

#### Component Hierarchy
```
CreateAppointmentModal/EditAppointmentModal
  ├── DateTimePicker
  │   └── ResourceAvailabilityIndicator (shows conflicts)
  ├── ResourceSelection
  │   ├── ResourceTypeSection (expandable)
  │   │   ├── ResourceGrid
  │   │   │   └── ResourceCard (selectable)
  │   │   └── QuantityWarning
  │   ├── SummaryDisplay (compact view)
  │   └── ExpandCollapseButton
  └── ConflictDisplay (shows all conflicts)
```

#### Component List
- [x] **ResourceSelection** (`frontend/src/components/calendar/ResourceSelection.tsx`)
  - **Props**: `appointmentTypeId`, `selectedTime`, `initialSelections`, `onSelectionChange`, `onValidationChange`
  - **State**: Selection state, expansion state, availability data
  - **Dependencies**: `useApiData` (availability), `useDebounce` (time change debouncing)
  - **Features**: Two-level expansion, auto-selection, conflict detection

- [x] **DateTimePicker** (`frontend/src/components/calendar/DateTimePicker.tsx`)
  - **Props**: `selectedDate`, `selectedTime`, `appointmentTypeId`, `practitionerId`, `onSlotSelect`
  - **State**: Calendar view, time slots, conflicts, resource availability
  - **Dependencies**: `useApiData` (slot availability), availability cache
  - **Integration**: Resource conflicts affect slot availability display

- [x] **ResourceSettings** (`frontend/src/components/ResourcesSettings.tsx`)
  - **Props**: None (settings context)
  - **State**: Resource types list, resources list, create/edit forms
  - **Dependencies**: `useApiData` (CRUD operations), settings context

### User Interaction Flows

#### Flow 1: Resource Selection During Appointment Creation
1. User selects appointment type, practitioner, date, and time
2. `ResourceSelection` component loads requirements for appointment type
3. System calls resource availability API to get available resources
4. Auto-selection runs: System selects required quantities of available resources
5. If insufficient resources: Shows quantity warnings, allows user to proceed or change time
6. User can manually adjust selections or expand to see detailed options
7. Real-time validation shows conflicts and unmet requirements
8. User can proceed with appointment creation (resources allocated on backend)
   - **Edge case**: No resources of required type exist → Warning shown, appointment can still be created
   - **Edge case**: All resources unavailable → User can select unavailable resources manually
   - **Error case**: API failure → Fallback to manual selection mode

#### Flow 2: Override Availability Scheduling
1. User enables "Override Mode" toggle in DateTimePicker
2. Date picker becomes fully selectable (no availability restrictions)
3. Time input changes to free-form text input
4. User can enter any date/time, including past dates
5. System shows real-time conflicts as warnings (not blockers)
6. Resource selection still functions normally
7. User can proceed with appointment creation
   - **Edge case**: Past date/time selected → Conflicts shown but not blocked
   - **Edge case**: No practitioner availability → Still allows scheduling with override

#### Flow 3: Resource Management (Settings)
1. Admin navigates to Resources settings page
2. Views list of resource types and resources
3. Can create new resource types
4. Can add resources to types (auto-naming or custom names)
5. Can edit resource details
6. Can soft-delete resources (with allocation checks)
7. Can view which appointments use specific resources
   - **Edge case**: Resource has active allocations → Deletion blocked, shows affected appointments
   - **Error case**: Duplicate names → Validation error shown

### Edge Cases and Error Handling

#### Edge Cases
- [x] **Race Condition**: User changes time while resource availability loading
  - **Solution**: Debounced updates (~300ms), latest time wins, cancels previous requests

- [x] **Concurrent Resource Allocation**: Two appointments created simultaneously for same resources
  - **Solution**: Database-level allocation prevents conflicts, first appointment succeeds

- [x] **Component Unmount**: Resource selection unmounts during API call
  - **Solution**: `useApiData` checks `isMountedRef`, prevents state updates after unmount

- [x] **Network Failure**: Resource availability API fails
  - **Solution**: Fallback to manual selection mode, error logged, user can proceed

- [x] **Stale Data**: User views availability, another appointment created, resources no longer available
  - **Solution**: Real-time validation on appointment creation, backend checks current availability

- [x] **Resource Deletion**: Resource deleted while user selecting it
  - **Solution**: Backend validation on appointment creation, returns error if resource deleted

- [x] **Appointment Type Change**: User changes appointment type with different resource requirements
  - **Solution**: Resource selection resets and recalculates for new requirements

- [x] **Override Mode + Resources**: Override mode with resource conflicts
  - **Solution**: Resource conflicts shown as warnings, can be overridden like other conflicts

#### Error Scenarios
- [x] **API Errors (4xx, 5xx)**:
  - **User Message**: "資源載入失敗" or "資源分配失敗"
  - **Recovery Action**: Retry operation, or proceed with manual selection
  - **Implementation**: `getErrorMessage()` utility, fallback to manual mode

- [x] **Validation Errors**:
  - **User Message**: "資源數量不足" or "資源已被預約"
  - **Field-level Errors**: Shown inline in resource selection UI
  - **Implementation**: Frontend validation, backend validation on appointment creation

- [x] **Loading States**:
  - **Initial Load**: Loading availability data for resource selection
  - **Time Change**: Loading new availability data (debounced)
  - **Appointment Creation**: Loading during resource allocation
  - **Implementation**: `useApiData` loading states, UI shows spinners and disabled states

- [x] **Permission Errors (403)**:
  - **User Message**: "無權限管理資源"
  - **Recovery Action**: Admin-only features hidden for non-admins
  - **Implementation**: Frontend permission checks, backend validation

- [x] **Not Found Errors (404)**:
  - **User Message**: "資源不存在"
  - **Recovery Action**: Refresh resource list, remove invalid selections
  - **Implementation**: Backend returns 404, frontend handles gracefully

### Testing Requirements

#### E2E Tests (Playwright)
- [ ] **Test Scenario**: Resource selection during appointment creation
  - Steps:
    1. Login as admin
    2. Create appointment with resource requirements
    3. Verify resource auto-selection works
    4. Change time, verify resources update
    5. Manually change resource selection
    6. Verify conflicts shown appropriately
    7. Complete appointment creation
  - Assertions: Resources allocated correctly, conflicts detected, appointment created

- [ ] **Test Scenario**: Override availability scheduling
  - Steps:
    1. Enable override mode
    2. Select past date/time
    3. Verify conflicts shown as warnings
    4. Create appointment
    5. Verify appointment created despite conflicts
  - Assertions: Override mode works, conflicts are warnings not blockers

- [ ] **Test Scenario**: Resource management
  - Steps:
    1. Navigate to resources settings
    2. Create resource type
    3. Add resources
    4. Try to delete allocated resource
    5. Verify deletion blocked with warning
  - Assertions: Resource management works, allocation constraints enforced

#### Integration Tests (MSW)
- [ ] **Test Scenario**: Resource availability checking
  - Mock API responses: Resource availability, conflicts
  - User interactions: Select time slot, view resource availability
  - Assertions: Availability calculated correctly, conflicts detected

- [ ] **Test Scenario**: Resource allocation
  - Mock API responses: Appointment creation with resource allocation
  - User interactions: Create appointment with resources
  - Assertions: Resources allocated correctly, conflicts prevented

- [ ] **Test Scenario**: Error handling
  - Mock API responses: 400, 403, 404, 500 errors
  - User interactions: Trigger resource operations, handle errors
  - Assertions: Errors handled gracefully, user can retry

#### Unit Tests
- [ ] **Component**: `ResourceSelection`
  - Test cases: Auto-selection works, manual selection works, validation works, expansion/collapse works
- [ ] **Component**: `DateTimePicker` (resource integration)
  - Test cases: Resource conflicts shown, override mode works, slot availability correct
- [ ] **Hook**: Resource availability logic
  - Test cases: Availability calculation correct, conflicts detected, caching works
- [ ] **Service**: Resource allocation logic
  - Test cases: Allocation strategy works, conflicts detected, deallocation works

### Performance Considerations

- [x] **Data Loading**: 
  - Resource availability debounced (~300ms) to prevent excessive API calls
  - Resource lists cached with TTL
  - Availability data cached briefly since it changes frequently

- [x] **Caching**: 
  - Current: Custom cache with clinic ID injection
  - Future: React Query will provide better caching

- [x] **Optimistic Updates**: 
  - Not currently used (resource allocation is server-validated)
  - Could use optimistic updates for resource selection UI

- [x] **Lazy Loading**: 
  - Resource selection component loaded on demand
  - Resource settings loaded lazily

- [x] **Memoization**: 
  - Resource availability calculations memoized
  - Resource selection state optimized

---

## Integration Points

### Backend Integration
- [x] **Dependencies on other services**:
  - Resource service integrates with appointment service
  - Availability service combines practitioner and resource checks
  - Settings service provides resource configuration

- [x] **Database relationships**:
  - Resources linked to resource types and clinics
  - Allocations link appointments to resources
  - Requirements link appointment types to resource types

- [x] **API contracts**:
  - RESTful API for resource CRUD operations
  - Consistent error response format

### Frontend Integration
- [x] **Shared components used**:
  - `BaseModal`, `LoadingSpinner`, `ErrorMessage`
  - Form components and utilities

- [x] **Shared hooks used**:
  - `useApiData` (resource data, availability)
  - `useDebounce` (time change debouncing)

- [x] **Shared stores used**:
  - None (local component state)

- [x] **Navigation/routing changes**:
  - Settings page includes resource management
  - Calendar modals include resource selection

---

## Security Considerations

- [x] **Authentication requirements**:
  - All resource operations require authenticated clinic user

- [x] **Authorization checks**:
  - Resource management requires admin role
  - Resource viewing requires clinic membership
  - Override availability requires practitioner or admin role

- [x] **Input validation**:
  - Resource names validated for uniqueness and format
  - Resource allocations validated for availability
  - Appointment creation validates resource constraints

- [x] **XSS prevention**:
  - User input in resource names sanitized
  - React automatically escapes content

- [x] **CSRF protection**:
  - API operations protected with authentication
  - Tokens validated on every request

- [x] **Data isolation**:
  - Clinic isolation enforced on all resource operations
  - Users can only access resources within their clinic

---

## Summary

This document covers:
- Resource types and resources (clinic-specific facility management)
- Resource requirements (defined at service item level)
- Resource allocation (automatic allocation with manual override)
- Slot calculation with resource constraints (practitioner + resources)
- Conflict detection priority (resource conflicts lowest priority)
- Override availability scheduling (clinic users can schedule outside normal hours)
- Resource selection UI (two-level expansion, auto-selection)
- Edge cases (resource deletion, type deletion, no resources, recurring appointments)
- Backend technical design (resource service, shared availability logic, API endpoints)
- Frontend technical design (state management, components, user flows, testing requirements)

All business rules are enforced at both frontend (UX) and backend (source of truth) levels.

**Migration Status**: This document has been migrated to the new template format. Frontend sections reflect current implementation using `useApiData`. React Query migration is planned for Phase 2 (Weeks 3-5) per `ai_frontend_dev.md`.

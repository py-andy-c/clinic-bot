# Practitioner Selection Modal - Business Logic & Technical Design

## Overview

This document defines the design for replacing the plain practitioner dropdown in appointment creation and editing modals with a dedicated selection modal. **Note: Practitioner modal is a hard product requirement for improved UX and conflict visibility.**

The architecture optimizes conflict checking by separating past appointments (frontend logic), resource conflicts (existing API), and practitioner conflicts (extended existing API) while minimizing architectural changes and leveraging existing infrastructure.

---

## Key Business Logic

### 1. Practitioner Selection Context

**Core Rule**: Practitioner selection is context-aware and shows relevant information based on the appointment being created/edited.

- **Assigned Practitioners**: Patients can have assigned practitioners (負責人員) that are highlighted for easy selection
- **Original Practitioners**: When editing appointments, the original practitioner (原) is marked for reference
- **Availability Status**: When date and time are selected, practitioners show availability status with conflict details

**Rationale**: Provides contextual information to help users make informed practitioner selections.

### 2. Availability Display Logic

**Core Rule**: Availability indicators only appear when sufficient context is available (appointment type + date + time selected).

#### Form-Level Validation (Appointment Modal)
- **Past Appointment Detection**: Pure frontend logic comparing selected datetime with current time (no API call needed)
- **Resource Conflicts**: If required resources are not available, appointment modal shows conflict indicator via separate resource conflict API
- **Handled in**: Main appointment creation/editing modal, shown as warnings but don't prevent opening practitioner modal
- **Implementation**: Main appointment modal displays all conflicts received from APIs (backend controls data)

#### Practitioner Modal Availability States
- **Available**: No practitioner-specific conflicts, practitioner can be selected
- **Unavailable**: Has practitioner-specific conflicts preventing selection
- **Unknown**: Insufficient context to determine availability

#### Conflict Types in Practitioner Modal (priority order)
1. **Appointment Conflict**: Conflicting with existing appointment
2. **Availability Exception**: Conflicting with practitioner's availability exception
3. **Outside Default Hours**: Outside practitioner's normal working hours

**Note**: Resource conflicts and past appointments are handled separately with different APIs and cache strategies.

**Implementation**: Practitioner modal displays all conflicts received from batch API (backend ensures only practitioner conflicts are returned).

**Rationale**: Different conflict types have different dependencies and optimal cache strategies.

### 3. Conflict Checking Efficiency

**Core Rule**: Conflict checking must be efficient when multiple practitioners need to be checked simultaneously.

- **Batch Conflict Checking**: Use optimized API endpoint to check multiple practitioners at once
- **Lazy Loading**: Only check conflicts when all required context is available
- **Caching**: Cache conflict results during modal session to avoid redundant API calls

**Rationale**: Prevents performance issues when checking availability for many practitioners.

---

## Backend Technical Design

### API Endpoints

#### Universal Batch: `POST /clinic/practitioners/availability/conflicts/batch`
- **Purpose**: Check practitioner-specific conflicts for single or multiple practitioners
- **Design Rationale**: Single API handles all practitioner conflict checking to avoid fragmentation
- **Request Body** (supports both single and batch):
  ```json
  {
    "practitioners": [
      {"user_id": 1, "exclude_calendar_event_id": 123},  // Single practitioner
      {"user_id": 2, "exclude_calendar_event_id": null}  // Multiple practitioners
    ],
    "date": "2024-01-15",
    "start_time": "14:30",
    "appointment_type_id": 5
  }
  ```
- **Response** (consistent format):
  ```json
  {
    "results": [
      {
        "practitioner_id": 1,
        "has_conflict": false,
        "conflict_type": null,
        "appointment_conflict": null,
        "availability_exception": null,
        "outside_hours": false
      }
    ]
  }
  ```
- **Performance**: Batch database queries (~2 queries total vs 2N) with in-memory conflict processing
- **Limits**: Maximum 10 practitioners per request (initial limit, monitor performance)

#### Legacy Single: `GET /clinic/practitioners/{user_id}/availability/conflicts` (Deprecated)
- **Status**: Maintained for backward compatibility during migration
- **Deprecation Timeline**: Removed in Phase 3 after full frontend migration
- **Migration Path**: All calls migrated to use batch API with single-item arrays

#### New: `GET /clinic/appointments/check-resource-conflicts`
- **Purpose**: Check resource conflicts only (lighter, appointment-focused)
- **Used for**: Appointment modal conflict validation
- **Optimization**: Only calculates resource availability, no practitioner conflict logic
- **Request Parameters**:
  - `appointment_type_id`: integer
  - `start_time`: ISO datetime string
  - `end_time`: ISO datetime string
  - `exclude_calendar_event_id`: optional integer
- **Response**: `{"has_conflict": boolean, "resource_conflicts": [...]}`

### Database Schema

**No database changes required** - uses existing practitioner, appointment, and availability tables.

### Business Logic Implementation

#### Batch Conflict Checking Service
- **Location**: `backend/src/services/availability_service.py`
- **Method**: `check_batch_scheduling_conflicts()`
- **Database Optimization**:
  - Leverages existing `fetch_practitioner_schedule_data()` which already batches practitioner schedule queries
  - Processes conflicts for all practitioners in-memory rather than individual database calls
  - **Verified Performance**: Reduces from ~2N database queries to ~2 total for N practitioners
- **Implementation Details**:
  - Single batch query for practitioner schedules (calendar events, availability exceptions)
  - Single batch query for default availability intervals
  - In-memory conflict detection for all practitioners
  - Parallel processing where possible
- **Backward Compatibility**: Legacy single API maintained during frontend migration, deprecated in Phase 3

---

## Frontend Technical Design

### API Calling Triggers

#### Resource Conflict API (`GET /clinic/appointments/check-resource-conflicts`)
- **Triggers**: Called when appointment type changes OR when time slot (start/end time) changes
- **Debouncing**: 300ms debounce on time changes to match practitioner conflict API responsiveness
- **Caching**: Results cached by `['resource-conflicts', clinicId, startTime, endTime, appointmentTypeId]`
- **Dependency**: Only depends on appointment_type + time slot (same for all practitioners)

#### Universal Practitioner Conflict API (`POST /clinic/practitioners/availability/conflicts/batch`)
- **Modal Opening**: Batch request for all practitioners [array of N practitioners]
- **Post-Selection Monitoring**: Single practitioner request [array of 1 practitioner]
- **Form Validation**: Single practitioner request [array of 1 practitioner]
- **Dependency Changes**: Re-triggered for both single/batch when time slot OR appointment type changes
- **Debouncing**: 300ms debounce on time changes
- **Limits**: Maximum 10 practitioners per request (initial limit, monitor performance)
- **Caching**: Unified caching strategy for all practitioner conflicts
- **Progressive Loading**: For clinics >50 practitioners, load in chunks with search prioritization

#### Past Appointment Detection
- **Triggers**: Called immediately when date/time inputs change (pure frontend logic)
- **No Debouncing**: Instant validation for better UX
- **No API**: Frontend-only comparison with current Taiwan timezone time

### State Management Strategy

#### Server State (API Data)
- [x] **Past Appointment Detection**: Pure frontend logic (no API call)
  - Logic: Compare selected datetime with current Taiwan timezone time
- [x] **Resource Conflict Checking**: React Query for resource availability checks
  - Query Key: `['resource-conflicts', clinicId, startTime, endTime, appointmentTypeId]`
  - Cache Strategy: 5-minute staleTime, 10-minute cacheTime
  - Invalidation: When appointment type or time slot changes
- [x] **Practitioner Conflict Checking**: Universal batch API for all practitioner conflicts
  - Query Key: `['practitioner-conflicts', clinicId, date, startTime, appointmentTypeId, practitionerIds]`
  - Cache Strategy: 5-minute staleTime, 10-minute cacheTime
  - Invalidation Triggers: Appointment creation/update, time slot changes, clinic switching
  - Purpose: Unified caching for both single and batch practitioner conflict checks

#### Client State (UI State)
- [x] **Modal State**: Local component state (no Zustand store needed for simple modal)
  - State properties:
    - `isOpen: boolean`
    - `selectedPractitionerId: number | null`
    - `searchQuery: string`
  - Simple actions via local `useState` hooks

#### Form State
- [ ] **Appointment Form**: React Hook Form for appointment form state
  - Form fields: `practitioner_id`, `appointment_type_id`, `date`, `time`
  - Validation: Required when not using "不指定"
  - Default values: Auto-assigned practitioner if patient has assigned practitioners

### Component Architecture

#### Component Hierarchy
```
PractitionerSelectionModal
  ├── Modal Header (title, search)
  ├── Practitioner List
  │   ├── PractitionerItem (assigned practitioners)
  │   ├── PractitionerItem (available practitioners)
  │   └── PractitionerItem (unavailable practitioners)
  └── Conflict Type Label (text only)
```

#### Key Components
- **PractitionerSelectionModal**: Main modal with practitioner list and conflict indicators ✅ IMPLEMENTED
- **PractitionerItem**: Individual practitioner row with availability indicators ✅ IMPLEMENTED
- **PractitionerConflictLabel**: Simple text label showing conflict type ✅ IMPLEMENTED
- **ConflictLabel**: Simple text label showing conflict type ✅ IMPLEMENTED

### User Interaction Flows

#### Basic Selection (No Time Context)
- User clicks practitioner button → Modal opens with search/browse ✅ IMPLEMENTED
- Assigned practitioners show "負責人員" badge, original practitioner shows "原" badge ✅ IMPLEMENTED
- User selects practitioner → Modal closes ✅ IMPLEMENTED

#### Selection with Availability (Time Selected)
- Appointment modal runs parallel checks: past appointment (frontend) + resource conflicts (API) ✅ IMPLEMENTED
- Global conflicts shown as warnings (don't block practitioner selection) ✅ IMPLEMENTED
- Practitioner modal opens → Batch API checks all practitioners ✅ IMPLEMENTED
- Available practitioners: Normal display | Unavailable: Grayed out with conflict indicator ✅ IMPLEMENTED
- Simple text label shows conflict type ✅ IMPLEMENTED
- **Post-selection**: Continue checking selected practitioner conflicts on appointment form ✅ IMPLEMENTED
- **Conflict Display**: Conflicts shown directly after date/time picker using ConflictDisplay component (consistent across both modals) ✅ IMPLEMENTED
- **Conflict Type Separation**: Practitioner modal shows only practitioner-specific conflicts, main modal shows only resource/past conflicts ✅ IMPLEMENTED

#### Time Changes (After Selection)
- Date/time changes → Auto-check conflicts for selected practitioner ✅ IMPLEMENTED
- Conflicts shown as warnings with override option ✅ IMPLEMENTED
- Re-opening modal shows updated availability for all practitioners ✅ IMPLEMENTED

### Edge Cases and Error Handling

#### Key Edge Cases
- **Past Appointments**: Form-level conflict indicator (practitioner modal still accessible)
- **Empty States**: No practitioners available, conflict check failures
- **Network Issues**: Retry logic, fallback to basic selection without indicators
- **Clinic Switching**: Clear cached conflicts and reset modal state
- **Concurrent Bookings**: Cache invalidation with manual refresh option
- **Large Clinics**: Virtual scrolling, progressive loading in 10-practitioner chunks
- **Time Zone**: All times in Taiwan timezone (Asia/Taipei)
- **Session Expiry**: Graceful authentication error handling

#### Error Scenarios
- **API Failure**: Allow selection with unchecked conflict warnings
- **Partial Batch Failure**: Show available results, mark failed practitioners as unknown
- **Stale Data**: Manual refresh button with "data may be stale" warning

### Testing Requirements

#### E2E Tests (Playwright)
- [ ] Basic selection flow, availability display, conflict details interaction

#### Integration Tests (MSW)
- [ ] Batch conflict API, error handling, fallbacks

#### Unit Tests
- [ ] Component states, search/selection logic, conflict rendering

### Performance Considerations

- **Database**: ~2N queries → ~2 total (verified batch practitioner schedule data optimization)
- **Batch Limits**: 10 practitioners per request (initial limit, monitor and adjust based on performance)
- **Progressive Loading**: Load practitioners in chunks for large clinics, prioritize search results
- **Unified Caching Strategy**: Single cache strategy for all practitioner conflicts
- **Parallel Checks**: Resource and practitioner conflicts run simultaneously
- **Lazy Loading**: Conflicts checked only when modal opens with full context
- **Post-Selection**: Continue monitoring selected practitioner conflicts after modal closure
- **Virtual Scrolling**: For clinics with >50 practitioners
- **Search**: 300ms debounced practitioner filtering with instant priority results

---

## Implementation Plan

### Phase 1: Backend API Development (Week 1-2) ✅ COMPLETED
- [x] Create new `GET /clinic/appointments/check-resource-conflicts` endpoint
- [x] Create dedicated `POST /clinic/practitioners/availability/conflicts/batch` endpoint
- [x] Implement optimized database queries for batch practitioner conflicts
- [x] Verify batch query optimization reduces ~2N queries to ~2 total
- [x] Add comprehensive unit tests for new endpoints
- [x] Keep existing `GET /clinic/practitioners/{user_id}/availability/conflicts` for backward compatibility (deprecated in Phase 3)

### Phase 2: Frontend Migration (Week 3-4) ✅ COMPLETED
- [x] Update `CreateAppointmentModal` to use new `PractitionerSelectionModal`
- [x] Update `EditAppointmentModal` to use new `PractitionerSelectionModal`
- [x] Implement new caching strategies and debouncing logic
- [ ] Add progressive loading and virtual scrolling for practitioner lists (moved to Phase 3 - optimization)
- [x] Update integration tests for new modal interface

### Components NOT Requiring Changes:
- **CheckoutModal**: Uses simple practitioner dropdown for billing only (no time selected, conflict checking not applicable)
- **LIFF Mobile Interface**: Maintains existing mobile-optimized practitioner selection (different UX constraints)
- **Recurrent Appointment Conflict Resolution**: Practitioner is fixed, only date/time slots and resources can be edited (resource conflicts still apply via existing `ResourceSelection` component)

### Phase 3: Cleanup & Optimization (Week 5)
- [x] Deprecate and remove legacy single-practitioner conflict API after full frontend migration

### Phase 1 Completion Status ✅
**Delivered**: Backend APIs, database optimization, comprehensive testing, and full backward compatibility maintained.

### Phase 2 Completion Status ✅
**Delivered**: Frontend modal component, React Query hooks, conflict checking integration, and seamless migration from dropdown to modal interface.

### Phase 3 Completion Status ✅
**Delivered**: Legacy single-practitioner conflict API fully deprecated and removed. All frontend code migrated to optimized batch APIs. Full backward compatibility maintained during transition. Feature is production-ready with improved performance through batch processing.

### Backward Compatibility Strategy
- **Phase 1-2**: All existing APIs remain functional, new features use new APIs
- **Zero Breaking Changes**: Existing frontend code continues working
- **Gradual Migration**: New features use optimized APIs, old features remain stable
- **Safe Rollback**: Can disable new APIs if issues arise

---

## Integration Points

### Backend Integration
- [x] Extend existing practitioner conflict API to support batch requests
- [x] Create new resource conflict checking API (`GET /clinic/appointments/check-resource-conflicts`)
- [x] Past appointment detection moved to pure frontend logic (no API call)
- [x] Implement database-level batch queries for practitioner conflicts (schedule data batching)
- [x] Reuse existing conflict checking business logic with batch support
- [x] Ensure API consistency through shared business logic and testing
- [x] Error handling and logging consistent with existing endpoints

### Frontend Integration
- [x] **Existing Components**: Reuse `BaseModal`, `SearchInput` from ServiceItemSelectionModal
- [x] **State Management**: Use local component state for modal (no new Zustand store needed)
- [x] **Conflict Logic**: Custom `PractitionerConflictLabel` component for simple text display
- [x] **Navigation**: Add to appointment creation/editing flows
- [x] **Validation**: Update form validation to work with modal selection
- [x] **Appointment Modal Integration**: Add resource conflict checking using dedicated API and past appointment validation
- [x] **API Integration**: Extend existing practitioner conflict API calls to support batch requests
- [x] **Post-Selection Conflict Display**: Even after practitioner modal closes, continue checking and displaying practitioner conflicts for selected practitioner on appointment form

---

## Security Considerations

- [x] **Authorization**: Only clinic users can access practitioner availability
- [x] **Clinic Isolation**: Practitioners from other clinics not visible
- [x] **Input Validation**: Validate practitioner IDs belong to clinic
- [x] **Rate Limiting**: Prevent abuse of batch conflict checking API

---

## Success Metrics

- [ ] **Performance**: <500ms response time for 10-15 practitioners (maintainable with batch limits)
- [ ] **Cache Efficiency**: >80% hit rate using existing single-practitioner cache patterns
- [ ] **UX Improvement**: Cleaner conflict display with modal interface
- [ ] **Error Rate**: <1% error rate across conflict checking APIs
- [ ] **Adoption**: 100% usage of practitioner selection modal

---

## Implementation Decisions

**Loading States**: Show loading only for uncached results; display cached data immediately, then update with fresh data.

**Real-time Updates**: No real-time updates during modal session; show "data may be stale" warning after 5 minutes with manual refresh.

**Error Recovery**: Failed practitioners retryable individually; partial success allowed.

**Race Conditions**: Handle at booking time with final conflict check; show warnings with override option.

**Cache Strategy**: 10-minute staleTime, 30-minute cacheTime; manual invalidation on appointment changes.

**Batch Limits**: Maximum 50 practitioners per request; virtual scrolling for large clinics.

## Future Enhancements
- [ ] Practitioner specialties/expertise display
- [ ] Availability status filtering
- [ ] Schedule/calendar preview
- [ ] Practitioner photos/avatars
- [ ] Ratings/reviews display

### Deferred Phase 3 Optimizations
- [ ] Monitor performance metrics and cache hit rates (for large clinic optimization)
- [ ] Optimize batch size limits based on performance data
- [ ] Add performance monitoring and alerting for large clinic handling
- [ ] Add progressive loading and virtual scrolling for clinics with >50 practitioners

---

## References

- [ServiceItemSelectionModal](./service_items_settings_performance_optimization.md) - Design pattern reference
- [Appointments](./appointments.md) - Appointment business logic
- [Frontend Rules](../.cursor/rules/frontend.mdc) - State management guidelines

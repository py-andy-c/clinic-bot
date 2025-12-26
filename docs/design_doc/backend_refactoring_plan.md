# Backend Code Refactoring Plan

## Problem Statement

The backend codebase has grown organically, resulting in several maintainability issues:

1. **Massive monolithic files**: `clinic.py` is 8,297 lines with 80 endpoints covering multiple domains
2. **Test cache invalidation**: Large files cause pytest-testmon to invalidate many tests on any change
3. **Poor code organization**: Related endpoints are scattered, making it hard to find and modify code
4. **Other large files**: Several service and API files exceed 1,000 lines

## Current State Analysis

### File Size Breakdown

| File | Lines | Endpoints | Primary Purpose |
|------|-------|-----------|-----------------|
| `api/clinic.py` | 8,297 | 80 | Clinic management (all domains) |
| `services/appointment_service.py` | 2,254 | N/A | Appointment business logic |
| `api/liff.py` | 1,813 | 21 | LINE Front-end Framework endpoints |
| `services/availability_service.py` | 1,790 | N/A | Availability business logic |
| `api/auth.py` | 1,110 | ~15 | Authentication & authorization |
| `api/receipt_endpoints.py` | 1,049 | 10 | Receipt management |

### Clinic.py Domain Breakdown

Based on section markers and endpoint analysis, `clinic.py` contains:

1. **Member Management** (~400 lines)
   - List members, invite, update roles, delete, reactivate
   - 5 endpoints

2. **Settings Management** (~1,200 lines)
   - Get/update clinic settings, appointment types, validation
   - 3 endpoints (but complex logic)

3. **Patient Management** (~500 lines)
   - List, create, update, check duplicates, get appointments
   - 5 endpoints

4. **Appointment Management** (~1,500 lines)
   - Create, edit, delete, recurring, conflicts, resource allocation
   - 8 endpoints

5. **Practitioner Management** (~2,000 lines)
   - List, appointment types, settings, status, availability
   - 10 endpoints

6. **Availability & Calendar** (~1,500 lines)
   - Default schedules, calendar views, slots, conflicts, exceptions
   - 8 endpoints

7. **Resource Management** (~1,200 lines)
   - Resource types, resources, requirements, allocations
   - 10 endpoints

8. **LINE User Management** (~300 lines)
   - List, AI disable/enable, display name
   - 4 endpoints

9. **Dashboard & Analytics** (~300 lines)
   - Metrics, business insights, revenue distribution
   - 3 endpoints

10. **Service Type Groups** (~200 lines)
    - CRUD operations for service type groups
    - 5 endpoints

11. **Follow-Up Messages** (~400 lines)
    - CRUD operations for follow-up messages
    - 5 endpoints

12. **Message Previews** (~500 lines)
    - Reminder, cancellation, appointment, follow-up previews
    - 4 endpoints

13. **Miscellaneous** (~300 lines)
    - LIFF token regeneration, chat test, receipt preview
    - 3 endpoints

## Refactoring Strategy

### Principles

1. **Domain-Driven Separation**: Split by business domain, not technical layer
2. **Incremental Migration**: Each phase is independently testable and deployable
3. **Backward Compatibility**: Maintain existing API contracts during migration
4. **Test Cache Optimization**: Smaller files = better pytest-testmon cache efficiency
5. **Shared Code Extraction**: Move common utilities to shared modules

### Target Structure

```
api/
├── clinic/
│   ├── __init__.py          # Re-exports for backward compatibility
│   ├── members.py           # Member management (~400 lines)
│   ├── settings.py          # Clinic settings (~1,200 lines)
│   ├── patients.py          # Patient management (~500 lines)
│   ├── appointments.py      # Appointment CRUD (~1,500 lines)
│   ├── practitioners.py    # Practitioner management (~2,000 lines)
│   ├── availability.py      # Availability & calendar (~1,500 lines)
│   ├── resources.py         # Resource management (~1,200 lines)
│   ├── line_users.py        # LINE user management (~300 lines)
│   ├── dashboard.py         # Dashboard & analytics (~300 lines)
│   ├── service_groups.py    # Service type groups (~200 lines)
│   ├── follow_ups.py        # Follow-up messages (~400 lines)
│   └── previews.py          # Message previews (~500 lines)
├── clinic.py                # Deprecated (maintains router aggregation)
└── ...
```

## Phased Implementation Plan

### Phase 1: Extract Low-Risk Domains (Week 1) ✅ COMPLETE

**Goal**: Extract domains with minimal dependencies and clear boundaries

**Targets**:
- Service Type Groups (`service_groups.py`)
- Follow-Up Messages (`follow_ups.py`)
- LINE User Management (`line_users.py`)
- Dashboard & Analytics (`dashboard.py`)

**Steps**:
1. Create new module files in `api/clinic/`
2. Move endpoints, models, and helper functions
3. Create router in each module
4. Update `clinic.py` to include sub-routers
5. Run full test suite
6. Update imports in tests (if needed)

**Risk**: Low - these domains are relatively isolated

**Validation**:
- All tests pass
- API contracts unchanged
- pytest-testmon cache shows improved granularity

---

### Phase 2: Extract Patient Management (Week 2) ✅ COMPLETE

**Goal**: Extract patient-related endpoints

**Targets**:
- Patient CRUD operations
- Duplicate checking
- Patient appointment listing

**Steps**:
1. Create `api/clinic/patients.py`
2. Move patient endpoints and related models
3. Extract shared patient validation logic to `utils/`
4. Update router aggregation
5. Run full test suite

**Risk**: Medium - patient endpoints are used by other domains

**Validation**:
- Integration tests for patient operations pass
- Cross-domain dependencies verified

---

### Phase 3: Extract Member Management (Week 2) ✅ COMPLETE

**Goal**: Extract team member management

**Targets**:
- Member listing, invitation, role updates
- Member deletion and reactivation

**Steps**:
1. Create `api/clinic/members.py`
2. Move member endpoints
3. Update router aggregation
4. Run full test suite

**Risk**: Low - member management is self-contained

---

### Phase 4: Extract Settings Management (Week 3) ✅ COMPLETE

**Goal**: Extract clinic settings and appointment type management

**Targets**:
- Get/update clinic settings
- Appointment type validation
- Settings-related models

**Steps**:
1. Create `api/clinic/settings.py`
2. Move settings endpoints and complex update logic
3. Extract shared validation to `utils/`
4. Update router aggregation
5. Run full test suite

**Risk**: High - settings are complex and touch many domains

**Validation**:
- Settings update logic thoroughly tested
- Appointment type validation verified

---

### Phase 5: Extract Availability & Calendar (Week 3-4) ✅ COMPLETE

**Goal**: Extract practitioner availability and calendar functionality

**Targets**:
- Availability schedules, calendar views, slots
- Conflict checking, exceptions
- Calendar models and helpers

**Steps**:
1. Create `api/clinic/availability.py`
2. Move availability endpoints
3. Consider extracting calendar models to `models/calendar.py` if needed
4. Update router aggregation
5. Run full test suite

**Risk**: Medium - availability logic is complex but well-contained

---

### Phase 6: Extract Practitioner Management (Week 4) ✅ COMPLETE

**Goal**: Extract practitioner-related endpoints

**Targets**:
- Practitioner listing, appointment types, settings
- Practitioner status and configuration
- Batch operations

**Steps**:
1. Create `api/clinic/practitioners.py`
2. Move practitioner endpoints
3. Extract shared practitioner logic to `utils/`
4. Update router aggregation
5. Run full test suite

**Risk**: Medium - practitioners are referenced by many domains

---

### Phase 7: Extract Appointment Management (Week 5) ✅ COMPLETE

**Goal**: Extract appointment CRUD and related operations

**Targets**:
- Appointment creation, editing, deletion
- Recurring appointments
- Conflict checking
- Resource allocation

**Steps**:
1. Create `api/clinic/appointments.py`
2. Move appointment endpoints
3. Ensure `AppointmentService` remains in `services/`
4. Update router aggregation
5. Run full test suite

**Risk**: High - appointments are central to the system

**Validation**:
- All appointment integration tests pass
- Recurring appointment logic verified
- Resource allocation tested

---

### Phase 8: Extract Resource Management (Week 5) ✅ COMPLETE

**Goal**: Extract resource-related endpoints

**Targets**:
- Resource types, resources, requirements
- Resource allocations

**Steps**:
1. Create `api/clinic/resources.py`
2. Move resource endpoints
3. Update router aggregation
4. Run full test suite

**Risk**: Medium - resources are used by appointments

---

### Phase 9: Extract Message Previews (Week 6) ✅ COMPLETE

**Goal**: Extract message preview functionality

**Targets**:
- Reminder, cancellation, appointment, follow-up previews
- Receipt preview

**Steps**:
1. Create `api/clinic/previews.py`
2. Move preview endpoints
3. Update router aggregation
4. Run full test suite

**Risk**: Low - previews are read-only operations

---

### Phase 10: Cleanup & Optimization (Week 6)

**Goal**: Final cleanup and optimization

**Tasks**:
1. Remove deprecated `clinic.py` (or keep as thin router aggregator)
2. Update all imports across codebase
3. Extract shared utilities to `api/clinic/utils.py` or `utils/`
4. Consolidate duplicate code
5. Update documentation
6. Final test suite run

**Risk**: Low - mostly cleanup

---

## Additional Refactoring Opportunities

### Service Layer

While not in scope for this plan, consider future refactoring:

1. **appointment_service.py** (2,254 lines)
   - Could be split into: creation, editing, deletion, recurring, conflicts
   - Target: ~400-500 lines per module

2. **availability_service.py** (1,790 lines)
   - Could be split into: schedules, calendar, conflicts, exceptions
   - Target: ~400-500 lines per module

3. **liff.py** (1,813 lines)
   - Could be split by domain: patients, appointments, availability
   - Target: ~600 lines per module

### Shared Utilities

Extract common patterns:
- Request/response model validation
- Permission checking helpers
- Error handling patterns
- Database query helpers

## Migration Strategy

### Backward Compatibility

1. **Router Aggregation**: Keep `clinic.py` as a thin router aggregator initially:
   ```python
   from api.clinic.members import router as members_router
   from api.clinic.patients import router as patients_router
   # ... etc
   
   router = APIRouter()
   router.include_router(members_router, prefix="/members", tags=["members"])
   router.include_router(patients_router, prefix="/patients", tags=["patients"])
   # ... etc
   ```

2. **Import Aliases**: Use `__init__.py` to maintain import compatibility:
   ```python
   # api/clinic/__init__.py
   from api.clinic.members import router as members_router
   from api.clinic.patients import router as patients_router
   ```

3. **Gradual Migration**: Update imports incrementally, starting with tests

### Testing Strategy

1. **Before Each Phase**:
   - Run full test suite to establish baseline
   - Document any flaky tests

2. **During Each Phase**:
   - Run tests after each file extraction
   - Verify pytest-testmon cache behavior

3. **After Each Phase**:
   - Full integration test run
   - API contract verification
   - Performance regression check

## Success Metrics

1. **File Size**: No file > 2,000 lines (target: < 1,500 lines)
2. **Test Cache**: pytest-testmon shows improved cache hit rates
3. **Code Organization**: Related endpoints grouped together
4. **Maintainability**: New features easier to locate and modify
5. **Test Coverage**: Maintain or improve current coverage

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|-------------|
| Breaking API contracts | High | Comprehensive integration tests, backward compatibility layer |
| Circular imports | Medium | Careful dependency management, shared utilities in `utils/` |
| Test failures | Medium | Incremental migration, run tests after each change |
| Performance regression | Low | Monitor during migration, optimize if needed |
| Developer confusion | Low | Clear documentation, gradual migration |

## Timeline Estimate

- **Total Duration**: 6 weeks
- **Per Phase**: 3-5 days (extraction + testing)
- **Buffer**: 1 week for unexpected issues

## Questions & Decisions Needed

1. **Router Aggregation**: Keep `clinic.py` as aggregator or fully remove?
   - **Recommendation**: Keep as thin aggregator for backward compatibility

2. **Shared Models**: Where to place shared Pydantic models?
   - **Recommendation**: `api/clinic/models.py` or keep in respective modules

3. **Service Layer**: Refactor services in parallel or after API refactoring?
   - **Recommendation**: After API refactoring (separate effort)

4. **Import Strategy**: Update all imports immediately or gradually?
   - **Recommendation**: Gradually, starting with tests

## Next Steps

1. Review and approve this plan
2. Set up branch for Phase 1
3. Begin extraction of low-risk domains
4. Establish testing baseline
5. Document any deviations from plan


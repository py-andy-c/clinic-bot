# Test Failure Analysis - Multi-Clinic Query Updates

## Summary
After updating all database queries to use `UserClinicAssociation` for clinic isolation, **27 tests are failing** out of 299 total tests (272 passing). All failures follow the same root cause pattern.

## Root Cause

### Primary Issue: Missing `UserClinicAssociation` Records in Test Fixtures

The updated queries now require `UserClinicAssociation` records to find users within a clinic. However, many tests are still creating `User` objects directly with `clinic_id` and `roles` (deprecated fields), without creating the corresponding `UserClinicAssociation` records.

### Affected Query Patterns

1. **`get_practitioners_for_appointment_type`** (availability_service.py)
   - Now joins with `UserClinicAssociation`
   - Returns empty list if no associations exist
   - Causes: "無可用治療師" (No available practitioners) error

2. **Member listing queries** (clinic.py)
   - Now joins with `UserClinicAssociation` to list members
   - Returns empty list if no associations exist
   - Causes: Admin protection tests to fail (can't find admin users)

3. **Practitioner queries** (practitioner_service.py)
   - Now joins with `UserClinicAssociation`
   - Returns empty results if no associations exist

## Test Failure Categories

### Category 1: Appointment Service Tests (8 failures)
**Files:**
- `tests/unit/test_appointment_service.py` (3 failures)
- `tests/integration/test_appointment_service_integration.py` (5 failures)

**Pattern:**
```python
# Current test code (BROKEN):
practitioner = User(
    clinic_id=clinic.id,
    email="practitioner@test.com",
    roles=["practitioner"]
)
db_session.add(practitioner)
# Missing: UserClinicAssociation creation

# Result: get_practitioners_for_appointment_type() returns []
# Error: "無可用治療師" (No available practitioners)
```

**Affected Tests:**
- `test_practitioner_assignment_load_balancing`
- `test_create_appointment_with_specific_practitioner`
- `test_create_appointment_uses_taiwan_timezone`
- `test_load_balancing_assigns_least_loaded_practitioner`
- `test_appointment_booking_constraint_prevents_double_booking`
- `test_appointment_booking_allows_different_practitioners_same_time`
- `test_appointment_booking_allows_same_practitioner_different_times`
- `test_appointment_booking_allows_same_practitioner_different_days`

### Category 2: Clinic Management Tests (7 failures)
**File:** `tests/integration/test_clinic_management_additional.py`

**Pattern:**
```python
# Current test code (BROKEN):
admin = User(
    clinic_id=c.id,
    roles=["admin"],
    ...
)
pract = User(
    clinic_id=c.id,
    roles=["practitioner"],
    ...
)
# Missing: UserClinicAssociation creation

# Result: Member listing queries return empty
# Error: Admin protection logic can't find admin users
```

**Affected Tests:**
- `test_cannot_remove_last_admin`
- `test_cannot_self_demote_if_last_admin`
- `test_cannot_delete_appointment_type_with_practitioner_references`
- `test_deletion_prevention_with_multiple_practitioners`
- `test_deletion_prevention_with_mixed_types`
- `test_validate_deletion_blocks_when_practitioners_reference_type`
- `test_validate_deletion_with_multiple_types`

### Category 3: LIFF Integration Tests (11 failures)
**File:** `tests/integration/test_liff_integration.py`

**Pattern:**
```python
# Current test code (BROKEN):
practitioner = User(
    clinic_id=clinic.id,
    email="practitioner@liffclinic.com",
    roles=["practitioner"]
)
# Missing: UserClinicAssociation creation

# Result: get_practitioners_for_appointment_type() returns []
# Error: "無可用治療師" (No available practitioners)
```

**Affected Tests:**
- `test_appointment_creation_database_operations`
- `test_first_time_user_complete_flow`
- `test_returning_user_books_for_different_patients`
- `test_user_views_appointment_history`
- `test_user_cancels_appointment`
- `test_availability_shows_correct_slots`
- `test_booking_creates_correct_database_records`
- `test_practitioner_assignment_without_specification`
- `test_double_booking_prevention`
- `test_same_day_disallowed_allows_tomorrow_availability`
- `test_minimum_hours_required_filters_availability`

### Category 4: Auth Integration Test (1 failure)
**File:** `tests/integration/test_auth_integration.py`

**Test:** `test_system_admin_api_access`

**Potential Issue:**
- System admin handling might need review
- May be related to how `UserContext` is constructed for system admins
- Or could be a side effect of other query changes

## Solution Pattern

All failing tests need to be updated to use the helper function from `conftest.py`:

### Before (Broken):
```python
practitioner = User(
    clinic_id=clinic.id,
    email="practitioner@test.com",
    roles=["practitioner"]
)
db_session.add(practitioner)
db_session.commit()
```

### After (Fixed):
```python
from tests.conftest import create_user_with_clinic_association

practitioner, association = create_user_with_clinic_association(
    db_session,
    clinic=clinic,
    email="practitioner@test.com",
    roles=["practitioner"],
    full_name="Dr. Practitioner"
)
```

## Helper Function Available

The `conftest.py` already has the helper function:
- `create_user_with_clinic_association(db_session, clinic, email, roles, full_name, ...)`
- Creates both `User` and `UserClinicAssociation` records
- Returns both objects

## Impact Assessment

### Severity: **Medium**
- All failures are due to test fixture updates, not production code bugs
- The query updates are working correctly - they're enforcing clinic isolation
- Tests just need to be updated to match the new schema requirements

### Risk: **Low**
- No production code changes needed
- Only test fixture updates required
- All 272 passing tests confirm the core functionality works

## Next Steps

1. Update all test fixtures to use `create_user_with_clinic_association`
2. Replace direct `User()` creation with the helper function
3. Ensure `UserClinicAssociation` records are created for all clinic users
4. Verify system admin tests handle the new authentication flow correctly

## Files Requiring Updates

1. `backend/tests/unit/test_appointment_service.py` - 3 test methods
2. `backend/tests/integration/test_appointment_service_integration.py` - 5 test methods
3. `backend/tests/integration/test_clinic_management_additional.py` - 7 test methods
4. `backend/tests/integration/test_liff_integration.py` - 11 test methods
5. `backend/tests/integration/test_auth_integration.py` - 1 test method

Total: **27 test methods** across **5 test files**


# PR Description: Fix Availability Overlap Logic for All-Day Events

## Summary
This PR fixes a critical bug in the availability scheduling logic where "All-Day" calendar events (represented by `NULL` start and end times) were being ignored by the conflict detection system. This allowed appointments to be mistakenly assigned to practitioners during their "Off-days."

## Background
- **Issue**: A practitioner was assigned an appointment despite having an "Off-day" exception created hours prior.
- **Root Cause**: The `AvailabilityService` used truthiness checks (`if event.start_time:`) which failed for:
    1. **Midnight (00:00:00)**: Evaluates to `False` in Python.
    2. **All-Day Events**: `start_time` and `end_time` are `None`, causing the entire conflict check to be skipped.

## Changes

### 1. Core Logic Refactoring & Consolidation
- **File**: [availability_service.py](file:///Users/andy/clinic-bot/backend/src/services/availability_service.py)
- **Action**: Consolidated fragmented overlap checks into a centralized, public `check_time_overlap` utility and an internal `_is_event_overlapping` helper.
- **Logic Improvement**: 
    - **All-Day Event Handling**: Correctly identifies events with `NULL` times as conflicts (safety-first approach).
    - **Explicit Null Checks**: Uses `is not None` instead of truthiness to correctly handle midnight (`00:00:00`) slots.
    - **Logic Reusability**: The API layer in `availability.py` now reuses the service's utility method, eliminating code duplication.

### 2. Performance Optimization (N+1 Fix)
- **File**: [availability_service.py](file:///Users/andy/clinic-bot/backend/src/services/availability_service.py)
- **Action**: Implemented `fetch_practitioner_schedule_data_batch` to fetch default intervals and calendar events for multiple dates in a single database operation.
- **Impact**: Refactored `get_batch_available_slots_for_practitioner` to use this batch fetcher. This reduces the number of database queries from `2 * N` to a constant number, significantly improving performance for monthly availability views.

### 3. Test Infrastructure & Coverage
- **File**: [conftest.py](file:///Users/andy/clinic-bot/backend/tests/conftest.py)
- **Action**: Updated Alembic configuration to use absolute paths, ensuring robust test database initialization.
- **File**: [test_availability_service.py](file:///Users/andy/clinic-bot/backend/tests/unit/test_availability_service.py)
- **Action**: 
    - Added `test_all_day_event_overlap` to cover the regression path.
    - Added `test_partial_all_day_event_is_handled_as_conflict` for malformed data safety.
    - Updated existing tests to align with the new "safety-first" conflict logic.

## Verification Results
- Ran full backend test suite: `./run_backend_tests.sh`
- **Result**: All tests PASSED (including 178 integration and unit tests).
- **Type Safety**: Pyright static analysis passed with zero errors.

## Quality Assurance
- Removed redundant `@staticmethod` decorators.
- Verified timezone handling remains consistent (Taiwan time).
- Cleaned up temporary investigation logs and scripts.

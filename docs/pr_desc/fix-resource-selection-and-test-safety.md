# PR Description: Fix Resource Selection Warnings and Harden Test Suite Safety

## Overview

This PR addresses internal logic issues in resource availability checking and implements critical safety hardening for the backend development environment.

## Key Changes

### 1. Resource Selection Logic Fix

**Problem**: The appointment modal intermittently failed to display warnings (e.g., "Requires 1, Selected 0") when a required resource wasn't manually selected, provided the clinic had at least one free resource of that type in its global inventory. This was due to the backend using a "Global Capacity Check" intended only for patient self-booking.

**Solution**:

* Modified `ResourceService.check_resource_availability` to differentiate between two validation modes:
  * **Selection Mode**: Triggered when `selected_resource_ids` is provided (even if `[]`). Validates that the *specified selection* meets the appointment type requirements.
  * **Slot Availability Mode**: Triggered when `selected_resource_ids` is `None` (patient booking). Validates if the clinic has *any* remaining capacity for that slot.
* This ensures that staff see a warning in the modal if they forget to assign a required resource, regardless of clinic-wide availability.

### 2. Test Suite Safety Hardening

**Problem**: The test suite had an "Emergency Override" (`ALLOW_DANGEROUS_TEST_CLEANUP`) which, if misconfigured by an agent or developer, could lead to accidental deletion of the local development database schema.

**Solution**:

* Removed the `ALLOW_DANGEROUS_TEST_CLEANUP` environment variable check from `backend/tests/conftest.py`.
* Enforced an absolute block on `Base.metadata.drop_all()` and manual `DROP CASCADE` operations if the database URL does not contain the mandatory `test` keyword.
* This provides an immutable safety guard against schema loss in development and production environments.

## Files Modified

* `backend/src/services/resource_service.py`: Core logic update for validation modes.
* `backend/tests/conftest.py`: Removal of dangerous override and reinforcement of safety guards.
* `backend/tests/unit/test_resource_service.py`: Added unit tests for explicit empty selection warnings and global capacity checks.

## Testing Performed

* Ran full backend test suite: **Passed**.
* Verified regression tests for resource selection:
  * `test_check_resource_availability_empty_selection_warning`: **Passed**.
  * `test_check_resource_availability_none_selection_global_check`: **Passed**.
* Manually verified the safety block by attempting to run tests against the `clinic_bot` database: **Successfully Blocked**.

## Incident Notes

During development, a configuration error led to an accidental schema wipe of the `clinic_bot` database. The schema has been successfully restored, and the safety changes in this PR prevent this failure mode from occurring again.

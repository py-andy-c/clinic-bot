# PR Description: Implement Automatic Resource Allocation for Patient Bookings

## Problem Statement

Previously, the system had two critical issues with resource management:

1. **Missing Auto-Allocation**: The system only performed global capacity checks during patient bookings from the LIFF interface but did not actually link specific resource instances (e.g., specific treatment rooms) to the resulting appointments. This forced clinic staff to manually assign resources later and created a risk of manual overbooking since the resources weren't technically "blocked" in the database allocations table.

2. **Rescheduling Double-Booking Bug**: When patients rescheduled appointments, the system would fetch their existing resource allocation and force it onto the new time slot, bypassing availability checks. This could cause double-booking if that resource was already occupied at the new time.

## Solution

Implemented automatic resource allocation logic with explicit handling for patient vs. admin actions:

### 1. Auto-Allocation for New Bookings

* **Auto-Allocation Logic**: When an appointment is created or updated without explicit resource selection (`selected_resource_ids=None`), the system now automatically identifies and links the required resources based on the appointment type's requirements.
* **Strict Availability Enforcement**: In auto-allocation mode, the system now performs a final availability check during the allocation process. If a race condition occurs and resources are no longer available, it raises a `ValueError`, failing the appointment creation to prevent overbooking.
* **Removed Graceful Degradation**: Removed the `try/except` blocks that previously allowed appointments to be created without resource allocations if an error occurred. This ensures that resource requirements are strictly met for all appointments.

### 2. Fixed Rescheduling Double-Booking Bug

* **Patient Rescheduling (`apply_booking_constraints=True`)**: When `selected_resource_ids=None`, the system now triggers **Auto-Allocation Mode** instead of preserving the existing resource. This ensures that:
  * The system finds *any* available resource at the new time.
  * It prevents forcing a potentially busy resource onto the new slot.
  * Failures are explicit (ValueError) rather than silently creating conflicts.
* **Admin Rescheduling (`apply_booking_constraints=False`)**: When `selected_resource_ids=None`, the system preserves the existing resources (Manual Mode), allowing admin overrides when needed.

This distinction ensures **data integrity and safety for patient-facing actions** while maintaining **flexibility for administrative operations**.

## Changes

### Backend

* **`src/services/resource_service.py`**:
  * Updated `allocate_resources` to support an "Auto Mode" that finds and links available resources.
  * Added logic to find resources that are not yet allocated in the requested time slot.
  * Implemented strict quantity validation with `ValueError` raising for insufficient resources.
* **`src/services/appointment_service.py`**:
  * Removed `try/except` blocks around `ResourceService.allocate_resources` in both `create_appointment` and `update_appointment` to ensure strict enforcement.
  * **Critical Fix**: Modified `update_appointment` to conditionally preserve existing resources based on `apply_booking_constraints`:
    * **Patient Mode** (`constraints=True`): Passes `None` to trigger auto-allocation (safe, prevents double-booking).
    * **Admin Mode** (`constraints=False`): Fetches and preserves existing resources (allows overrides).
  * Added clear comments explaining this behavior distinction.
* **`tests/unit/test_resource_service.py`**:
  * Updated tests to verify the new auto-allocation behavior.
  * Added `test_allocate_resources_auto_allocate` to verify successful auto-allocation.
  * Added `test_allocate_resources_auto_allocate_failure` to verify strict enforcement when resources are unavailable.
* **`tests/integration/test_resource_allocation.py`**:
  * Updated `test_create_appointment_no_auto_allocation` → `test_create_appointment_auto_allocation` to verify LIFF bookings now correctly result in resource allocations.
  * Added `test_update_appointment_auto_allocation_for_patient_reschedule` to verify the rescheduling fix and mode distinction.

## Testing Performed

* Ran unit tests for `ResourceService` (`test_allocate_resources_auto_allocate`, `test_allocate_resources_auto_allocate_failure`).
* Ran integration tests for `AppointmentService` (`test_create_appointment_auto_allocation`, `test_update_appointment_reallocates_resources`, `test_update_appointment_auto_allocation_for_patient_reschedule`).
* Verified all backend tests pass using `./run_tests.sh` (129 passed).

## Impact

* **Patient Safety**: Patients can no longer accidentally create double-bookings when rescheduling.
* **System Integrity**: All appointments are guaranteed to have valid resource allocations or fail explicitly.
* **Admin Flexibility**: Clinic staff retain the ability to manually override resource assignments when needed.

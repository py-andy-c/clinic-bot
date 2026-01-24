# Design Doc: Shifting Resource Allocation Logic to Frontend

## Overview
Currently, the resource allocation and selection logic is split between the frontend (UI suggestions and manual overrides) and the backend (automatic allocation, validation, and fallback logic). This duality causes unpredictable behavior where the user's manual selection in the frontend can be overridden or "filled in" by the backend's automatic logic.

This document proposes moving the "intelligence" of resource selection entirely to the frontend, making the backend a passive storage layer for resource assignments.

## Current State
1.  **Frontend**:
    *   Fetches requirements for an appointment type.
    *   Auto-suggests resources to meet those requirements.
    *   Allows users to manually add or remove resources (overrides).
    *   Displays warnings for conflicts or unmet requirements.
2.  **Backend (`ResourceService.allocate_resources`)**:
    *   Re-evaluates requirements.
    *   Validates user-provided IDs.
    *   **Auto-allocates** additional resources if the user-provided list is insufficient to meet requirements.
    *   Handles "Additional" (non-required) resources without availability checks.

### The Problem
If a user intentionally selects a conflicting room or chooses not to assign a room for an appointment that "requires" one, the backend's auto-allocation logic triggers. It finds a free room and assigns it, disregarding the user's implicit or explicit intent to leave the requirement unmet or to force a conflict.

## Proposed State
The "Single Source of Truth" for resource selection will be the **Frontend Client**.

1.  **Frontend Responsibility**:
    *   Continue to handle all suggestion logic, requirement checking, and conflict display.
    *   If a requirement is unmet, the frontend shows a warning.
    *   If a conflict exists, the frontend shows a warning.
    *   **The user's final selection (the list of IDs) is sent to the backend as the absolute state.**

2.  **Backend Responsibility**:
    *   The `allocate_resources` function becomes a "dumb" linker.
    *   It only validates that the provided resource IDs:
        *   Exist in the database.
        *   Belong to the correct clinic.
        *   Are not soft-deleted.
    *   **It does NOT auto-allocate missing resources.**
    *   **It does NOT enforce requirement quantities.**

## Detailed Technical Changes

### Backend: `ResourceService.py`
*   **Simplify `allocate_resources`**:
    *   Remove "Phase 1" and "Phase 2" logic.
    *   Remove calls to `_find_available_resources` within the allocation flow.
    *   Iterate through the provided `selected_resource_ids`.
    *   Verify each ID is valid (clinic, active).
    *   Create `AppointmentResourceAllocation` records for all valid IDs provided.
*   **Keep `get_resource_availability_for_slot`**:
    *   This remains necessary for the frontend to know what is available/unavailable to show in the UI.

### Backend: `AppointmentService.py`
*   Ensure that `selected_resource_ids` is passed through consistently.
*   The graceful degradation (continuing if allocation fails) remains to ensure appointment creation isn't blocked by resource errors.

### Frontend: `ResourceSelection.tsx`
*   Ensure that every appointment creation or update request sends the `selected_resource_ids` list.
*   If the user clears all resources, an empty list `[]` should be sent, and the backend should record zero allocations.

## Benefits
1.  **Predictability**: What the user sees in the "Selected Resources" list is exactly what is saved.
2.  **Simplicity**: Significant reduction in backend code complexity.
3.  **Flexibility**: Clinic staff can intentionally bypass system "rules" (e.g., sharing a room) without the backend trying to fix it.
4.  **Performance**: Fewer database queries during appointment creation (no need to search for alternate rooms).

## Considerations & Edge Cases
*   **API Clients**: Any third-party or future automated clients must now be responsible for resource selection if they want resources assigned. The backend will no longer "help" them by picking a room automatically.
*   **Data Integrity**: An appointment can now exist without its "required" resources. This is acceptable as clinic staff are the final authority on operational needs.
*   **Race Conditions**: Two users picking the same room simultaneously. The backend `check_resource_availability` (used for UI display) and `ResourceService.check_resource_availability` (used for pre-save warnings) still correctly identify conflicts. The final save will record the conflict, which is consistent with the "respect user intent" goal.

## Implementation Plan
1.  Identify all code paths in `ResourceService.py` that perform auto-allocation.
2.  Refactor `allocate_resources` to prioritize provided IDs and remove fallback logic.
3.  Update unit tests to reflect that providing no IDs results in no allocations.
4.  Conduct UI testing to confirm that manual overrides are preserved after saving.

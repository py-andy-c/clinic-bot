# PR Description: Fix Resource Selection Auto-Selection and Propagation

## Summary
This PR addresses several issues in the resource selection logic within the clinic admin platform, specifically focusing on the "資源選擇" (Resource Selection) section in appointment modals.

## Key Changes

### 1. Fix Auto-Selection Race Condition
- **Component**: `ResourceSelection.tsx`
- **Issue**: Intermediate re-renders (e.g., triggered by practitioner list loading) would sabotage the internal debounce timer, causing the auto-selection logic to skip the final successful fetch result.
- **Fix**: Replaced the simple "last seen" time slot reference with a `lastAutoSelectedSlotRef` that only updates **after** auto-selection logic has successfully executed. This ensures that even if parent components re-render during the 300ms debounce window, the auto-selection will still fire once the data is ready.

### 2. Selection Propagation for Recurring Appointments
- **Component**: `CreateAppointmentModal.tsx`
- **Change**: When moving from the initial appointment form to the conflict resolution page, the current resource selection is now propagated to every generated recurring occurrence.
- **Benefit**: Users no longer have to re-select common resources (like rooms) for every single week in a recurring series.

### 3. Smart Validation of Propagated Resources
- **Component**: `ResourceSelection.tsx`
- **Logic**: Refined the initialization to allow validation of propagated IDs. The component now treats initial selections as "preferred" but will still check them against actual availability for each specific date.
- **Smart Replacement**: If a propagated resource is unavailable for a future week, the system will automatically find and select a replacement of the same resource type, providing a seamless "auto-repairing" selection experience.

## Verification
- Verified that selecting an appointment type now correctly triggers auto-selection even with practitioner loading delays.
- Verified that recurring appointments correctly inherit the initial resource selection.
- Verified that unavailable resources in future recurring weeks are automatically replaced by other available resources of the same type.


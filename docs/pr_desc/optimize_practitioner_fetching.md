# PR Description: Optimize Practitioner Fetching and Silence Cancellation Errors

## Overview
This PR addresses noisy "canceled" API errors in the console and optimizes practitioner fetching in the Appointment Form. These issues were primarily observed during component mounting in development (React Strict Mode) and when switching between appointment types.

## Changes

### 1. Silence Noise from Canceled API Requests
- Updated `ApiService.getPractitioners` in `frontend/src/services/api.ts` to recognize `axios.isCancel(error)`.
- Cancellation errors (often caused by component unmounting or React Strict Mode double-mounting) are now re-thrown without being logged as errors.
- This cleans up the browser console from misleading "failed to fetch practitioners" logs when the UI is functioning correctly.

### 2. Optimize Practitioner Fetching via Local Filtering
- Updated `useAppointmentForm` hook in `frontend/src/hooks/useAppointmentForm.ts` to favor local filtering over redundant API calls.
- **Logic**: Since the practitioner list provided to the hook already contains `offered_types`, we can filter the available practitioners for a specific appointment type entirely on the client side.
- **Benefit**: 
  - Eliminated unnecessary API calls to `/clinic/practitioners?appointment_type_id=...` every time the appointment type is changed or the modal is opened.
  - Faster UI response as practitioner lists are updated instantly without network latency.
- Added type safety for `offered_types` in `UseAppointmentFormProps` and implementation.

## Impact
- **Developer Experience**: Cleaner console without "canceled" network error logs.
- **Performance**: Reduced network traffic and faster practitioner switching in the appointment creation/edit modals.
- **Reliability**: Maintained fallback to API fetching if local data is incomplete.

## Verifying
1. Open the Create Appointment modal.
2. Change the appointment type.
3. Observe that no new API calls are made to fetch practitioners (check Network tab).
4. Verify the console no longer shows "Failed to fetch practitioners {message: 'canceled'}" errors during modal operations.

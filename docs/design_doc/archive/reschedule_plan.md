# Reschedule Appointment Plan

## Goal Description
Allow patients to reschedule appointments on the LIFF app from the Appointment Management (預約管理) page.
Patients can change the time and practitioner, but not the patient or appointment type.
The feature must adhere to cancellation restrictions and send appropriate notifications.

## User Review Required
- **Breaking Changes**: None.
- **Design Decisions**:
    - Reusing existing `AppointmentFlow` components (`Step2SelectPractitioner`, `Step3SelectDateTime`, `Step5AddNotes`) where possible, or creating a wrapper `RescheduleFlow`.
    - "No specific practitioner" (不指定) option will be available.
    - `minimum_cancellation_hours_before` will be checked against the *current* appointment start time before allowing reschedule.

## Proposed Changes

### Backend

#### [MODIFY] [appointment_service.py](file:///Users/andy/clinic-bot2/backend/src/services/appointment_service.py)
- Add `reschedule_appointment` method in `AppointmentService`.
    - Input: `appointment_id`, `new_practitioner_id` (optional), `new_start_time`, `new_notes`, `line_user_id` (for validation).
    - Logic:
        1. Validate appointment exists and belongs to patient (via `line_user_id`).
        2. Check `minimum_cancellation_hours_before` for the *current* appointment time.
        3. **[NEW]** Check `min_booking_hours_before` (or similar booking window settings) for the *new* appointment time.
        4. Validate new practitioner and time availability (reuse `check_appointment_edit_conflicts`).
        5. **[NEW]** Ensure concurrency safety (e.g., use transactions/locking or handle race conditions).
        6. Update appointment details.
        7. Send notifications:
            - Patient: Edit notification.
            - Practitioner(s): Reassignment notification (notify both old and new if changed).

#### [MODIFY] [liff.py](file:///Users/andy/clinic-bot2/backend/src/api/liff.py)
- Add `POST /liff/appointments/{appointment_id}/reschedule` endpoint.
    - Request body: `RescheduleRequest` (new schema).
    - Calls `AppointmentService.reschedule_appointment`.

#### [NEW] [schemas/liff.py](file:///Users/andy/clinic-bot2/backend/src/schemas/liff.py)
- Create/Update schemas if needed (e.g., `RescheduleAppointmentRequest`).

### Frontend

#### [MODIFY] [AppointmentCard.tsx](file:///Users/andy/clinic-bot2/frontend/src/liff/query/AppointmentCard.tsx)
- Add "Reschedule" (改期) button next to "Cancel" button.
- Only show if appointment is `confirmed`.

#### [MODIFY] [AppointmentList.tsx](file:///Users/andy/clinic-bot2/frontend/src/liff/query/AppointmentList.tsx)
- Handle "Reschedule" click.
- Navigate to reschedule flow (e.g., `/book?mode=reschedule&appointmentId=...`).

#### [NEW] [RescheduleFlow.tsx](file:///Users/andy/clinic-bot2/frontend/src/liff/appointment/RescheduleFlow.tsx)
- A new flow component similar to `AppointmentFlow` but tailored for rescheduling.
- Initialize state with existing appointment details.
- Steps:
    1. **Select Practitioner**: Reuse `Step2SelectPractitioner`. Pre-select current. Allow "No specific".
    2. **Select Date & Time**: Reuse `Step3SelectDateTime`.
        - **[NEW]** Ensure slots violating booking notice are disabled.
        - **[NEW]** Optionally indicate current slot.
    3. **Edit Notes**: Reuse `Step5AddNotes`. Pre-fill existing notes.
    4. **Confirmation**: New `RescheduleConfirmation` step.
        - **[NEW]** Show "Old Time" vs "New Time" comparison.
    5. **Success**: New `RescheduleSuccess` step.
- **[NEW]** Add "Cancel/Back" button to easily abort rescheduling.

#### [MODIFY] [appointmentStore.ts](file:///Users/andy/clinic-bot2/frontend/src/stores/appointmentStore.ts)
- Add actions/state for rescheduling (e.g., `setRescheduleMode`, `loadAppointmentForReschedule`).

#### [MODIFY] [liffApi.ts](file:///Users/andy/clinic-bot2/frontend/src/services/liffApi.ts)
- Add `rescheduleAppointment` method.

## Verification Plan

### Automated Tests
- Backend: Unit tests for `reschedule_appointment` service method (success, cancellation restriction, conflict).
- Backend: API tests for the new endpoint.

### Manual Verification
1. **Pre-requisite**: Create a test appointment.
2. **Restriction Check**: Try to reschedule an appointment that is within the restricted cancellation window (e.g., 24h). Verify error message.
3. **Flow Check**:
    - Click "Reschedule".
    - Verify current practitioner and notes are pre-filled.
    - Change practitioner to "No specific" or another one.
    - Change time.
    - Update notes.
    - Confirm.
4. **Post-condition**:
    - Verify appointment details are updated in "Appointment Management".
    - Verify LINE notifications received by patient.
    - Verify LINE notifications received by practitioner(s).

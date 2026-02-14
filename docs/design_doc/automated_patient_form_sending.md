# Design Doc: Automated Patient Form Sending

## Context & Problem Statement

Currently, clinics can send medical record forms (patient forms) to patients manually via the "發送病患表單" flow. However, this process cannot be automated based on the type of appointment. Clinics often need to send specific forms before an appointment (e.g., intake forms, consent forms) or after an appointment (e.g., satisfaction surveys, follow-up forms).

We need a system that allows clinics to configure automated patient form sending for each appointment type, similar to the existing follow-up message system, but with support for "before" appointment timing and specific handling for late-booked appointments.

## Requirements

1. **Automated Configuration per Appointment Type**: Allow multiple form-sending configurations for each appointment type.
2. **Timing Modes**:
   * **Before Appointment**: Support sending forms X hours before the **start time**, or at a specific time on days before the appointment date.
   * **After Appointment**: Similar to follow-up messages (hours after **end time**, or specific time on days after date).
3. **Appointment Association**: Automatically link the created medical record to the appointment.
4. **Template-Level Messaging**: Use the `message_template` and placeholders (`{病患姓名}`, `{模板名稱}`, `{診所名稱}`) already configured in the `MedicalRecordTemplate`. The automation configuration does NOT override the message.
5. **Edge Case Handling (Late Bookings)**: If a form is scheduled "before" the appointment but the appointment is created too late (making the timing impossible):
   * `send_immediately`: Send the form as soon as the appointment is created/confirmed.
   * `skip`: Do not send the form.
6. **Re-scheduling/Cancellation**: If an appointment is rescheduled or canceled, the scheduled forms should be updated or canceled accordingly.
7. **Atomicity & Reliability**: Ensure that patients do not receive broken links if a database transaction fails, and avoid duplicate record creation during retries.

## Proposed Solution

### 1. Database Changes

#### New Table: `appointment_type_patient_form_configs`

This table stores the automation settings.

| Field | Type | Description |
|-------|------|-------------|
| `id` | Integer | Primary Key |
| `appointment_type_id` | Integer | FK to `appointment_types.id` |
| `clinic_id` | Integer | FK to `clinics.id` |
| `medical_record_template_id` | Integer | FK to `medical_record_templates.id` |
| `timing_type` | String(20) | 'before' or 'after' |
| `timing_mode` | String(20) | 'hours' or 'specific\_time' |
| `hours` | Integer (null) | X hours before start / after end |
| `days` | Integer (null) | Y days before / after date |
| `time_of_day` | Time (null) | Z time of day |
| `on_impossible` | String(20) | 'send\_immediately' or 'skip' (only relevant for 'before') |
| `is_enabled` | Boolean | Whether this automation is active |
| `display_order` | Integer | Sorting order for display and processing |
| `created_at` | Timestamp | |
| `updated_at` | Timestamp | |

### 2. Implementation Strategy

#### A. Modeling & Utils

* Update `AppointmentType` model with a relationship to `AppointmentTypePatientFormConfig`.
* **Refactor Timing Logic**: Extract shared timing calculation logic from `FollowUpMessageService` into a utility that can be used by both follow-ups and patient forms.
* **Validation**: Add API-level validation to ensure only templates with `is_patient_form=True` can be configured.

#### B. Scheduling Logic

* Create `PatientFormSchedulerService`.
  * `schedule_patient_forms`: Called when an appointment is confirmed/rescheduled.
  * **Late Booking Logic**: If `timing_type == 'before'` and `scheduled_time < now`:
    * If `appointment_start_time < now` (e.g., recorded a past walk-in), **skip** sending even if `on_impossible == 'send_immediately'`.
    * Otherwise, follow the `on_impossible` setting.
  * This service creates `ScheduledLineMessage` entries with `message_type='patient_form'`.

#### C. Processing Scheduled Messages (Atomicity & Reliability)

Modify `ScheduledMessageService` to handle `message_type == 'patient_form'`:

1. **De-duplication Check**: Before creating a `MedicalRecord`, check if one already exists for this `appointment_id` and `template_id`.
2. **Commit First**: Create and commit the `MedicalRecord` **before** attempting to send the LINE message.
   * This ensures the LIFF link will never be broken.
   * If the LINE send fails, the background worker will retry the task, skip record creation (due to the de-duplication check), and re-attempt the send.
3. **Context Linkage**: After a successful send, update `ScheduledLineMessage.message_context` with the `medical_record_id` for the audit trail.
4. **Auto-assigned Appointments**: Always send patient forms even if the appointment is auto-assigned (practitioner unspecified).

#### D. API Layer

* `src/api/clinic/patient_form_configs.py`: CRUD endpoints for the automation configs.
* Ensure the frontend defaults `on_impossible` to `send_immediately`.

### 3. Reusing Code

* **Infrastructure**: Reuse `ScheduledLineMessage` background processing and retry logic.
* **Refactoring**: Extract shared rendering and LIFF generation logic from `MedicalRecordService.send_patient_form` into reusable methods.

## Detailed Plan

### Phase 1: Models & Shared Utilities ✅ COMPLETED

1. ✅ Created migration for `appointment_type_patient_form_configs`.
2. ✅ Implemented `AppointmentTypePatientFormConfig` model.
3. ✅ Refactored timing calculation logic into a shared utility (`timing_utils.py`).
4. ✅ Updated `FollowUpMessageService` to use the shared timing utility.
5. ✅ Added comprehensive unit tests for timing utilities and model.

**Implementation Notes:**
- Migration `202602140000_add_appointment_type_patient_form_configs.py` merges two migration heads and includes idempotency check
- Model includes all required fields with proper constraints and relationships
- Shared `timing_utils.py` supports both 'before' and 'after' timing with 'hours' and 'specific_time' modes
- Backward compatibility maintained through `calculate_follow_up_scheduled_time()` wrapper
- All 22 unit tests passing

### Phase 2: Scheduling Service ✅ COMPLETED

1. ✅ Implemented `PatientFormSchedulerService` with three main methods:
   - `schedule_patient_forms()` - schedules forms when appointment is created
   - `cancel_pending_patient_forms()` - cancels forms when appointment is canceled
   - `reschedule_patient_forms()` - reschedules forms when appointment is edited
2. ✅ Integrated with `AppointmentService` for lifecycle events:
   - Added patient form scheduling after appointment creation
   - Added patient form rescheduling when appointment time/type changes
   - Added patient form cancellation when appointment is canceled
3. ✅ Enforced "Skip Past Appointments" logic:
   - Past appointments (recorded walk-ins) always skip sending, even with `send_immediately`
   - Late bookings with `on_impossible='skip'` skip sending
   - Late bookings with `on_impossible='send_immediately'` send within 1 minute
4. ✅ Added comprehensive unit tests (8 tests covering all edge cases)

**Implementation Notes:**
- Service follows same pattern as `FollowUpMessageService` for consistency
- Uses `ScheduledLineMessage` with `message_type='patient_form'`
- Handles late booking edge cases according to design spec
- All error handling prevents appointment operations from failing
- Type safety maintained with proper type casting for Literal types
- All 162 tests passing (154 run + 8 new patient form tests)

### Phase 3: Robust Message Processing

1. Update `ScheduledMessageService` with the "Commit-Before-Send" flow.
2. Implement the de-duplication check and audit trail linkage.

### Phase 4: API & Quality Assurance

1. Implement CRUD endpoints with validation for `is_patient_form`.
2. Add unit and integration tests covering:
   * Timing edge cases (late bookings, past appointments).
   * Retries and de-duplication (ensuring only one record is created).
   * Rescheduling scenarios.

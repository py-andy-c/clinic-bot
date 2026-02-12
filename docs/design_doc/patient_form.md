# Design Doc - Patient Form (病患表單)

## Overview

The "Patient Form" (病患表單) feature allows clinics to send digital forms to patients via Line. Patients can fill in these forms, upload photos, and submit them directly into the clinic's medical record system. This reduces paperwork and streamlines the intake process.

Fundamentally, a patient form is a variant of a **Medical Record Template**. It uses the same field definitions but is marked as "open for patient completion". When sent, it creates a **Medical Record** that can be edited by both the clinic and the patient.

**Terminology Note**: In this codebase, "patient form" refers to medical record templates sent to patients for completion (e.g., intake forms, health questionnaires). This is distinct from the "patient profile form" (`PatientProfileForm` component) which is used for patient registration/profile creation in LIFF (collecting name, phone, birthday, gender).

## Goals

* Allow clinic admins to mark certain medical record templates as patient forms.
* Provide a simple way for clinic staff to send these forms to patients via Line.
* Create a user-friendly patient-facing interface (LIFF) for filling out forms and uploading photos.
* Ensure seamless integration with the existing medical record system.

## Core Concepts

1. **Patient Form (Template)**: A `MedicalRecordTemplate` with `is_patient_form=True`.
2. **Patient Form Record**: A `MedicalRecord` instance created from a patient form template. It tracks whether it was sent to a patient and stays editable by the patient until some completion status is reached (or indefinitely).
3. **Line Integration**: The primary delivery mechanism for the form link.

## Database Changes

### `medical_record_templates` table

* Add column `is_patient_form` (BOOLEAN, default FALSE).

### `medical_records` table

* `patient_last_edited_at` (TIMESTAMP): Tracks when the patient last updated the form.
* `is_submitted` (BOOLEAN, default FALSE): Distinguishes between a draft and a completed form from the patient's perspective.

### `patient_photos` table

* No immediate changes needed, but ensure `uploaded_by_user_id` can be NULL for patient-uploaded photos.

## Implementation Phases

1. **Phase 1**: Backend schema changes and template settings update. ✅ **(Completed)**
   * Added `is_patient_form` to templates.
   * Added `is_submitted` and `patient_last_edited_at` to records.
   * Updated management API and frontend types.
   * Added "Open for patient completion" toggle in template editor.
2. **Phase 2**: Backend "Send Form" endpoint and Line messaging integration. ✅ **(Completed)**
   * Implemented `POST /clinics/{clinic_id}/patients/{patient_id}/medical-records/send-form`.
   * Added `send_patient_form` logic in `MedicalRecordService`.
   * Integrated `LINEService` to send template messages with LIFF buttons.
   * Added comprehensive integration tests.
3. **Phase 3**: Clinic UI - "發送病患表單" button and dialog. ✅ **(Completed)**
   * Implemented `SendPatientFormDialog` with template filtering and appointment selection.
   * Added `sendPatientForm` to `ApiService` and `useSendPatientForm` hook.
   * Integrated "發送病患表單" button in `PatientMedicalRecordsSection`.
   * Added record status indicators ("填寫中", "已提交", "診所建立", "空") to medical record cards with improved priority logic.
   * Added Line link status check to prevent sending forms to unlinked patients.
   * Improved smart default appointment selection logic with interaction tracking.
   * Added comprehensive unit tests for the new dialog and hooks.
   * **Note**: E2E tests for the full flow have been deferred to a follow-up PR (Task #PF-E2E).
   * **Note on API contract**: Transitioned to structured error responses for specific error types to support localized/rich frontend error states.
4. **Phase 4**: Patient UI - LIFF form editor. ✅ **(Completed)**
   * Implemented LIFF-specific API endpoints for medical records and photos.
   * Created `PatientMedicalRecordPage` for LIFF with dynamic form rendering.
   * Implemented photo upload and management within the LIFF form.
   * Added `form` mode to LIFF application routing.
   * Handled form state persistence (Draft/Submitted) and concurrency.
5. **Phase 5**: Testing and Polish. ✅ **(Completed)**
   * Extracted shared validation logic into `src/utils/medicalRecordUtils.ts`.
   * Added comprehensive unit tests for `PatientMedicalRecordPage.tsx` covering error handling (409 conflicts) and validation.
   * Added unit tests for `LiffMedicalRecordPhotoSelector.tsx`.
   * Added tests for `createMedicalRecordDynamicSchema` utility.
   * Addressed TypeScript strict type checking errors by refining `RecordFormData` and schema definitions.
   * Verified all tests pass including backend integration tests.

## API Design

### 1. Management API (Clinic Side)

#### Update Template

* `PATCH /clinics/{clinic_id}/medical-record-templates/{template_id}`
* Include `is_patient_form` in the request body.

#### Send Patient Form

* `POST /clinics/{clinic_id}/patients/{patient_id}/medical-records/send-form`
* **Request Body**:
  ```json
  {
    "template_id": 123,
    "appointment_id": 456, // Optional
    "message_override": "Custom message..." // Optional
  }
  ```
* **Logic**:
  1. Verify patient is linked to a Line user.
  2. Create a `MedicalRecord` with empty values.
  3. Generate a secure link to the LIFF application.
  4. Send a Line message to the patient with the link.
* **Response**: The created `MedicalRecord` object.

### 2. LIFF API (Patient Side)

#### Get Patient Form

* `GET /liff/medical-records/{record_id}`
* **Security**: Validates that the `record_id` belongs to the authenticated `LineUser`.
* **Response**:
  * `template_snapshot`: For rendering the fields.
  * `values`: Current field values.
  * `photos`: Associated photos.

#### Update Patient Form

* `PUT /liff/medical-records/{record_id}`
* **Request Body**:
  ```json
  {
    "values": { "field_1": "value", ... },
    "is_submitted": true
  }
  ```
* **Logic**: Updates the record and records the submission status.
* **Error Handling**: Uses `RECORD_MODIFIED` (409) if the record version indicates it was edited elsewhere.

#### Photo Management

* `POST /liff/patient-photos`: Upload a photo (staged as pending).
* `DELETE /liff/patient-photos/{photo_id}`: Remove an uploaded photo.
* **Security**: Enforces patient ownership of photos and associated records.

## Frontend Design

### 1. Clinic Admin - Template Settings

In `MedicalRecordTemplateEditorModal`:

* Add a checkbox "開放病患填寫" (Open for patient completion) in the "基本資訊" section.
* Add an info icon explaining that this allows the template to be sent to patients via Line.

### 2. Clinic Staff - Patient Detail Page

In `PatientDetailPage`:

* Add a new button "發送病患表單" in the "病歷記錄" tab header or general action area.
* Add `SendPatientFormDialog`:
  * Title: "發送病患表單".
  * Template dropdown: Filters for templates where `is_patient_form === true`.
  * Appointment dropdown: Same as `CreateMedicalRecordDialog`.
  * Button: "確認發送".
* After success, show a success toast and update the medical record list.

### 3. Patient - LIFF Application

New LIFF page for form completion:

* **Route**: `/liff/records/:recordId`
* **Features**:
  * Dynamic form rendering based on `template_snapshot`.
  * Photo upload section (reusing `RecentPhotosRibbon` logic or similar).
  * "儲存" (Save) and "提交" (Submit) buttons.
  * Mobile-responsive design for easy filling on smartphones.

## Patient Identification & Security

Since the form is sent via Line, we can identify the patient through their Line account:

1. The link sent to the patient contains the `record_id`.
2. When the patient opens the link in LIFF, the LIFF app authenticates the `LineUser`.
3. The backend verifies that the `LineUser` is associated with the `Patient` who owns the `MedicalRecord`.
4. This ensures that even if a link is leaked, only the intended patient (or someone with their Line account) can access it.

## Photo Uploads

Patients should be able to upload photos while filling out the form.

* The LIFF page will have a photo upload button.
* Uploaded photos will be associated with the `patient_id`, `clinic_id`, and `medical_record_id`.
* **Staging Behavior**: Photos uploaded within a medical record context are created in a **pending** state (`is_pending=true`). They only become active and visible in general patient galleries once the medical record is successfully saved or submitted. Deleting a photo during the LIFF session removes the record association and soft-deletes the photo.
* Clinic staff will see these photos immediately in the medical record view.

## Security & Privacy

* **Access Control**: Medical records are sensitive. The LIFF API must strictly enforce that a `LineUser` can only access records belonging to their associated `Patient` profiles.
* **No Token Expiry**: There is **no expiration time** for the form link. Once sent, the patient can access and edit the form indefinitely (or until the clinic manually deletes it). This ensures patients can always refer back to or update their information if needed.

## API Error Handling

Starting with Phase 3, the Patient Form related endpoints transition to a **structured error response format**. This allows the frontend to provide specific, localized feedback based on machine-readable error codes.

**Format**:

```json
{
  "detail": {
    "error_code": "CODE_NAME",
    "message": "Human readable message"
  }
}
```

**Common Error Codes**:

* `PATIENT_NOT_LINKED` (400): Patient has no associated `line_user_id`.
* `TEMPLATE_NOT_PATIENT_FORM` (400): Attempted to send a template that is not marked as `is_patient_form`.
* `LIFF_NOT_CONFIGURED` (500): The clinic or system is missing required LIFF settings (e.g., missing `liff_id`).
* `LINE_SEND_FAILED` (500): Technical failure when communicating with Line API.
* `PATIENT_NOT_FOUND` (404)
* `TEMPLATE_NOT_FOUND` (404)
* `CLINIC_NOT_FOUND` (404)
* `LINE_USER_NOT_FOUND` (404)
* `RECORD_MODIFIED` (409): The record has been modified by another user (clinic staff or the patient in another tab). Requires a refresh to newest version.

**Standard**: All new endpoints in the Patient Form module MUST use this structured format. Existing endpoints will be migrated as they are touched for feature updates.

## Medical Record Status Logic

The status badge shown on medical record cards follows a strict priority order to provide the most relevant information to clinic staff:

1. **Submitted (`is_submitted: true`)**: "病患已提交" (Green). High priority. Note: If a record is submitted but has no values (edge case), it is still marked as submitted.
2. **Editing (`patient_last_edited_at: Date`)**: "病患填寫中" (Yellow). Indicates the patient has opened the link but not yet clicked "Submit".
3. **Empty (`values: {}`)**: "空" (Gray). No data has been entered yet (either by clinic or patient).
4. **Clinic Created**: "診所建立" (Blue). The default state for records created and filled by staff.

**Atomicity**: The "Send Form" operation is atomic. If the Line message fails to send or the LIFF URL cannot be generated, the `MedicalRecord` creation is rolled back, ensuring no "orphaned" empty records are created in the database.

## Testing Strategy

### Unit & Integration Tests

* **Backend**: Integration tests in `test_send_patient_form.py` cover all error codes and the success path (Line message mock).
* **Frontend**:
  * `medicalRecordUtils.test.ts`: Comprehensive tests for status priority and default appointment selection.
  * `SendPatientFormDialog.test.tsx`: Tests for template filtering, default selection logic, and error handling.

### E2E Tests (Task #PF-E2E)

A dedicated E2E test suite using Playwright will be implemented in Phase 5 to cover:

1. **Happy Path**: Send form → Patient receives message → LIFF filling → Submission.
2. **Blocking Scenarios**: Prevent sending to unlinked patients.
3. **Smart Defaults**: Verify appointment selection and user-override persistence.
4. **Status Updates**: Real-time updates of status badges in the patient profile.

**Tracking**: Task #PF-E2E is tracked for implementation in Phase 5. Deployment to production will be blocked until these tests are complete to ensure full flow reliability.

## Future Considerations

* **Rate Limiting**: Implement rate limiting on the `send-form` endpoint to prevent accidental or malicious spamming of patients.
* **Audit Logging**: Record an audit entry when a patient form is sent, including the staff member who initiated it and the exact message content.
* **Clinic Edit After Submission**: Handle cases where clinic staff edits a record previously submitted by a patient.

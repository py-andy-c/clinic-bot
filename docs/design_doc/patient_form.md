# Design Doc - Patient Form (病患表單)

## Overview

The "Patient Form" (病患表單) feature allows clinics to send digital forms to patients via Line. Patients can fill in these forms, upload photos, and submit them directly into the clinic's medical record system. This reduces paperwork and streamlines the intake process.

Fundamentally, a patient form is a variant of a **Medical Record Template**. It uses the same field definitions but is marked as "open for patient completion". When sent, it creates a **Medical Record** that can be edited by both the clinic and the patient.

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
* Clinic staff will see these photos immediately in the medical record view.

## Security & Privacy

* **Access Control**: Medical records are sensitive. The LIFF API must strictly enforce that a `LineUser` can only access records belonging to their associated `Patient` profiles.
* **No Token Expiry**: There is **no expiration time** for the form link. Once sent, the patient can access and edit the form indefinitely (or until the clinic manually deletes it). This ensures patients can always refer back to or update their information if needed.

## Implementation Phases

1. **Phase 1**: Backend schema changes and template settings update.
2. **Phase 2**: Backend "Send Form" endpoint and Line messaging integration.
3. **Phase 3**: Clinic UI - "發送病患表單" button and dialog.
4. **Phase 4**: Patient UI - LIFF form editor.
5. **Phase 5**: Testing and Polish.

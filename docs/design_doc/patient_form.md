# Patient Form System - Design Document

## Overview

This document defines the business logic and technical design for a **Patient Form** feature that allows clinics to send customizable forms to patients, which patients can fill out and submit. The submitted forms become medical records, enabling clinics to collect structured information from patients before, or after appointments.

**Key Goals**:

1. Allow clinic admins to create reusable patient form templates (reusing the existing medical record template infrastructure)
2. Allow automatic form sending relative to appointments (similar to follow-up messages)
3. Allow manual form sending from the patient detail page
4. Provide a patient-facing LIFF interface for form completion
5. Treat submitted forms as medical records with the same lifecycle handling

***

## Infrastructure Reuse Summary

This feature heavily reuses existing infrastructure to minimize new code:

| Component | Existing Infrastructure | How We Reuse It |
|-----------|------------------------|-----------------|
| **Templates** | `medical_record_templates` table | Add `template_type` column to filter medical records vs patient forms |
| **Template Fields** | Template field builder UI | Identical component for both template types |
| **Dynamic Forms** | `MedicalRecordDynamicForm` component | Reuse in LIFF for patient form filling |
| **Photo Upload** | `MedicalRecordPhotoSelector`, patient photo API | Same upload/commit flow for patient-uploaded photos |
| **Photo Lifecycle** | `is_pending` flag, S3 GC, soft-delete | Identical lifecycle handling |
| **Medical Records** | `medical_records` table | Patient forms become medical records with `source_type='patient'` |
| **Optimistic Locking** | `version` field on medical records | Same conflict handling for concurrent edits |
| **Message Templates** | `PlaceholderHelper`, preview API | Same placeholder system with `{表單連結}` added |
| **Scheduling** | `scheduled_line_messages` table | Add `patient_form` message type |
| **Scheduling Service** | `FollowUpMessageService` pattern | Mirror the scheduling logic for patient forms |
| **LIFF Auth** | `liff_token` validation | Reuse for patient form access control |
| **LINE Push** | LINE messaging service | Reuse for form delivery and notifications |
| **Admin Notifications** | Existing notification infrastructure | Reuse for form submission notifications |
| **Full-Screen Modal** | `ServiceItemSettingsModal` pattern | Apply to template editor modals |

***

## Design Decisions

### 1. Template Reuse vs. Separation

**Question**: Should patient forms share the same templates as medical records, or have a separate template pool?

**Decision**: **Separate template type with shared infrastructure**.

* Add a `template_type` field to `medical_record_templates` table: `'medical_record'` (default) or `'patient_form'`
* Patient forms and medical records use the same table structure but are filtered by type
* New settings page: "Patient Form Templates" separate from "Medical Record Templates"

**Rationale**: Clinics may want different templates for patient-filled forms vs. practitioner-filled records. Separation prevents confusion while reusing the underlying architecture.

### 2. Photo Upload by Patients

**Question**: Should patients be able to upload photos when filling the form?

**Decision**: **Yes, with per-template configurable limit**.

* Allow photo uploads in patient forms (useful for symptom photos, documents, etc.)
* **Per-template photo limit**: Configurable in template settings (default: 5, max: 20)
* Photos follow the same lifecycle as medical record photos (tied to the record)

**UI Behavior**:

* If `max_photos = 0`: Hide the photo section and upload UI entirely on the patient side
* **Clinic bypass**: Clinic users can bypass the photo limit when editing the medical record.
* **Photo ownership**: Patient-uploaded photos and clinic-uploaded photos coexist on the same record. The patient's upload limit only applies to their *own* upload actions; photos already added by the clinic do not count against the patient's remaining quota for new uploads (i.e. if clinic adds 10 and limit is 5, patient can't add more, but doesn't need to delete clinic photos).
* **Mixed Ownership Implementation**: The system distinguishes between sources using the `uploaded_by_patient_id` field on the `patient_photos` table. If this field is set, the photo is counted against the patient's per-template `max_photos` limit. If NULL, it is considered a clinic-added photo and is excluded from the patient's quota.
* **Visibility**: Patients see all photos on the record (including clinic-added ones) unless the clinic specifically marks them as internal (out of scope for MVP).

**Rationale**: Photo uploads add significant value for telehealth workflows. Per-template limits allow clinics to customize based on form purpose. Clinics may need to add photos for documentation without being restricted by patient limits.

### 3. Form Expiration

**Question**: Should patient forms have an expiration time?

**Decision**: **No expiration, but status tracking**.

* Forms remain fillable indefinitely until submitted
* Track status: `pending` (sent, not filled), `submitted` (completed), `skipped` (couldn't send due to unlinked LINE)
* Clinic can see pending forms and optionally resend reminders
* **Staleness**: In the clinic UI, show "Sent X days ago" to help identify abandoned forms.

**Rationale**: No expiration simplifies implementation. Tracking skips provides visibility into delivery failures. Clinic admins need staleness data for manual cleanup/follow-up.

### 4. Form Edit After Submission

**Question**: Can patients edit a submitted form?

**Decision**: **Yes, no locking**.

* Both patients and clinic users can view and edit the form at any time
* Use optimistic locking (version check) to prevent concurrent edit conflicts
* Same conflict handling as medical records (show conflict dialog, allow reload or force save)
* **Traceability**: Track `last_updated_by_user_id` (clinic) and `last_updated_by_patient_id` (patient) on medical records to distinguish sources of truth.
* **UX**: Ensure the LIFF conflict dialog is simplified and mobile-friendly for patients.
* **Reuses**: Existing `version` field and conflict handling UI from medical records

**Rationale**: Simplicity. The existing optimistic locking mechanism handles concurrent edits. Source tracking is vital for audit trails.

### 5. Multiple Forms per Appointment

**Question**: Can multiple patient forms be sent for the same appointment?

**Decision**: **Yes**.

* An appointment can trigger multiple patient forms (different templates)
* Configuration in service item settings allows multiple patient form events (like follow-up messages)

**Rationale**: Different forms may be needed (e.g., consent form + health history form).

### 6. Timing Mode

**Question**: When exactly should "Send instantly at appointment creation time" trigger?

**Decision**: **At appointment confirmation** (status changes to 'confirmed').

* Mode 1: Immediate (at confirmation)
* Mode 2: After appointment - X hours later
* Mode 3: After appointment - specific time on Y days after

**Reuses**: Same timing modes and logic as `FollowUpMessage` system.

**Rationale**: Matches the follow-up message timing model for consistency.

### 7. Message Template Variables

**Question**: What placeholders should be available in the LINE message for patient forms?

**Decision**: **Reuse existing message template infrastructure with validation**.

Available placeholders (same as reminder/follow-up messages):

* `{病患姓名}` - Patient name
* `{預約日期}` - Appointment date
* `{預約時間}` - Appointment time
* `{服務項目}` - Service item name
* `{診所名稱}` - Clinic name
* `{診所地址}` - Clinic address
* `{診所電話}` - Clinic phone
* **New required**: `{表單連結}` - Link to fill the form

**Template Editing Experience**:

* **Reuses**: Existing `PlaceholderHelper` component for inserting placeholders
* **Reuses**: Existing preview API endpoint pattern for message preview
* **Validation**: Backend validates that `{表單連結}` placeholder exists in the template. Error if missing.
* **Button Customization**: Allow clinics to customize the Flex Message button text (e.g., "Sign Consent" instead of "Fill Form"). Default: "填寫表單".
* Default message template provided (includes `{表單連結}`)

**Rationale**: Consistency with existing message template system. Custom button text improves the patient experience for specific form types.

### 8. Authentication for Form Access

**Question**: How should patients authenticate to access/fill forms?

**Decision**: **Secure LIFF token flow**.

* **Reuses**: Existing LIFF authentication (LINE user must be linked to patient)
* Form URL includes a secure token that validates:
  * The clinic
  * The patient form request ID
  * The patient (must match LINE user)

**Rationale**: Reuses existing LIFF auth infrastructure while ensuring security.

***

## Frontend Architecture

### State Management Strategy

The Patient Form system uses **React Query** for all server state management to ensure consistent caching and real-time updates.

*   **Query Keys**:
    *   `['patientFormTemplates', clinicId]`: List of templates filtered by `template_type='patient_form'`.
    *   `['patientFormSettings', appointmentTypeId]`: Configuration for a specific service item.
    *   `['patientFormRequests', patientId]`: List of forms sent to a specific patient.
    *   `['liff', 'patientForms']`: Patient-facing list of pending/submitted forms.
    *   `['liff', 'patientForm', accessToken]`: Details and current values for a specific form.
*   **Cache Invalidation**:
    *   Updating a bundle invalidates `['patientFormSettings']`.
    *   Submitting a form in LIFF invalidates `['liff', 'patientForms']` and `['liff', 'patientForm']`.
    *   Manual sending invalidates `['patientFormRequests']`.

### Component Architecture

The implementation reuses the **Atomic Design** pattern established in the codebase.

*   **Shared Components**:
    *   `MedicalRecordDynamicForm`: The core engine for rendering fields and handling values. Reused for both Admin preview and LIFF filling.
    *   `PlaceholderHelper`: Used in the message template editor to insert variables.
*   **Admin Components**:
    *   `PatientFormSettingsSection`: Manages the list of form events within the Service Item modal.
    *   `PatientFormRequestsSection`: Displays the form history on the Patient Detail page.
    *   `MedicalRecordTemplateEditorModal`: Enhanced to support `max_photos` and a "Preview" tab.
*   **LIFF Components**:
    *   `PatientFormsFlow`: Orchestrates the navigation for patients.
    *   `PatientFormPage`: The mobile-optimized container for form filling and photo uploads.

### User Interaction Flows

1.  **Admin Configuration**: Admin opens Service Item → "患者表單" tab → Adds a template → Configures timing (e.g., "Immediate") → Saves bundle.
2.  **Automatic Delivery**: Patient books appointment → Appointment confirmed → Scheduler creates `ScheduledLineMessage` → Worker sends LINE Flex Message with "填寫表單" button.
3.  **Patient Filling**: Patient clicks LINE button → LIFF opens directly to the form → Patient fills values and uploads photos → Clicks "Submit" → Success screen.
4.  **Clinic Review**: Practitioner opens Patient Detail → "患者表單" section → Sees "Submitted" status → Clicks to open the resulting Medical Record.

***

### 9. Notification on Form Submission

**Question**: Should the clinic be notified when a patient submits a form?

**Decision**: **Configurable multi-recipient notification**.

Per patient form setting, configure which recipients to notify on submission:

1. **Clinic Admins**: Notify all admin users (via LINE if linked)
2. **Appointment Practitioner**: Notify the practitioner assigned to the appointment
3. **Patient's Assigned Practitioner**: Notify the patient's assigned practitioner (if any)

**Configuration Options** (each is a boolean, default: all off):

* `notify_admin`: Notify clinic admins
* `notify_appointment_practitioner`: Notify the appointment's practitioner
* `notify_assigned_practitioner`: Notify the patient's assigned practitioner

**Special Cases**:

* **Deduplication**: If the same user appears in multiple roles, send only one notification
* **Unconfirmed Auto-Assignment**: If the appointment was auto-created, do NOT notify the practitioner if `is_auto_assigned == true`. Wait until the admin manually confirms the practitioner (which sets `is_auto_assigned = false`).
* **Notification Content**: Simple LINE message with form name, patient name, and link to view in the admin panel.

**Reuses**: Existing LINE push message infrastructure for admin notifications.

**Rationale**: Provides flexibility for different clinic workflows while avoiding notification spam.

### 10. Edge Case: Form Sent but Patient Not Linked

**Question**: What if the form is sent via LINE but the patient isn't linked to a LINE user?

**Decision**: **Prevent sending**.

* Patient forms can only be sent to patients with linked LINE users
* UI shows validation error when attempting to send to unlinked patients
* Automatic form sending skips patients without LINE users (no error, just skip)

**Rationale**: The primary delivery channel is LINE; sending to unlinked patients is impossible.

### 11. Form Reminders

**Question**: Should there be automatic reminder messages for unfilled forms after X days?

**Decision**: **No automatic reminders for MVP**.

* Manual resend option available from patient detail page
* Automatic reminders can be added in a future version

**Rationale**: MVP simplicity. Clinics can manually resend if needed.

### 12. Form Preview for Admins

**Question**: Should clinic admins be able to preview forms?

**Decision**: **Yes, add preview functionality to BOTH medical record templates and patient form templates**.

* In template editor (full-screen modal), add a "Preview" tab/button
* Opens a preview showing the form as it would appear when filling
* Uses the same `MedicalRecordDynamicForm` component in read-only mode with sample data
* Available for both medical record templates and patient form templates

**UI Enhancement**: Change template creation/edit from regular modal to **full-screen modal** (like `ServiceItemSettingsModal`) for better editing experience.

**Rationale**: Essential for admins to verify the form looks correct. Full-screen modal provides more space for the field builder and preview.

***

## Data Model

### New Tables

#### 1. `patient_form_settings` (Configuration per Service Item)

```sql
CREATE TABLE patient_form_settings (
    id SERIAL PRIMARY KEY,
    clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    appointment_type_id INTEGER NOT NULL REFERENCES appointment_types(id) ON DELETE CASCADE,
    template_id INTEGER NOT NULL REFERENCES medical_record_templates(id),
    
    -- Timing mode (similar to follow_up_messages) ← REUSES same pattern
    timing_mode VARCHAR(20) NOT NULL,  -- 'immediate', 'hours_after', 'specific_time'
    hours_after INTEGER,               -- For 'hours_after' mode
    days_after INTEGER,                -- For 'specific_time' mode
    time_of_day TIME,                  -- For 'specific_time' mode
    
    -- Message template (must include {表單連結}) ← REUSES placeholder system
    message_template TEXT NOT NULL,
    flex_button_text VARCHAR(50) DEFAULT '填寫表單',
    
    -- Notification settings
    notify_admin BOOLEAN DEFAULT FALSE,
    notify_appointment_practitioner BOOLEAN DEFAULT FALSE,
    notify_assigned_practitioner BOOLEAN DEFAULT FALSE,
    
    is_enabled BOOLEAN DEFAULT TRUE,
    display_order INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT check_timing_mode CHECK (timing_mode IN ('immediate', 'hours_after', 'specific_time')),
    CONSTRAINT check_timing_mode_consistency CHECK (
        (timing_mode = 'immediate') OR
        (timing_mode = 'hours_after' AND hours_after IS NOT NULL AND hours_after >= 0) OR
        (timing_mode = 'specific_time' AND days_after IS NOT NULL AND days_after >= 0 AND time_of_day IS NOT NULL)
    )
);

CREATE INDEX idx_patient_form_settings_clinic ON patient_form_settings(clinic_id);
CREATE INDEX idx_patient_form_settings_apt_type ON patient_form_settings(appointment_type_id);
```

#### 2. `patient_form_requests` (Tracking sent forms)

```sql
CREATE TABLE patient_form_requests (
    id SERIAL PRIMARY KEY,
    clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    template_id INTEGER NOT NULL REFERENCES medical_record_templates(id),
    appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
    
    -- Source tracking (Renamed to avoid conflict with medical_records.source_type)
    request_source VARCHAR(20) NOT NULL,  -- 'auto' (from appointment) or 'manual'
    patient_form_setting_id INTEGER REFERENCES patient_form_settings(id) ON DELETE SET NULL,
    
    -- Notification settings (copied from patient_form_settings at send time, or set manually)
    notify_admin BOOLEAN DEFAULT FALSE,
    notify_appointment_practitioner BOOLEAN DEFAULT FALSE,
    notify_assigned_practitioner BOOLEAN DEFAULT FALSE,
    
    -- Status tracking
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending', 'submitted'
    
    -- Security token for form access
    access_token VARCHAR(64) NOT NULL UNIQUE,
    
    -- Result: links to created medical record when submitted ← REUSES medical_records
    medical_record_id INTEGER REFERENCES medical_records(id) ON DELETE SET NULL,
    
    -- Timestamps
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    submitted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT check_request_source CHECK (request_source IN ('auto', 'manual')),
    CONSTRAINT check_status CHECK (status IN ('pending', 'submitted', 'skipped'))
);

CREATE INDEX idx_patient_form_requests_clinic ON patient_form_requests(clinic_id);
CREATE INDEX idx_patient_form_requests_patient ON patient_form_requests(patient_id);
CREATE INDEX idx_patient_form_requests_appointment ON patient_form_requests(appointment_id);
CREATE INDEX idx_patient_form_requests_token ON patient_form_requests(access_token);
CREATE INDEX idx_patient_form_requests_status ON patient_form_requests(clinic_id, status);
```

### Modified Tables

#### `medical_record_templates` - Add Template Type and Photo Limit

```sql
-- Add template type
ALTER TABLE medical_record_templates 
ADD COLUMN template_type VARCHAR(20) NOT NULL DEFAULT 'medical_record';

-- Add photo limit (for patient forms, can also apply to medical records)
ALTER TABLE medical_record_templates 
ADD COLUMN max_photos INTEGER NOT NULL DEFAULT 5;

-- Constraint for valid types
ALTER TABLE medical_record_templates 
ADD CONSTRAINT check_template_type CHECK (template_type IN ('medical_record', 'patient_form'));

-- Constraint for photo limit
ALTER TABLE medical_record_templates 
ADD CONSTRAINT check_max_photos CHECK (max_photos >= 0 AND max_photos <= 20);

-- Index for filtering
CREATE INDEX idx_medical_record_templates_type ON medical_record_templates(clinic_id, template_type);
```

#### `medical_records` - Add Source Tracking

```sql
-- Track whether record was created by clinic or patient
ALTER TABLE medical_records 
ADD COLUMN source_type VARCHAR(20) NOT NULL DEFAULT 'clinic',
ADD COLUMN last_updated_by_user_id INTEGER REFERENCES users(id),
ADD COLUMN last_updated_by_patient_id INTEGER REFERENCES patients(id);

-- Constraint for valid source types
ALTER TABLE medical_records 
ADD CONSTRAINT check_source_type CHECK (source_type IN ('clinic', 'patient'));

-- Link to patient form request (if created from patient form)
ALTER TABLE medical_records 
ADD COLUMN patient_form_request_id INTEGER REFERENCES patient_form_requests(id);

-- Note: In backend Patient model, also add medical_records relationship:
-- medical_records = relationship("MedicalRecord", back_populates="patient")
```

***

## API Design

### Template Management (Extended)

Templates already have full CRUD via `/clinic/medical-record-templates`. Extend:

* `GET /clinic/medical-record-templates?type=patient_form` - Filter by template type
* `POST /clinic/medical-record-templates` - Add `template_type` and `max_photos` fields to request body
* `PUT /clinic/medical-record-templates/:id` - Add `max_photos` field

### Patient Form Settings (New)

#### `GET /clinic/appointment-types/:id/patient-form-settings`

* **Description**: List patient form settings for an appointment type
* **Response**: `{ patient_form_settings: PatientFormSetting[] }`

#### `POST /clinic/appointment-types/:id/patient-form-settings`

* **Description**: Create a patient form setting
* **Validation**: `message_template` must contain `{表單連結}`
* **Request Body**:

```json
{
  "template_id": 123,
  "timing_mode": "hours_after",
  "hours_after": 24,
  "message_template": "親愛的{病患姓名}，請填寫表單：{表單連結}",
  "flex_button_text": "填寫初診單",
  "notify_admin": true,
  "notify_appointment_practitioner": true,
  "notify_assigned_practitioner": false,
  "is_enabled": true,
  "display_order": 0
}
```

* **Errors**: 400 if `{表單連結}` is missing from `message_template`

#### `PUT /clinic/patient-form-settings/:id`

* **Description**: Update a patient form setting
* **Validation**: Same as create
* **Request Body**: Same as create (partial)

#### `DELETE /clinic/patient-form-settings/:id`

* **Description**: Delete a patient form setting

#### `GET /clinic/service-items/:id/bundle` (Extended)

* **Description**: Included `patient_form_settings` in the service item bundle response.
* **Response**: `ServiceItemBundleResponse` now includes `associations.patient_form_settings`.

#### `PUT /clinic/service-items/:id/bundle` (Extended)

* **Description**: Support atomic synchronization of `patient_form_settings` within the service item bundle update.
* **Request Body**: `ServiceItemBundleRequest` now accepts `associations.patient_form_settings` for diff-based sync.

#### `POST /clinic/patient-form-settings/preview`

* **Description**: Preview the message template with placeholders resolved
* **Reuses**: Same pattern as follow-up message preview
* **Request Body**:

```json
{
  "appointment_type_id": 123,
  "message_template": "親愛的{病患姓名}，請填寫表單：{表單連結}"
}
```

* **Response**:

```json
{
  "preview_message": "親愛的王小明，請填寫表單：[填寫表單]",
  "used_placeholders": {"病患姓名": "王小明", "表單連結": "[填寫表單]"},
  "completeness_warnings": []
}
```

### Patient Form Requests (New)

#### `GET /clinic/patients/:patientId/patient-form-requests`

* **Description**: List patient form requests for a patient
* **Query Parameters**: `status`, `page`, `pageSize`
* **Response**: `{ requests: PatientFormRequest[], total: number }`

#### `POST /clinic/patients/:patientId/patient-form-requests`

* **Description**: Manually send a patient form
* **Validation**: Patient must have linked LINE user. `message_template` must contain `{表單連結}`.
* **Request Body**:

```json
{
  "template_id": 123,
  "appointment_id": 456,
  "message_template": "請填寫表單：{表單連結}",
  "flex_button_text": "補充資料",
  "notify_admin": false,
  "notify_appointment_practitioner": true,
  "notify_assigned_practitioner": false
}
```

* **Errors**: 400 if patient has no linked LINE user

#### `GET /clinic/patient-form-requests/:id`

* **Description**: Get details of a patient form request

### LIFF Endpoints (New)

#### `GET /liff/patient-forms`

* **Description**: List pending and submitted patient forms for the current patient
* **Reuses**: LIFF authentication flow
* **Response**: `{ forms: PatientFormResponse[] }`

#### `GET /liff/patient-forms/:accessToken`

* **Description**: Get form details for filling
* **Validation**: Access token valid, LINE user matches patient
* **Response**: Form template (with `max_photos`), current values (if any), and metadata

#### `POST /liff/patient-forms/:accessToken/submit`

* **Description**: Submit a completed form
* **Transactionality**: This must be a single DB transaction.
* **Validation**: Ensure `access_token` matches patient and logic.
* **Reuses**: Medical record creation logic with `source_type='patient'`
* **Request Body**:

```json
{
  "values": { "field_id": "value", ... },
  "photo_ids": [1, 2, 3]
}
```

* **Side Effects**:
  * Creates medical record with `source_type='patient'`
  * Updates `PatientFormRequest.status` to `'submitted'`
  * Sends notifications based on settings

#### `PUT /liff/patient-forms/:accessToken`

* **Description**: Update a submitted form
* **Reuses**: Medical record update logic with version check
* **Request Body**: Same as submit
* **Note**: Uses optimistic locking (version check). Same conflict handling as medical records.

### Photo Upload (LIFF)

#### `POST /liff/patient-forms/:accessToken/photos`

* **Description**: Upload a photo for the form
* **Validation**: Photos count must not exceed template's `max_photos` (patient side only)
* **Note**: If `max_photos = 0`, this endpoint returns 400 (photo section should be hidden in UI)
* **Reuses**: Same photo upload logic as medical record photos
* **Request Body**: `multipart/form-data` with `file`, `description?`
* **Response**: `{ photo: PatientPhoto }`

***

## LINE Message Flow

### Message Content

When a patient form is sent, the LINE message contains:

1. Customizable text (with placeholders rendered)
2. The `{表單連結}` placeholder is rendered as a clickable button

**Default Message Template**:

```
親愛的 {病患姓名}，

請填寫以下表單，協助我們更好地為您服務：
{表單連結}

如有任何問題，請隨時聯繫我們。
```

**Rendered Message** (example):

```
親愛的 王小明，

請填寫以下表單，協助我們更好地為您服務：
[填寫表單] ← Button with LIFF link

如有任何問題，請隨時聯繫我們。
```

### Form Link Rendering

The `{表單連結}` placeholder is converted to a LINE Flex Message button:

* **Rendering Behavior**: The `{表單連結}` placeholder is removed from the message text body, and a separate clickable button is rendered in the Flex Message footer.
* **Button text**: Customizable via `flex_button_text` (defaults to "填寫表單")
* **Action**: Open LIFF URL with the access token

### Scheduling (Reuse ScheduledLineMessage)

* **Reuses**: Existing `scheduled_line_messages` table and sending infrastructure
* Add message type: `'patient_form'`
* Scheduling follows the same pattern as follow-up messages

***

## Notification Flow

### On Form Submission

When a patient submits a form, the backend:

1. **Collect recipients** based on `patient_form_request` notification settings:
   * If `notify_admin`: Get all admin users for the clinic
   * If `notify_appointment_practitioner`: Get the appointment's practitioner (if confirmed)
   * If `notify_assigned_practitioner`: Get the patient's assigned practitioner (if any)

2. **Deduplicate recipients**: Same user may appear in multiple roles
   * Use a set of `user_id` to ensure each user receives only one notification

3. **Check appointment practitioner confirmation**:
   * If appointment exists and `notify_appointment_practitioner` is true:
     * Skip if practitioner is not confirmed (e.g., `is_practitioner_confirmed = false` or auto-assignment pending)
   * This prevents notifying practitioners about patients they haven't officially been assigned to

4. **Send notifications**:
   * **Reuses**: Existing LINE push message infrastructure
   * For each recipient with a linked LINE user, send a LINE push message

**Notification Message Template**:

```
📋 病患表單已提交

病患：{patient_name}
表單：{template_name}
{appointment_info if exists}

請至後台查看詳情。
```

***

## Frontend Components

### UI Enhancements

#### Full-Screen Template Editor Modal

**Change**: Convert template creation/edit modals from regular modals to **full-screen modals**.

* **Applies to**: Both `MedicalRecordTemplateEditorModal` and `PatientFormTemplateEditorModal`
* **Reuses**: Same full-screen modal pattern as `ServiceItemSettingsModal`
* **Layout**:
  * Left panel: Template name, description, settings (including `max_photos`)
  * Center panel: Field builder
  * Right panel (or tab): Form preview

This provides more space for:

* The field builder (drag-and-drop ordering, field configuration)
* Live preview of the form
* Photo limit configuration

### Clinic Admin Interface

#### 1. Patient Form Templates Page

* **Location**: Settings → Patient Form Templates (new menu item)
* **Component**: `SettingsPatientFormTemplatesPage.tsx`
* **Reuses**: Same list layout as `SettingsMedicalRecordTemplatesPage`
* **Functionality**:
  * Same as medical record templates but filtered to `template_type='patient_form'`
  * Shows `max_photos` limit for each template

#### 2. Template Editor Modal (Enhanced)

* **Component**: `MedicalRecordTemplateEditorModal.tsx` (enhanced)
* **Changes**:
  * Convert to full-screen modal (like `ServiceItemSettingsModal`)
  * Add `max_photos` setting (number input, 0-20, default 5)
  * Add "Preview" tab showing the form as patients/users would see it
  * **Reuses**: `MedicalRecordDynamicForm` component for preview with sample data

#### 3. Service Item Modal - Patient Form Section

* **Location**: Service Items settings → Modal → New tab/section "患者表單"
* **Component**: `PatientFormSettingsSection.tsx`
* **Reuses**: Same pattern as `FollowUpMessagesSection.tsx`
* **Functionality**:
  * Add/edit/delete patient form sending events
  * Select template from patient form templates
  * Configure timing mode (reuses timing mode UI from follow-up messages)
  * Message template editor with `PlaceholderHelper` (reuses from follow-up messages)
  * **Flex Button Text**: Field to customize the button text on the Flex Message.
  * **Validation**: Show error if `{表單連結}` is missing
  * Preview message button (reuses preview API pattern)
  * Notification settings (3 checkboxes)

#### 4. Patient Detail Page - Patient Forms Section

* **Location**: Patient detail page → New section "患者表單" (after Medical Records)
* **Component**: `PatientFormRequestsSection.tsx`
* **Functionality**:
  * Button to manually send a patient form
  * Shows list of pending/submitted forms
  * Each row shows: template name, status, sent date, submitted date
  * Click to view the linked medical record (if submitted)
  * Modal to send new form: select template, optional appointment, message template, notification settings

#### 5. Appointments Settings Page - LIFF URLs

* **Location**: Settings → Appointments → LIFF URLs section
* **Update**: Add patient form LIFF URL to the existing URL list
  * Example: `https://liff.line.me/{liff_id}?mode=forms`

### Patient Interface (LIFF)

#### 1. LIFF Home - New Menu Item

* **Location**: LIFF home page
* **Update**: Add new menu item "填寫表單" (Fill Forms)
* **Navigation**: Opens patient forms list

#### 2. Patient Forms List

* **Location**: `/liff?mode=forms`
* **Component**: `PatientFormsFlow.tsx`
* **Functionality**:
  * List pending forms (with "Fill Now" button)
  * List submitted forms (with "View/Edit" button)
  * Empty state: "No forms to fill"

#### 3. Patient Form Fill Page

* **Location**: `/liff?mode=form&token=xxx`
* **Component**: `PatientFormPage.tsx`
* **Note**: Avoid naming collision with `PatientForm.tsx` (which is for profile onboarding).
* **Reuses**: `MedicalRecordDynamicForm` component for form rendering
* **Functionality**:
  * Dynamic form rendering
  * Photo upload section (hidden if `max_photos = 0`, otherwise respects template's limit)
  * Submit button
  * Edit mode for submitted forms (same UI, different submit action)
  * Version conflict handling (reuses same UI as medical records; mobile-friendly)
  * Success screen after submission

***

## Lifecycle Handling

### Form → Medical Record Lifecycle

1. **Form Sent**: `PatientFormRequest` created with `status='pending'`, LINE message sent
2. **Form Submitted**:
   * `MedicalRecord` created with `source_type='patient'`, `patient_form_request_id` set
   * **Reuses**: Same medical record creation logic
   * Photos committed (`is_pending=false`) — **Reuses**: Same photo commit flow
   * `PatientFormRequest.status` → `'submitted'`
   * `PatientFormRequest.medical_record_id` → new record ID
   * Notifications sent based on settings
3. **Form Edited (by patient or clinic)**: Medical record updated (version incremented)
   * **Reuses**: Same update logic and conflict handling
4. **Medical Record Deleted**: Normal medical record soft-delete flow
   * Associated photos soft-deleted
   * 30-day retention, then hard delete
   * **Reuses**: Existing lifecycle handling

### Photo Lifecycle

* **Reuses**: Same lifecycle as medical record photos
* Staged (`is_pending=true`) during form filling
* Committed when form is submitted
* Tied to the medical record for deletion

### Appointment Cancellation

When an associated appointment is cancelled:

* **Decision**: Pending patient form requests remain active (patient can still fill them if desired)
* The appointment association is preserved (via `ON DELETE SET NULL`, appointment_id becomes NULL)
* Clinics can manually manage pending forms from the patient detail page if needed

**Future Enhancement**: Consider adding a `cancelled` status for forms that should no longer be filled, but this is out of scope for MVP.

***

## Security Considerations

### Access Control

1. **Form Access Token**:
   * 64-character cryptographically secure random token (Python: `secrets.token_urlsafe(48)`)
   * Unique per form request
   * Validated on every LIFF request

2. **Patient Validation**:
   * **Reuses**: Existing LIFF LINE user validation
   * LINE user must be linked to the patient associated with the form
   * Cross-check `line_user_id` ↔ `patient_id` ↔ `patient_form_request_id`

3. **Clinic Isolation**:
   * All queries filter by `clinic_id`
   * Templates and forms are strictly isolated

### Rate Limiting

* Rate limit photo uploads on patient side (respects template's `max_photos` limit; clinic side has no limit)
* Consider rate limiting form submissions (e.g., max 1 per minute per patient) if abuse is observed

***

## Implementation Plan

### Phase 1: Database & Backend Foundation (Week 1-2)

* [x] Database migrations for new tables and columns
  * [x] `patient_form_settings` table
  * [x] `patient_form_requests` table
  * [x] `template_type` and `max_photos` columns on `medical_record_templates`
  * [x] `source_type` and `patient_form_request_id` on `medical_records`
* [x] Update `MedicalRecordTemplate` model and service with `template_type` and `max_photos`
* [x] Create `PatientFormSetting` model and CRUD service
* [x] Create `PatientFormRequest` model and service
* [x] Add message template validation (require `{表單連結}`)
* [x] Backend refinements (race condition protection, optimized indexes, centralized validation)

### Phase 2: Scheduling & Notifications (Week 2)

* [x] Integrate with `ScheduledLineMessage` for automatic sending (reuse existing infrastructure)
* [x] Create `PatientFormSchedulingService` (mirror `FollowUpMessageService` pattern)
* [x] Add scheduled message handling for `patient_form` type
* [x] Handle appointment creation/edit/cancel flows
* [x] Implement notification service for form submissions
* [x] Handle practitioner confirmation check for notifications
* [x] Implement recipient deduplication

### Phase 3: Clinic Admin Frontend (Week 2-3)

* [ ] Convert template editor modal to full-screen (for both medical records and patient forms)
* [ ] Add `max_photos` setting to template editor
* [ ] Add form preview tab to template editor (reuse `MedicalRecordDynamicForm`)
* [ ] Patient form templates page (copy and modify from medical record templates)
* [ ] Service item modal - patient form settings section (mirror follow-up messages section)
* [ ] Message template editor with validation and preview (reuse `PlaceholderHelper`)
* [ ] Notification checkboxes UI
* [ ] Patient detail page - patient forms section

### Phase 4: Patient LIFF Interface (Week 3-4)

* [x] LIFF API endpoints for form access/submission
* [ ] LIFF home - patient forms menu item
* [ ] Patient forms list page
* [ ] Form fill page with dynamic form (reuse `MedicalRecordDynamicForm`)
* [ ] Photo upload with limit from template (hide section if `max_photos = 0`)
* [ ] Version conflict handling (reuse existing UI)
* [ ] Success screen

### Phase 5: Polish & Testing (Week 4-5)

* [x] Edge case handling and error messages
* [x] Integration tests
* [x] Documentation updates
* [ ] Manual QA testing (Backend/API verified)

***

## Summary

The Patient Form feature extends the medical record system to enable patient-initiated data entry. By heavily reusing existing infrastructure, we minimize new code while providing significant new value:

**Reuses**:

* Medical record templates table (with type filter)
* Template field builder component
* `MedicalRecordDynamicForm` component
* Photo upload and lifecycle infrastructure
* Message template placeholders and preview
* Scheduling infrastructure (`scheduled_line_messages`)
* LIFF authentication
* LINE push message infrastructure
* Optimistic locking for concurrent edits
* Full-screen modal pattern

**New**:

* `template_type` and `max_photos` on templates
* Patient form settings per service item
* Form requests tracking table
* Patient LIFF form interface
* Multi-recipient submission notifications
* Form preview in template editor

**Key Benefits**:

* Pre-appointment information gathering
* Consent form collection
* Post-appointment feedback
* Reduced clinic workload for data entry
* Seamless patient experience via LINE
* Flexible notification to admins and practitioners
* Configurable photo limits per template

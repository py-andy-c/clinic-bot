# Design Doc: Customize Patient Form Message Template

## Overview

Currently, when sending a medical record form to a patient via LINE, the system uses a default message or a manual override in the "Send Patient Form" modal. This design aims to move this customization to the medical record template level, allowing different templates to have different message templates.

## User Requirements

1. Add a `message_template` field to medical record templates.
2. In the "Add/Edit Template" modal, show the message template editor when "Set as Patient Form" is enabled.
3. The editing experience should match other message templates (variables, textarea, preview, reset).
4. Remove the customization field from the "Send Patient Form" modal.
5. Research and apply appropriate LINE message length limits.
6. Propose variables (excluding appointment info).
7. The template and "Set as Patient Form" toggle should be independent in the database but linked in the UI.

## Research: LINE Message Length Limits

* **ButtonsTemplate**: The `text` field has a limit of **160 characters**.
* **TextMessage**: Has a limit of **5,000 characters**.
* **Flex Message**: Highly customizable, total JSON size limit is 30KB, text components have no specific character limit other than the total size.

### Proposal for Message Delivery

Current implementation uses a **Buttons Template** for a standard, reliable experience. This allows a clear call-to-action button while maintaining compatibility with the existing `LINEService`.

* **Benefit**: Consistent with other system messages, easy to implement.
* **Limit**: 160 characters for the main text. The UI enforces this limit to ensure delivery success.

## Proposed Variables

Since medical records may not always be associated with an appointment, we will exclude appointment-related variables:

* `{病患姓名}`: Patient's full name.
* `{模板名稱}`: The name of the medical record template.
* `{診所名稱}`: The name of the clinic.

## Implementation Plan

### Backend Changes

1. **Database Migration**:
   * Add `message_template` column (Text, nullable) to `medical_record_templates` table.
2. **Models**:
   * Update `MedicalRecordTemplate` in `backend/src/models/medical_record_template.py`.
3. **API Schemas**:
   * Update `MedicalRecordTemplateCreate`, `MedicalRecordTemplateUpdate`, and `MedicalRecordTemplateResponse` in `backend/src/api/clinic/medical_record_templates.py`.
4. **Services**:
   * Update `MedicalRecordTemplateService` to handle the new field.
   * Update `MedicalRecordService.send_patient_form`:
     * Fetch the template's `message_template`.
     * Fallback to a default if null.
     * Render placeholders using `MessageTemplateService.render_message`.
     * (Optional but recommended) Implement `line_service.send_flex_form_message` or similar to handle longer messages.

### Frontend Changes

1. **Types**:
   * Update `MedicalRecordTemplate` type in `frontend/src/types/medicalRecord.ts`.
2. **Template Editor Modal** (`MedicalRecordTemplateEditorModal.tsx`):
   * Add `message_template` to the Zod schema.
   * Add a new UI section "病患表單訊息設定" that appears when `is_patient_form` is True.
   * Components:
     * `PlaceholderHelper` with relevant variables.
     * `textarea` with character count (Limit: 3500 to match other templates).
     * "重設預設值" button.
     * "預覽訊息" button (using a modal).
3. **Send Patient Form Dialog** (`SendPatientFormDialog.tsx`):
   * Remove the `message_override` textarea and related schema field.
   * The backend will now automatically use the template-level message.

## Database Consistency

* The `is_patient_form` and `message_template` fields will be independent in the database.
* Toggling `is_patient_form` OFF in the UI will hide the message editor, but the `message_template` value will remain preserved in the form state and database unless edited.

## Default Message

If no template is configured, the default will be:
`{病患姓名}，您好：\n請填寫「{模板名稱}」表單，謝謝您。`

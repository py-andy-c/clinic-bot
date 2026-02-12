# PR Description: Refine Patient Medical Record Form Workflow

## Summary

This PR refines the patient medical record form lifecycle and status management system to be more intuitive, predictable, and aligned with standard form submission patterns. It eliminates the confusing "Draft" state, simplifies clinic-facing statuses, and improves metadata attribution for better accountability.

**Note**: This refers to medical record forms sent to patients for completion (e.g., intake forms), not the patient profile registration form.

## Key Changes

### 1. Patient Experience (LIFF) Enhancements

* **Simplified Lifecycle**: Removed the manual "Save Draft" button. The form now follows a persistent "Submit-and-Edit" model.
* **Dynamic Call-to-Action**: The primary action button now dynamically updates its label:
  * **「確認送出」 (Confirm Submit)**: Shown for the initial submission.
  * **「儲存修改」 (Save Changes)**: Shown for all subsequent edits after the first submission.
* **Improved Success Flow**: Redesigned the confirmation page to be more focused by removing the redundant "Back to View/Edit" button. Patients can return to the form at any time via the original link to make further improvements.

### 2. Clinic Dashboard & Status Logic

* **Simplified Status System**: Replaced the previous 4-stage status logic with a focused 3-state system:
  * 🟡 **待填寫 (Pending)**: Patient medical record forms that have been issued but not yet saved by the patient.
  * 🟢 **病患已填寫 (Patient Filled)**: Patient medical record forms that have been saved or updated at least once.
  * 🔵 **Clinic Internal**: Removed the "診所建立" (Clinic Created) badge to reduce visual noise on standard internal records.
* **Explicit Accountability**: Updated the medical record card in the clinic dashboard to clearly attribute edits. It now shows:
  * `編輯：[时间] 由 [診所人員姓名]` (for clinic staff edits)
  * `編輯：[时间] 由 病患` (for patient-driven updates)

### 3. Backend & Dynamic Logic

* **Relational Integrity**: Moved away from snapshotting the `is_patient_form` flag. Instead, the system now dynamically joins the `MedicalRecordTemplate` to determine the record's identity. This ensures all records (including legacy ones) stay consistent with their template settings.
* **Enriched API Responses**: Updated both clinic and LIFF API responses to include the current `is_patient_form` status at the top level of the payload.
* **Audit Trail Clean-up**: Refined `MedicalRecordService.update_record` to remove redundant logic and ensure correct "By Patient" display in the frontend.
* **Type Safety**: Updated TypeScript definitions and backend schemas to support the new metadata fields.

## Quality Assurance

* **Frontend Tests**: Updated `PatientMedicalRecordPage.test.tsx` and `medicalRecordUtils.test.ts` to cover the new dynamic button labels and status transitions.
* **Full Regression**: Verified that both backend and frontend tests pass (`✅ PASSED`).
* **Data Consistency**: Verified that legacy records handle the missing flag gracefully while new records benefit from the enriched metadata.

## Terminology Changes

* Renamed "患者已更新" to **「病患已填寫」** for better clinical clarity.

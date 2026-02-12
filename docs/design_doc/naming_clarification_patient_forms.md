# Naming Clarification: Patient Forms vs Patient Profile Forms

## Overview

This document clarifies the naming distinction between two different concepts that were both referred to as "patient form" in the codebase.

## The Two Concepts

### 1. Patient Medical Record Forms (Sent to Patients)
**What it is**: Medical record templates that can be sent to patients via LINE for completion.

**Key characteristics**:
- Uses `MedicalRecordTemplate` with `is_patient_form: true`
- Creates a `MedicalRecord` instance when sent
- Examples: intake forms, health questionnaires, pre-visit assessments
- Sent via `SendPatientFormDialog` component
- Filled out by patients on LIFF at `/records/{record_id}`

**Naming in code**:
- Backend: `SendPatientFormRequest`, `send_patient_form()` endpoint
- Frontend: `SendPatientFormDialog`, `useSendPatientForm` hook
- Database: `is_patient_form` flag on templates
- **No changes made** - kept existing names

### 2. Patient Profile Forms (Registration)
**What it is**: Form used to create/register a new patient in the system.

**Key characteristics**:
- Creates a `Patient` entity with basic info (name, phone, birthday, gender)
- Used in LIFF appointment booking and patient management
- Collects patient profile information, not clinical data

**Naming in code** (RENAMED):
- Component: `PatientForm` → `PatientProfileForm`
- Types: `PatientFormData` → `PatientProfileFormData`
- Types: `PatientFormProps` → `PatientProfileFormProps`
- Validation: `patientFormValidation.ts` → `patientProfileFormValidation.ts`
- Functions: `validateLiffPatientForm` → `validateLiffPatientProfileForm`
- Functions: `validateClinicPatientForm` → `validateClinicPatientProfileForm`
- Types: `PatientFormValidationResult` → `PatientProfileFormValidationResult`

## Changes Made (Option C - Minimal Change)

### Frontend Component Renames
1. **File**: `frontend/src/liff/components/PatientForm.tsx` → `PatientProfileForm.tsx`
2. **File**: `frontend/src/utils/patientFormValidation.ts` → `patientProfileFormValidation.ts`

### Type and Interface Renames
- `PatientFormData` → `PatientProfileFormData`
- `PatientFormProps` → `PatientProfileFormProps`
- `PatientFormValidationResult` → `PatientProfileFormValidationResult`

### Function Renames
- `validateLiffPatientForm()` → `validateLiffPatientProfileForm()`
- `validateClinicPatientForm()` → `validateClinicPatientProfileForm()`

### Files Updated
**Frontend**:
- `frontend/src/liff/components/PatientProfileForm.tsx` (renamed + updated)
- `frontend/src/utils/patientProfileFormValidation.ts` (renamed + updated)
- `frontend/src/liff/appointment/Step4SelectPatient.tsx` (imports updated)
- `frontend/src/liff/settings/PatientManagement.tsx` (imports updated)
- `frontend/src/components/patient/PatientInfoSection.tsx` (imports updated)

**Documentation**:
- `docs/design_doc/patient_form.md` (added terminology note)
- `docs/design_doc/patient_gender_configuration.md` (updated references)
- `docs/pr_desc/refine_patient_form_workflow.md` (clarified context)
- `docs/pr_desc/fix_liff_photo_descriptions.md` (clarified context)

**Backend**:
- `backend/src/api/clinic/medical_records.py` (added clarifying comments)

### What Was NOT Changed
- UI text and translation keys (`patient.form.*`) - kept as-is
- `is_patient_form` database flag - kept as-is
- `SendPatientFormDialog` component name - kept as-is
- `SendPatientFormRequest` backend type - kept as-is
- `send_patient_form()` endpoint name - kept as-is

## Rationale

**Option C (Minimal Change)** was chosen to:
1. Avoid changing UI text that users see
2. Avoid database migrations
3. Focus on internal code clarity for developers
4. Minimize risk and scope of changes

The key distinction is now clear in the code:
- **"Patient form"** = medical record templates sent to patients
- **"Patient profile form"** = patient registration/profile creation

## For Developers

When working with patient-related forms:

1. **Creating/editing patient profiles** → Use `PatientProfileForm` component
2. **Sending medical record forms to patients** → Use `SendPatientFormDialog` component
3. **Validating patient profile data** → Use `validateLiffPatientProfileForm()` or `validateClinicPatientProfileForm()`
4. **Working with medical record templates** → Check `is_patient_form` flag to determine if it can be sent to patients

## References

- Design doc: `docs/design_doc/patient_form.md`
- Patient profile form component: `frontend/src/liff/components/PatientProfileForm.tsx`
- Send patient form dialog: `frontend/src/components/SendPatientFormDialog.tsx`
- Validation utilities: `frontend/src/utils/patientProfileFormValidation.ts`

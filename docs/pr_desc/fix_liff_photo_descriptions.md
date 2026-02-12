# Fix: Missing Photo Descriptions in LIFF Patient Form

## Summary
Fixed an issue where photo descriptions were not displaying in the LIFF patient form. This was due to the `description` field being missing from the photo response models in both the backend and frontend.

## Changes
- **Backend**: Added `description` field to `PatientPhotoResponse` Pydantic model in `liff.py` and ensured it is populated in `get_patient_medical_record` and `upload_patient_photo` endpoints.
- **Frontend API**: Added `description` field to `PatientPhotoResponse` interface in `liffApi.ts`.
- **Frontend UI**: Updated `MedicalRecordPhotoSelector.tsx` to use the `description` from the API response, removing a temporary type cast.

## Test Plan
- Run `./run_tests.sh` to ensure all backend and frontend tests pass.
- Verify that previously uploaded photos in the LIFF patient form now correctly display their descriptions instead of default labels.

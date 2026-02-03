# PR Description: Refactor Appointment Selection UI and Fix Unlinking Bug

## Overview

This PR refactors the appointment association interface in the Medical Record page, transitioning from an inline dashed-underline dropdown to a minimalist modal-based selection. It also fixes a critical backend bug that prevented unlinking appointments from records and standardizes internal property naming.

## Changes

### 🎨 Frontend (UI/UX)

* **Minimalist Modal Selection**: Replaced the inline `<select>` element with a premium `BaseModal` selection interface.
* **Single-Line Design**: Appointment items in the modal are condensed into a single line (e.g., `2026/1/19(一) 13:45 - 14:45 | 複診`) for better scanability.
* **Real-time UI Updates**: The "Associated Appointment" display in the page header now updates instantly as soon as a selection is made in the modal, before saving.
* **Auto-Scroll**: Implemented a callback-ref based auto-scroll that instantly focuses the current selection when the modal opens.
* **Lazy Loading**: Optimized performance by configuring `usePatientAppointments` to only fetch data when the selection modal is active.
* **Aesthetic Refinement**: Replaced the "Modify" button with a subtle edit icon and removed legacy dotted underlines to maintain a clean "document" feel.

### ⚙️ Backend (API & Service)

* **Fix Association Unlinking**: Resolved a bug where setting `appointment_id` to `null` was ignored by the service.
* **SENTINEL Implementation**: Introduced a `MISSING` sentinel in `MedicalRecordService` to correctly distinguish between "no change" and "explicitly set to null".
* **Pydantic model\_fields\_set**: Updated the API controller to respect explicitly provided `null` values in the request body.
* **Data Integrity**: Enforced strict patient-appointment parity verification in the service layer when updating records.
* **Standardized DTOs**: Renamed `appointment_type` to `appointment_type_name` in backend responses to match common list formats and simplify frontend consumption.

### 🛠 Refactoring & Cleanup

* **Conflict Resolution Fix**: Fixed a data loss bug where `appointment_id` was omitted during "Force Save" conflict resolution.
* **State Management**: Removed legacy inline editing states (`isEditingAppointment`) and consolidated modal logic.
* **Validation**: Updated the dynamic schema to properly transform empty strings to `null` for cleaner data submission.
* **Logger Utility**: Enhanced the frontend `logger` with `debug` and `info` levels, scoped to development environments.

## Verification Results

* \[x] Verified selecting a new appointment updates header UI immediately.
* \[x] Verified unlinking an appointment (None) persists correctly after save.
* \[x] Verified conflict resolution "Force Save" correctly preserves appointment associations.
* \[x] Verified auto-scroll behavior to current selection.
* \[x] Verified no race conditions during lazy-loading of appointments.
* \[x] Removed all temporary debug logging.

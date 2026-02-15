# PR Description: Automated Patient Form Sending & UI Refinement

## Summary

This PR implements the **Automated Patient Form Sending** feature, allowing clinics to schedule automated LINE messages containing patient form links (Medical Record Templates) based on appointment timing. It also includes a significant UI refactor to ensure consistency with the existing follow-up message automation.

## Key Changes

### 1. Frontend: UI & UX Refinement

* **Modal-Based Management**: Refactored the Patient Form settings into a dedicated sub-modal within the Service Item edit flow, mirroring the UX of the Follow-Up Message section.
* **Natural Timing Labels**: Updated the timing configuration to a sentence-like format (e.g., *"預約「開始前」24小時發送"*) for better readability.
* **Mental Model Simplification**: Enforced a minimum of **1 day** for all "Specific Time" scheduling (both for Patient Forms and Follow-Up Messages). This eliminates confusion regarding same-day clock-time adjustments while steering users toward "Hours" for same-day automation.
* **Design System Integration**: Leveraged `BaseModal`, `TimeInput`, and shared design tokens to maintain a premium and consistent aesthetic.

### 2. Backend: API & Data Integrity

* **Service Item Bundle Integration**: Expanded the service item settings API to support synchronized saving of `patient_form_configs`.
* **Database Field Sanitization**: Refined the sync logic in `settings.py` to explicitly NULL out unused timing fields when switching between 'Hours' and 'Specific Time' modes, ensuring a clean and consistent database state.
* **Model Restoration**: Fixed a missing Pydantic model (`FollowUpMessageBundleData`) that was causing API initialization errors.
* **Robust Scheduling & Ordering**:
  * Implemented a "Commit-Before-Send" pattern for immediate form sending (late-booking scenarios).
  * Added **automatic re-indexing** in the frontend to ensure `display_order` remains sequential and unique, preventing database `UniqueViolation` errors.
  * Added comprehensive validation for timing modes (Hours vs. Days/Specific Time) in `api.ts`.

### 3. Stability & Quality

* **Environment Fixes**: Resolved path resolution issues in `run_tests.sh` to ensure consistent execution across different environments.
* **Test Coverage**: All **1,044+ backend tests** and all frontend TypeScript/unit checks are passing.
* **Zero Cleanup Needed**: Verified all temporary scripts and legacy "inline-expansion" code have been removed.

## Verification Results

* **Backend Tests**: ✅ PASSED (Unit & Integration)
* **Frontend Tests**: ✅ PASSED (TS Checks & Unit)
* **Manual Verification**: Verified modal interactions, validation constraints (min 1 day), and localized timing labels.

## Impact

Clinic administrators can now easily set up multi-step patient onboarding and follow-up sequences through a unified, intuitive interface, reducing manual administrative overhead.

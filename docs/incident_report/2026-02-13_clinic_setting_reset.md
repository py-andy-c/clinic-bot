# Incident Report: Clinic Settings Reset / Display Name Clearing

**Incident ID:** 6978590e-823d-41eb-a82c-e6563de3efd3
**Date:** 2026-02-13
**Clinics Affected:** 透視物理治療所 桃園青埔 (Clinic ID: 2)

## Executive Summary

An investigation into reports of clinic settings (specifically `display_name`) being automatically cleared has identified a critical bug in the "Appointments" settings page. When a user saves settings on the **Appointments** page (e.g., updating booking restrictions), the system accidentally clears the clinic's **Display Name**, **Address**, and **Phone Number**. This happens because the Appointments page sends an incomplete clinic information object to the backend, which then overwrites the entire settings section.

## Evidence

### 1. Proof of Reset from Immutable Receipts

Analysis of the `receipt_data` JSONB in the `receipts` table for Clinic ID 2 reveals several transitions where the `display_name` was reset to the default clinic name.

| Timestamp (UTC) | Receipt `display_name` | Status |
| :--- | :--- | :--- |
| 2026-02-08 13:23:49 | 青埔透視物理治療所 | ✅ Correct |
| 2026-02-09 03:06:52 | 透視物理治療所 桃園青埔 | ❌ Reset to fallback |
| 2026-02-13 06:56:36 | 透視物理治療所 桃園青埔 | ❌ Still fallback |
| 2026-02-13 07:44:26 | 青埔透視物理治療所 | ✅ Restored manually |

### 2. Log Correlation (The "Smoking Gun")

On Feb 9, the user reported fixing the display name. Logs show the fix was applied, but then immediately overwritten by a separate settings update.

* **2026-02-09 08:15:05 UTC:** `INFO - Updating settings section 'clinic_info_settings' for clinic 2`
  * *Observation:* This was the user manually fixing the display name on the "Clinic Info" page.
* **2026-02-09 08:16:55 UTC:** `INFO - Updating settings section 'clinic_info_settings' for clinic 2`
* **2026-02-09 08:16:55 UTC:** `INFO - Updating settings section 'booking_restriction_settings' for clinic 2`
  * *Observation:* **Only 1 minute and 50 seconds later**, another update occurred. This update included both `clinic_info_settings` and `booking_restriction_settings`, which is characteristic of the **Appointments Settings** page. This second update cleared the `display_name` set just moments prior.

### 3. Root Cause Analysis (Code Level)

#### Frontend Bug: Incomplete Schema

The Appointments page (`frontend/src/pages/settings/SettingsAppointmentsPage.tsx`) uses a partial schema for clinic info.

**File:** `frontend/src/schemas/api.ts`

```typescript
export const AppointmentsSettingsFormSchema = z.object({
  clinic_info_settings: z.object({
    appointment_type_instructions: z.string().nullable().optional(),
    appointment_notes_instructions: z.string().nullable().optional(),
    require_birthday: z.boolean().optional(),
    require_gender: z.boolean().optional(),
    restrict_to_assigned_practitioners: z.boolean().optional(),
    query_page_instructions: z.string().nullable().optional(),
    settings_page_instructions: z.string().nullable().optional(),
    notifications_page_instructions: z.string().nullable().optional(),
  }),
  // ... display_name, address, and phone_number are MISSING here!
```

#### Backend Bug: Destructive Section Override

The backend API (`backend/src/api/clinic/settings.py`) implements a "Partial Update Pattern" for the clinic settings JSONB column, but it treats each **section** as an atomic unit to be overwritten.

**File:** `backend/src/api/clinic/settings.py`

```python
910:         for section in settings_sections:
911:             if section in settings:
...
917:                 current_settings[section] = settings[section]  # Entire section is replaced!
```

When the Appointments page sends its partial `clinic_info_settings` object (containing only instructions and requirement flags), the backend replaces the entire existing `clinic_info_settings` in the database with this partial object, effectively deleting `display_name`, `address`, and `phone_number`.

## Impact

* **Clinic Display Name:** Resets to the legal clinic name, affecting receipts and patient-facing communications.
* **Clinic Address/Phone:** These fields are also cleared whenever the Appointments settings are updated.
* **Data Integrity:** Users lose configured data without warning, leading to frustration and lack of trust in the system.

## Recommendations

1. **Frontend Fix:** Update `AppointmentsSettingsFormSchema` to either include all fields or change the submission logic to only send the fields it actually manages.
2. **Backend Patch:** Implementation of a deep merge for settings sections instead of a full override.
3. **Recovery:** The clinic `透視物理治療所 桃園青埔` has currently restored their settings, but other clinics may have silently lost their address or phone number data if they modified appointment settings recently. A database audit is recommended to find clinics with empty `display_name` but non-empty `name`.

## Proposed Fix: Implementation of JSON Merge Patch (Deep Merge)

To prevent partial updates from accidentally clearing unrelated fields in the `JSONB` settings column, we will shift from "Full Section Override" to a "Deep Merge" pattern across the backend.

### 1. Backend: Recursive Dictionary Merge

We will implement a `deep_merge` utility in the backend to handle settings updates. This ensures that if a key is missing from the incoming request, its value in the database is preserved.

**Implementation Details:**

* **Recursive:** Handles nested dictionaries (e.g., `notification_settings` inside `settings`).
* **Additive:** New fields sent by the frontend are added; omitted fields are kept as-is.
* **Explicit Deletion:** To clear a field, the frontend must explicitly send `null`.

### 2. Backend: Service Hardened with Sentinel Pattern

Inspired by the successful implementation in `MedicalRecordService`, we will adopt the `MISSING` sentinel pattern for settings updates. This allows the backend to definitively know when a field was omitted by the frontend (not intended to change) versus sent as `null` (intended to be cleared).

**Target File:** `backend/src/api/clinic/settings.py`

```python
MISSING = object()

# logic in update_settings
for section in settings_sections:
    incoming_section = settings.get(section, MISSING)
    if incoming_section is not MISSING:
        # Perform deep merge instead of assignment
        current_settings[section] = deep_merge(current_settings.get(section, {}), incoming_section)
```

### 3. Application-Wide Audit

We will apply similar fixes to other areas identified as vulnerable:

* **Practitioner Settings:** Hardening `update_practitioner_settings` in `practitioners.py`.
* **User Profile:** Ensuring `update_profile` in `profile.py` doesn't inadvertently revert settings using the same deep merge logic.

## Prevention & Regression Testing

* **Integration Test:** Add a test case to `tests/api/test_settings.py` that specifically sends a partial `clinic_info_settings` object (missing `display_name`) and asserts that the `display_name` remains unchanged in the database.
* **Frontend Schema Audit:** Align the Zod schemas in `frontend/src/schemas/api.ts` to reflect which fields are actually optional/nullable.
* **Code Review Standard:** Mandate the use of "Merge-by-default" for all `JSONB` columns to prevent data loss.

## Resolution Status (2026-02-13)

The following fixes have been implemented and verified:

1. **Backend Patch (Deep Merge):** Implemented a pure, recursive `deep_merge` utility in `backend/src/utils/dict_utils.py`. This ensures that partial JSONB updates only modify provided fields and preserve all others.
2. **Sentinel Pattern Unification:** Successfully unified the `MISSING` sentinel pattern across `settings.py`, `practitioners.py`, `profile.py`, and `medical_records.py`. This provides a consistent, application-wide mechanism to distinguish between omitted fields (no change) and fields explicitly set to `null` (clear data).
3. **Frontend Logic (Lean Schema + Passthrough):**
   * **Decision:** Adopted a "Lean Frontend" approach for `AppointmentsSettingsFormSchema`.
   * **Rationale:** Rather than manually including fields the form doesn't manage (like `display_name`), the schema now focuses strictly on managed fields and uses `.passthrough()`. This ensures Zod doesn't strip unknown data, while the backend's deep merge serves as the ultimate "defense-in-depth" to preserve non-managed data. This avoids technical debt and fragility in form state management.
4. **SQLAlchemy Persistence:** Verified that `flag_modified` is consistently applied to all JSONB column updates, ensuring SQLAlchemy correctly tracks and persists changes.
5. **Regression Testing:** A comprehensive integration test suite (`test_settings_deep_merge.py`) has been added. It reproduces the original incident conditions and verifies that the fix preserves unmanaged data while correctly handling explicit nulls.

**Next Steps:**

* **Database Audit:** Perform the database audit and recovery for any other affected clinics (Assigned to follow-up task).
* **Manual Verification:** Perform manual verification on staging/production after deployment.

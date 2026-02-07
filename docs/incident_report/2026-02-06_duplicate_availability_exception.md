# Incident Report: Duplicate Availability Exceptions

**Date:** 2026-02-06
**Reporter:** Antigravity (AI Assistant)
**Status:** Investigated & Root Cause Identified

***

## 1. Incident Overview

A production user (**羅士倫** at **透視物理治療所 桃園青埔**) reported that creating an availability exception resulted in duplicate entries appearing on the calendar. The incident was captured in a screenshot at **2026-02-06 08:14 AM Taiwan Time**.

## 2. Production Investigation Findings

* **Database Record**: Found `CalendarEvent` **ID 827** created at `2026-02-06 00:14:55 UTC` (08:14:55 AM Taiwan time), matching the screenshot.
* **ID Sequence Gap**: Investigation revealed a gap in the ID sequence. Records **825** and **826** were missing, suggesting they were the duplicate entries created concurrently and subsequently deleted by the user or admin.
* **Clinic/User Match**: Confirmed User ID 5 (羅士倫) and Clinic ID 2 (桃園青埔) matched the reported incident.

## 3. Local Reproduction Results

Temporary logging was added to both the frontend and backend to trace the execution flow during reproduction.

### Frontend Logs:

```text
AvailabilityPage.tsx:1158 [DEBUG] onCreate Exception: user_id=1, practitioner_id=1, data= {date: '2026-02-03', startTime: '12:00', endTime: '13:00', practitionerId: 1}
AvailabilityPage.tsx:1158 [DEBUG] onCreate Exception: user_id=1, practitioner_id=1, data= {date: '2026-02-03', startTime: '12:00', endTime: '13:00', practitionerId: 1}
```

* **Observation**: Rapid clicking of the "儲存休診時段" button triggered the `onCreate` function **twice** before the modal could close.

### Backend Logs:

```text
2026-02-06 22:50:19,151 [inf] [DEBUG] create_availability_exception START: user_id=1, ...
2026-02-06 22:50:19,171 [inf] [DEBUG] create_availability_exception DONE: user_id=1, calendar_event_id=822
2026-02-06 22:50:19,175 [inf] [DEBUG] create_availability_exception START: user_id=1, ...
2026-02-06 22:50:19,182 [inf] [DEBUG] create_availability_exception DONE: user_id=1, calendar_event_id=823
```

* **Observation**: The backend processed both requests sequentially within **31 milliseconds**. Since the second request started almost immediately after the first finished, no existing record was detected (as no check was performed), resulting in two distinct database entries.

## 4. Root Cause Analysis

### **A. Primary Cause (Frontend)**

The `AvailabilityPage` component lacks **submission locking**.

* The "儲存休診時段" (Save) button in the `ExceptionModal` and the "仍要建立" (Confirm) button in the `ConflictWarningModal` do not have a `loading` state or `disabled` attribute.
* This allows multiple `POST` requests to be dispatched if the user clicks quickly or if the network has high latency.

### **B. Secondary Cause (Backend)**

The `availability_exceptions` creation endpoint is **not idempotent**.

* The service faithfully creates a new record for every valid request.
* While overlapping exceptions are allowed by design, the system lacks logic to detect or prevent *identical* exceptions (same practitioner, date, and exact time window) created within a very short interval.

## 5. Resolution Strategy: Expanded Frontend UI Locking

We have decided to implement a **comprehensive frontend-only fix** to address this and similar race conditions across the `AvailabilityPage`. This approach focuses on preventing accidental multi-interactions while maintaining system simplicity.

### **Proposed Changes**

1. **State Management**: Introduce a centralized `isSubmitting` state in `AvailabilityPage.tsx`.
2. **Submission Locking**:
   * **Form Submissions**: Wrap modal save actions in a lock check.
   * **Drag-and-Drop (Silent Blocking)**: Disable all calendar drag interactions (e.g., `onDragStart`) while `isSubmitting` is true. This prevents "double-dragging" an event before the first move is confirmed by the server.
   * **Action Expansion**: Apply the lock to all state-changing actions, including **Create Exception**, **Delete Exception**, and **Cancel Appointment**.
3. **UI Feedback & Standardization**:
   * Update `ExceptionModal` and `ConflictWarningModal` to provide visual loading feedback.
   * **Standardize `ModalFooter`**: Update the core `ModalFooter` component to natively support a `loading` prop, ensuring all sub-modals can easily disable buttons and show spinners.

***

## 6. Rationale for Frontend-only Fix

During the investigation, we considered backend idempotency and database-level constraints. However, we chose a frontend-only approach for the following reasons:

* **Solving the Primary Problem**: The root cause is a UI race condition (double-clicking/double-dragging). Locking the UI directly addresses this "mechanical error" without touching the backend logic.
* **Avoiding Over-engineering**: Backend idempotency keys or unique constraints add significant complexity to the database schema. For a flexibility-first feature like availability exceptions, this complexity is not justified.
* **Preserving User Intent**: A frontend-only fix prevents *accidental* duplicates from a single click but still allows a user to intentionally create identical entries if they deliberately go through the full workflow twice.
* **Zero Migration Risk**: This fix requires no database migrations or changes to existing production data.

***

## 7. Codebase Review & Preventative Recommendations

A review of the codebase identified several other areas vulnerable to similar race conditions:

| Component / File | Vulnerable Action | Status |
| :--- | :--- | :--- |
| `AvailabilityPage.tsx` | Drag-and-Drop Exception Move | **At Risk** |
| `AvailabilityPage.tsx` | Cancel Appointment / Delete Exception | **At Risk** |
| `SettingsServiceItemsPage.tsx` | Add Service Group (`handleAddGroup`) | **Vulnerable** |
| `SettingsServiceItemsPage.tsx` | Reorder Items (`handleSaveItemOrder`) | **Vulnerable** |

### **Preventative Recommendations for Reviewer:**

* **Audit All POST/PUT Endpoints**: Check if the corresponding frontend handlers use a `loading` or `isSubmitting` state.
* **Leverage Standardized Components**: Use the newly updated `ModalFooter` `loading` prop for all new modals to ensure consistent interaction locking.
* **Adopt `SystemClinicsPage.tsx` Pattern**: Use the `creating`/`updating` state pattern found in `SystemClinicsPage.tsx` as the standard for all state-changing operations.

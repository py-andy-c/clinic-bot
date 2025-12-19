# Appointment Notification Overhaul (Post-Action Flow)

## Overview

This document describes the redesign of the appointment notification system. The core change is to decouple appointment modifications (DB updates) from patient notifications (LINE messages). Notifications will now be a **follow-up step** that occurs after a successful appointment action.

## Objectives

1.  **Reliability**: Ensure appointment changes are committed regardless of notification success.
2.  **Explicit Choice**: Provide distinct "Send" vs. "Skip" actions after the primary task is done.
3.  **Full Customization**: Enable direct editing of pre-populated message templates.
4.  **Workflow Consistency**: Standardize the process across Create, Edit, and Cancel actions.
5.  **Simplified Logic**: Replace complex, opaque backend rules with user-driven intent.

## Proposed Workflows

Every appointment-related action follows a "Commit then Notify" pattern.

### 1. Edit / Reassign Workflow
*   **Step 1: Edit Form**: User modifies details (Practitioner, Time, Type, Resources, Clinic Notes).
*   **Step 2: Review & Confirm**: 
    *   Displays a summary of changes.
    *   User clicks **[確認更動]**.
    *   **Action**: Backend updates the appointment.
*   **Step 3: Success state**:
    *   The modal shows: "預約已成功更新！"
    *   **UI**: Only has an **[X]** button to close.
*   **Step 4: Notification Flow (Triggered after closing Step 3)**:
    *   A follow-up modal appears (only if patient-facing changes were made).
    *   **Live Preview**: Editable text area pre-populated with the "Adjustment" LINE message.
    *   **Privacy Rule**: Mask originally auto-assigned practitioners as **"不指定"**.
    *   **UI**: Contains a **[傳送 LINE 訊息]** button and an **[X]** button to skip/cancel.

### 2. Create Workflow
*   **Step 1: Create Form**: User enters new appointment details.
*   **Step 2: Confirm**: 
    *   User clicks **[建立預約]**.
    *   **Action**: Backend creates the appointment.
*   **Step 3: Success state**:
    *   The modal shows: "預約已成功建立！"
    *   **UI**: Only has an **[X]** button to close.
*   **Step 4: Notification Flow (Triggered after closing Step 3)**:
    *   A follow-up modal appears.
    *   **Live Preview**: Editable preview with "Appointment Created" template.
    *   **UI**: Contains a **[傳送 LINE 訊息]** button and an **[X]** button to skip/cancel.

### 3. Delete / Cancel Workflow
*   **Step 1: Confirm Action**: 
    *   Prompt: "您確定要取消此預約嗎？"
    *   User clicks **[確認取消]**.
    *   **Action**: Backend cancels the appointment.
*   **Step 2: Success state**:
    *   The modal shows: "預約已成功取消！"
    *   **UI**: Only has an **[X]** button to close.
*   **Step 3: Notification Flow (Triggered after closing Step 2)**:
    *   A follow-up modal appears.
    *   **Live Preview**: Editable preview with "Cancellation" template.
    *   **UI**: Contains a **[傳送 LINE 訊息]** button and an **[X]** button to skip/cancel.

---

## Technical Implementation

### Backend Changes (Python/FastAPI)

#### 1. Mutation Endpoint Refactoring
Modify clinic-facing mutation endpoints to suppress automatic notifications and return a preview instead.
*   **Endpoints**: `create_clinic_appointment`, `edit_clinic_appointment`, `cancel_appointment`, `create_recurring_appointments`.
*   **Logic**:
    1.  Perform the DB update via `AppointmentService` with `skip_notifications=True`.
    2.  If successful, call a new unified helper: `NotificationService.get_action_preview(db, appointment, action_type, **kwargs)`.
    3.  Return the preview data in the response:
        ```json
        {
          "success": true,
          "notification_preview": {
            "message": "您的預約已調整...",
            "patient_id": 456,
            "event_type": "appointment_edit"
          }
        }
        ```

#### 2. Unified Notification Service Helper
Refactor `NotificationService` to centralize preview generation.
*   **Method**: `get_action_preview(db, appointment, action_type, **kwargs)`
*   **Responsibility**: Decides which template to use (Edit vs. Create vs. Cancel), applies privacy masking for auto-assigned appointments, and returns the pre-populated message.

#### 3. Unified Notification Execution Endpoint
`POST /clinic/appointments/send-custom-notification`
*   **Payload**: `patient_id`, `message`, `event_type`.
*   **Logic**: A simple wrapper around `LINEService.send_push_message` that ensures correct dashboard labeling.

### Frontend Changes (React/TypeScript)

#### 1. Modal Lifecycle Management
*   Primary action modals (Create/Edit/Cancel) close upon "Success".
*   If the response contains `notification_preview`, the parent component (e.g., `CalendarView`) triggers the `NotificationModal`.

#### 2. Notification Modal
*   A standalone, specialized modal for editing and sending the LINE message.
*   Pre-populated with the message from the backend.
*   Buttons: **[傳送 LINE 訊息]** (Primary) and **[X]** (Skip/Close).

---

## Impact Summary

| Feature | Current State | Target State |
| :--- | :--- | :--- |
| **Logic Location** | Opaque (Backend) | Transparent (Frontend) |
| **Transactionality** | Coupled (Atomic) | **Decoupled (Sequential Modals)** |
| **UX Flow** | Preview -> Save | **Action -> Success -> [Close] -> Notify** |
| **Customization** | Appended "Notes" | **Full Message Editing** |
| **Reliability** | DB save can fail if LINE fails | **DB save always independent** |

## Edge Cases

1.  **Patients without LINE**: If the mutation response lacks `notification_preview`, no follow-up modal is shown.
2.  **No-op Edits**: If an edit results in no patient-facing changes (e.g., only internal clinic notes changed), the backend returns no `notification_preview`, ending the flow at "Success".
3.  **User Abandons Step 4**: The appointment change remains saved in the DB. This is intended behavior as data integrity is the priority.
4.  **Error Handling**: If the follow-up notification fails, the user is alerted, but they are already confirmed that the appointment itself was saved successfully.

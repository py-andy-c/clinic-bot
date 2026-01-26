# Clinic Settings: UX Redesign & Engineering Plan

## 1. Executive Summary
This document outlines the redesign of the Clinic Settings module to address reliability issues (bugs during save) and user experience friction (confusion over save timing).

**Key Philosophy: "Right Tool for the Job"**
Instead of forcing a single "Save" pattern across diverse pages, we will standardize on two distinct UX patterns based on the data structure:
1.  **Form-Based Settings** (e.g., Clinic Info, Chat): Batch Save with "Draft" capability.
2.  **Collection Management** (e.g., Service Items, Resources): Atomic Save per Item via Modals.

## 2. UX Research & Design Patterns

### 2.1 The Two Interactions
We analyzed the nature of our settings pages and identified two distinct behaviors:

| Pattern | **A. Global Form (Batch)** | **B. Collection Manager (Atomic)** |
| :--- | :--- | :--- |
| **Best For** | Pages with many dependent fields where a "holistic" state matters. | Lists of independent items (Service A vs Service B). |
| **Pages** | `AI Chat`, `Booking Settings`, `Clinic Info` | `Service Items`, `Equipment/Resources` |
| **Save Action** | **"Save Changes" Bar** at the bottom (Sticky). | **"Confirm" Button** inside the Edit Modal. |
| **Cancellation** | "Discard Changes" (Reset Form). | "Cancel" button (Close Modal). |
| **Validation** | On Submit (or on Blur for specific fields). | On Modal Confirm. |
| **Dependencies** | Fields interact (e.g., Toggle enables Input). | Parent/Child (Service -> Billing). |

### 2.2 Shared UX Principles (Consistency)
Regardless of the pattern, these behaviors must be consistent:
1.  **Explicit Save**: No auto-save on keystroke. This prevents validation flashing and unintended DB writes.
2.  **Data Loss Protection**: If `isDirty` is true, attempting to navigate away or close the browser triggers a confirmation dialog ("You have unsaved changes...").
3.  **Feedback**: Success = Toast Notification ("Saved successfully"). Error = Inline red text near the field + Toast.

## 3. Pattern A: Global Form (Batch Save)
**Target Pages**: `AI Chat`, `Booking Settings`, `Clinic Info`

### 3.1 User Flow (e.g., AI Chat)
1.  User toggles "Enable Chat".
2.  User updates "Welcome Message".
3.  **"Save Changes"** bar appears (Sticky at bottom).
4.  User clicks **"Test Chatbot"**.
    *   *Improvement*: The Test Modal receives the *current form state* (dirty values), enabling true "Preview" before save.
5.  User clicks **"Save Changes"** -> `PUT /settings/chat`.
6.  User clicks **"Discard"** -> Resets form to DB state.

### 3.2 Technical Strategy
*   **React Hook Form**: Manages the "Draft" state.
*   **Dirty Tracking**: `formState.isDirty` controls the visibility of the Save Bar.
*   **API**: Keep/Refactor to resource-oriented endpoints (e.g., `PUT /api/clinic/chat-settings`).

## 4. Pattern B: Collection Management (Atomic Save)
**Target Pages**: `Service Items`, `Resources`

### 4.1 The Problem
Currently, these pages use "Batch Save" for complex nested lists (creating a Service Item, assigning Doctors, adding Prices). This requires complex in-memory state management (temporary IDs) and leads to the "Save failed" bugs we see today.

### 4.2 User Flow (e.g., Service Items)
1.  **View**: Read-only Table/List.
2.  **Edit**: Click row -> Opens **Edit Modal**.
3.  **Modify**: User edits Name, assigns Practitioners, adds Billing Scenarios inside Modal.
4.  **Save**: User clicks **"Confirm"** in Modal.
    *   **Action**: Immediate API call (`PUT /appointment-types/{id}`).
    *   **Feedback**: Modal closes, Toast shows "Service Updated", Table refreshes.
5.  **Create**: Click "Add Item" -> Opens Empty Modal.
    *   **Save**: User clicks "Confirm" -> Immediate API call (`POST /appointment-types`) with all nested data.

### 4.3 Handling Dependencies (The "Atomic Resource")
To solve the "Dependent Fields" issue (e.g., Billing Scenarios needing a Service Item ID), we treat the **Service Item + Children** as a single atomic resource.

**Create Flow (Nested Write):**
*   User adds "Physiotherapy", selects "Dr. Chen", adds "Price $500".
*   On Confirm, Frontend sends **ONE** payload:
    ```json
    {
      "name": "Physiotherapy",
      "practitioner_ids": [1],
      "billing_scenarios": [{ "practitioner_id": 1, "amount": 500 }]
    }
    ```
*   Backend performs a single transaction to create all records.

**Update Flow (Smart Diffing):**
*   User removes "Price $500", adds "Price $600".
*   Frontend sends payload without the old ID (for deletion) and without a new ID (for creation).
*   Backend reconciles differences (Delete missing IDs, Update existing IDs, Create new items).

## 5. Implementation Roadmap

### Phase 1: Foundation & Service Items (Critical Path)
1.  **Backend API**:
    *   Create `api/clinic/appointment_types.py`.
    *   Implement `POST` (Nested Create) and `PUT` (Nested Update w/ Smart Diffing).
    *   Implement `DELETE` and `reorder`.
2.  **Frontend Core**:
    *   Install `@tanstack/react-query` (already exists, ensure usage).
    *   Create `useAppointmentTypes` hooks.
3.  **Frontend UI**:
    *   Refactor `ServiceItemEditModal` to be self-contained (fetches own data or accepts full object, handles own Save).
    *   Refactor `SettingsServiceItemsPage` to be a simple "List View".

### Phase 2: Resources Page (Collection Pattern)
1.  Apply "Collection Management" pattern to `SettingsResourcesPage`.
2.  Refactor API to `api/clinic/resources` (if not already granular).

### Phase 3: Global Setting Pages (Form Pattern)
1.  Refactor `AI Chat`, `Clinic Info`, `Booking` to use the standardized "Save Bar" component.
2.  Ensure "Test" features use current form state.
3.  Verify `isDirty` navigation protection is robust across all pages.

## 6. Detailed API Specifications (Service Items)

**POST /appointment-types**
Request Body:
```json
{
  "name": "Service Name",
  "duration": 30,
  "practitioner_ids": [1, 2],
  "billing_scenarios": [
    { "practitioner_id": 1, "amount": 100 }
  ]
}
```

**PUT /appointment-types/{id}**
Request Body:
```json
{
  "name": "Updated Name",
  "practitioner_ids": [1],    // Replaces list
  "billing_scenarios": [
    { "id": 55, "amount": 200 }, // IDs provided = Update
    { "amount": 300 }            // No ID = Create
    // Missing IDs = Delete
  ]
}
```

## 7. Conclusion
This hybrid approach respects the different needs of our data. "Simple Settings" get a simple Batch Save. "Complex Collections" get robust, transactional Atomic Saves. This maximizes User Trust (no lost data) and Engineering Velocity (no complex state management).

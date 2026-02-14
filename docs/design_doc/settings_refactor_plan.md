# Design Doc: Settings Page Refactor & Best Practices

## 1. Overview

This document addresses the issues related to setting pages in the Clinic Bot application, specifically focusing on "Resource Types/Items" and "Service Item Settings". The primary concerns are:

1. **Data Integrity & Side Effects:** Handling "delete and add back" operations for list-like items (Resources) correctly to avoid breaking associations.
2. **Implementation Complexity:** Reducing the manual "temporary ID" logic in the frontend for complex nested forms (Service Items).

## 2. Resource Items: Deletion & Reactivation Strategy

### Problem Statement

When a user deletes a resource (e.g., "Room 1") and adds a new one with the same name in the same edit session, what should happen?

* If we create a **new** database record (ID: 11), the history and future appointments associated with the **old** record (ID: 10) are effectively disconnected (pointing to a soft-deleted item).
* If we **restore** the old record (ID: 10), we preserve history and associations, but we must ensure this is what the user intended.

### Current Backend Implementation

The backend (`backend/src/api/clinic/resources.py`) currently implements a **Soft Delete + Reactivation** strategy:

* When the bundle is saved, resources missing from the payload are **Soft Deleted** (`is_deleted = True`).
* When a new resource is added (no ID provided), the backend checks if a soft-deleted resource with the same name exists.
* If found, it **Reactivates** the old resource (`is_deleted = False`).

### Resolving "Shadow Name" Conflicts

A "Shadow Conflict" occurs when a user renames "Room B" to "Room A", but a soft-deleted "Room A" already exists. Since the database enforces unique names (including deleted ones), this currently causes a database error.

**Strategy:**

* When a name conflict occurs with a **soft-deleted** item during a **rename** or **creation of a truly new ID**:
  1. The backend will automatically rename the *soft-deleted* item by appending a timestamp/suffix (e.g., `Room A (deleted-171...)`).
  2. This "frees up" the name for the new/active record while preserving the historical link for the deleted record's ID.

### Recommendation

**We should maintain the Reactivation behavior.** It is the industry best practice for systems where historical data integrity (appointments) is critical.

* **Why?** "Room 1" is a physical entity. If the user deletes it and adds it back, they are likely correcting a mistake or updating its description, not replacing the physical room.
* **Side Effects:** This approach *prevents* unexpected side effects. Appointments assigned to "Room 1" will continue to work seamlessly if "Room 1" is restored.

## 3. Service Item Settings: Reducing Complexity

### Problem Statement

The "Service Item" settings modal manages multiple nested lists: Billing Scenarios, Resource Requirements, and Follow-up Messages.

Currently, the frontend manually generates "temporary IDs" (large integers) to track new items before they are saved. This leads to complex manual state management and synchronization logic.

### Proposed Solution: Standardize on `useFieldArray`

We will refactor `ServiceItemEditModal` to fully utilize `react-hook-form`'s `useFieldArray` hook.

#### 1. Architecture Change

Instead of maintaining separate state (`followUpMessages`, `billingScenarios`) and syncing them, we will:

1. Define the entire form schema (including nested arrays) in `ServiceItemEditModal`.
2. Use `useFieldArray` for each section.
3. Pass the `fields` and array methods to sub-components (`FollowUpMessagesSection`, etc.).

#### 2. Formalizing the API Contract

We will move away from magic number thresholds (`TEMPORARY_ID_THRESHOLD`).

* **New Contract:** The API will treat the presence of a real integer `id` as an **Update** request. The absence or `null` value of the `id` field will be treated as a **Create or Reactivate** request.
* **Cleanup:** Once the frontend refactor is verified, the `TEMPORARY_ID_THRESHOLD` constants and checks will be removed from the backend.

### Comparison

| Feature | Current (Manual) | Proposed (`useFieldArray`) |
| :--- | :--- | :--- |
| **State Management** | Manual `useState` + Props passing | Automatic via `useForm` |
| **New Item ID** | Manual `generateTemporaryId()` | Handled by `useFieldArray` internal UUID |
| **Code Complexity** | High (Synchronization logic) | Low (Declarative) |
| **Validation** | Manual custom validation | Integrated Zod + React Hook Form |

## 4. Implementation Plan

### Phase 1: Backend Refinement

1. **Shadow Conflict Fix:** Update `_sync_resource_type_resources` and `_sync_service_item_associations` to handle soft-deleted name collisions by suffixing the deleted item.
2. **ID Logic Cleanup:** Update `_is_real_id` logic to eventually stop relying on thresholds and strictly use `id is not None`.

### Phase 2: Frontend Refactor

1. **Refactor `ServiceItemEditModal`**:
   * Remove manual array updates for all associations.
   * Setup `useFieldArray` hooks for `billing_scenarios`, `resource_requirements`, and `follow_up_messages`.
2. **Refactor Sub-Components**:
   * **BillingScenarioSection:** Update to receive the flat `fields` and filter them by `practitioner_id` for rendering.
   * **FollowUpMessagesSection / ResourceRequirementsSection:** Remove internal `useState` that mirrors props; use `fields` from parent.
3. **UX Improvement:** Add a Toast notification: *"已復原既存的項目「{name}」"* when the backend response indicates a reactivation (ID matched by name).

### Phase 3: Verification & Cleanup

1. Verify that "Delete & Add Back" behaves correctly across all entities.
2. Remove `generateTemporaryId` utility and all references to `TEMPORARY_ID_THRESHOLD`.

## 5. Summary

The refactor stabilizes the system by leveraging robust library patterns (`useFieldArray`) and correcting a latent database constraint bug (Shadow Conflict). This reduces the frontend code volume significantly and makes the API contract more standard.

# Design Doc: Clinic Settings Redesign (Atomic & Batch Patterns)

## Status
- **Reviewers**: @andy
- **Author**: Antigravity
- **Last Updated**: 2026-01-26

## 1. Problem Statement

The current clinic settings pages (especially Service Items) suffer from high implementation complexity. Adding a new field is error-prone, requiring changes across multiple stores, mappers, and API calls. The "Batch Save" model currently relies on brittle change detection across massive global stores and "Temporary ID" management, leading to frequent bugs and data loss.

### 1.1 Specific Complexities Pinpointed
1.  **Brittle Global Staging**: Tracking changes across seven disparate pages in one context leads to race conditions and "save button" visibility bugs.
2.  **Temporary ID Management**: Creating entities that don't exist on the server yet requires complex "relay race" orchestration on the frontend.
3.  **Safety vs. Fluidity**: Auto-saving text areas is dangerous as updates are pushed prematurely to patient-facing interfaces while the admin is still editing.

---

## 2. Proposed Architecture: Two Standard Patterns

We will standardize the entire settings system into two predictable interaction patterns. This reduces technical complexity by 80% while maximizing user safety.

### 2.1 The "Entity Modal" Pattern (Complex Aggregates)
**Target Pages**: Service Items, Resources.
-   **Interaction**: Click [Edit] or [Add] -> Opens a Modal/Drawer.
-   **Save Timing**: Clicking "Save" inside the modal triggers an **Atomic Bundle Save**.
-   **Persistence**: The backend receives a complete nested JSON object and updates the entity and all its associations (Billing Scenarios, Practitioner Appointment Types, Resources) in a single transaction.
-   **Benefit**: No Temporary IDs. No staging stores. Safe configuration of complex dependencies.

### 2.2 The "Page-Level Batch" Pattern (Flat Settings)
**Target Pages**: Appointments, Reminders, Clinic Info, Receipts, AI Chat.
-   **Interaction**: Direct editing on the page (toggles, text areas).
-   **Save Timing**: A **Sticky Save Bar** appears at the bottom of the viewport as soon as any change is detected.
-   **Actions**: `[ 捨棄變更 (Discard) ]` `[ 儲存變更 (Save Changes) ]`.
-   **Benefit**: Protects long-form text editing. Provides a consistent "Sandbox" feel where users can verify all page-level changes (especially for Chatbot testing) before committing.

### 2.3 Immediate Structural Actions
Structural changes that are not "content edits" happen immediately with confirmation:
-   **Reordering**: Drag-and-drop auto-saves order via a dedicated bulk-update API.
-   **Deletion**: Clicking "Delete" (with confirm) hits the API immediately.

---

## 3. Deep Dive: Service Item Aggregate Saving

To solve the nested dependency problem (Service Item > Practitioner Appointment Type > Billing Scenario), we adopt the "Aggregate Root" pattern.

### 3.1 The "Bundle" API Contract
**Endpoint**: `POST /api/settings/service-items/bundle` (Create) or `PUT /api/settings/service-items/{id}/bundle` (Update).

**Payload**:
```json
{
  "item": { "name": "Consultation", "duration_minutes": 60, "service_type_group_id": 5 },
  "associations": {
    "practitioner_ids": [101, 102],
    "billing_scenarios": [
      { "practitioner_id": 101, "name": "Standard", "amount": 1000 }
    ],
    "resource_requirements": [{ "resource_type_id": 2, "quantity": 1 }],
    "follow_up_messages": [{ "timing_mode": "hours_after", "hours_after": 24, "message_template": "..." }]
  }
}
```

### 3.2 Backend Sync Logic
The backend must sync the associations in a single transaction:
1.  **Practitioner Appointment Type Sync**: Delete old assignments, create new ones.
2.  **Billing Scenario Sync**: Use IDs for existing records, match by attributes for deletion of missing records.
3.  **Result**: 100% data integrity. The frontend no longer manages the "relay race".

---

## 4. Specific Page Redesign Walkthrough

### 4.1 服務項目 (Service Items)
- **Main View**: Drag-and-drop sortable list.
- **Action**: [Edit] opens Modal. Modal handles all associations.
- **Saving**: Manual "Save" inside modal.

### 4.2 預約設定 (Appointments)
- **Content**: Patient instructions (text areas) and booking rules (toggles).
- **Saving**: Page-level Batch with Sticky Bar. 

### 4.3 診所資訊 (Clinic Info)
- **Content**: Basic info (Name, Address, Phone).
- **Saving**: Page-level Batch with Sticky Bar.

### 4.4 LINE 提醒 (Reminders)
- **Content**: Reminder timing and change notification settings.
- **Saving**: Page-level Batch with Sticky Bar.

### 4.5 AI 聊天 (Chat)
- **Content**: Bot personality and booking logic.
- **Saving**: Page-level Batch with Sticky Bar.
- **Testing**: "Test Chatbot" button uses the *current local state* (unsaved) for the simulation.

### 4.6 收據設定 (Receipts)
- **Content**: Receipt templates and stamp settings.
- **Saving**: Page-level Batch with Sticky Bar.

### 4.7 設備資源 (Resources)
- **Redesign**: Resource Type and its Resources are managed in a single **Aggregate Modal**.
- **Saving**: Manual "Save" inside modal.

---

## 5. Technical Implementation: Backend (FastAPI/SQLAlchemy)

### 5.1 Transactional "Bundle" Endpoints
The backend will implement new `bundle` endpoints to handle the "Aggregate Root" saving logic.

**Pattern: Service Items Bundle**
```python
@router.put("/service-items/{id}/bundle")
async def update_service_item_bundle(id: int, bundle: ServiceItemBundleRequest, db: Session):
    with db.begin(): # Single Transaction
        # 1. Update basic item details
        item = db.query(AppointmentType).get(id)
        update_model(item, bundle.item)
        
        # 2. Sync Practitioner Assignments (Full Replace)
        # Delete existing associations NOT in practitioner_ids
        # Add new associations in practitioner_ids
        sync_practitioner_assignments(item, bundle.associations.practitioner_ids)
        
        # 3. Sync Billing Scenarios (Diff-based Update)
        # Use provided IDs to update existing
        # Delete missing IDs
        # Create new records (no ID)
        sync_billing_scenarios(item, bundle.associations.billing_scenarios)
        
        # 4. Sync Resource Requirements & Follow-up Messages
        sync_resource_requirements(item, bundle.associations.resource_requirements)
        sync_follow_up_messages(item, bundle.associations.follow_up_messages)
```

### 5.2 Page Bundle Endpoints
For "Flat" settings pages, we will provide a consolidated `SettingsUpdate` endpoint that accepts partial updates for specific settings sections (Clinic Info, Notification Settings, etc.).

---

## 6. Technical Implementation: Frontend (React/Zustand/TanStack Query)

### 6.1 Transitioning from SettingsContext to TanStack Query
We will move away from the centralized `SettingsContext` (which triggers global re-renders and staging complexity) to a **Query-Per-Page** model.

1.  **Query**: Use `useQuery(['clinic-settings'])` to fetch the baseline.
2.  **Mutation**: Use `useMutation` for the bundle saves.
3.  **Invalidation**: Broadly invalidate the query path after any successful mutation to ensure all components see the updated server state.

### 6.2 The "Sticky Save Bar" Component
A reusable `SettingsActionFooter` component that:
-   Displays when the active form's `isDirty` state is true.
-   Provides "Discard" (form `reset()`) and "Save" (form `handleSubmit()`) actions.
-   Remains sticky to the bottom of the viewport to ensure visibility on long pages.

### 6.3 Standardizing Modals
All complex entity modals (Service Items, Resources) will now:
-   Own their own internal `react-hook-form` instance.
-   Own their own "Save" mutation.
-   Perform full validation (Zod) before even hitting the API.
-   Close only upon successful completion.

---

## 7. Implementation Phases

To minimize risk and ensure stability, the redesign will be rolled out in four phases.

### Phase 1: Infrastructure & "Structural" Cleanup
-   **Backend**: Implement the new `ServiceItemBundle` and `ResourceTypeBundle` endpoints.
-   **Frontend**: Create the `SettingsActionFooter` (Sticky Bar) component.
-   **Frontend**: Change "Reorder" and "Delete" actions to hit API immediately with a reload trigger.
-   **Milestone**: Baseline architecture is ready.

### Phase 2: Page-Level Standardization (Flat Pages)
-   **Target**: Appointments, Reminders, Clinic Info, Receipts.
-   **Action**: Convert these pages to use the `SettingsActionFooter` and standard `react-hook-form` logic.
-   **Cleanup**: Remove these sub-stores from the `SettingsContext`.
-   **Milestone**: All simple settings are protected by the new batch-save pattern.

### Phase 3: Entity Modal Consolidation (The "Heavy Lift")
-   **Target**: Service Items and Resources.
-   **Action**:
    -   Rewrite `ServiceItemEditModal` to handle its own associations.
    -   Combine Resource Type and Resources into a single modal.
-   **Cleanup**: **Delete** `ServiceItemsStagingStore.ts` and `ServiceItemsStore.ts`.
-   **Milestone**: 80% of current technical debt is removed.

### Phase 4: Full Context Migration & Final Cleanup
-   **Action**: Migrate any remaining settings (like Chat) to the new pattern.
-   **Action**: Final removal of `SettingsContext` in favor of pure TanStack Query hooks.
-   **Action**: Audit all settings endpoints and remove no-longer-needed granular update endpoints.
-   **Milestone**: Settings module is 100% consistent and maintainable.

---

## 8. Appendix: Scalability Options

- **Sub-Feature Detail Pages**: If "Follow-up Messages" grow to 20+ fields, create a dedicated sub-page: `Settings > Service Items > [ID] > Follow-up Rules`.
- **Draft Status**: For extra safety, add a `is_active` toggle to Service Items so they can be saved but kept hidden from patients until "Published".
- **Advanced Permissions**: Atomic endpoints allow for easier permission gating (e.g., "Practitioner can only edit their own Billing Scenarios").

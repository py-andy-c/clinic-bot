# Medical Record System Refactor Proposal

## 1. Problem Statement

The current EMR (Electronic Medical Record) creation and editing flow has several UX and architectural limitations:

1. **Template Switching & Data Loss**:
   * **Current State**: The `MedicalRecordModal` allows users to select a template, fill out fields, and then inadvertently switch templates, which instantly clears all entered data.
   * **Ideal State**: A medical record's template should be immutable after creation to preserve data integrity and prevent accidental data loss.

2. **Creation vs. Editing Ambiguity**:
   * **Current State**: The same large modal is used for both "Quick Create" and "Deep Editing". This conflates two distinct mental modes.
   * **Issue**: Creating a record implies *initializing* a structure (Template + Patient + Appointment). Editing implies *documenting* the clinical encounter. Mixing them causes UI clutter (e.g., changing appointments mid-edit) and logic complexity.

3. **Cramped Editing Experience**:
   * **Current State**: Editing happens in a modal.
   * **Issue**: For complex templates with long text areas and multiple photos, modals feel transient and cramped. They risk accidental closure (though we have navigation guards). A full-page experience is standard for professional EMRs to support focused documentation.

4. **"Required Fields" Paradox**:
   * **Current State**: Fields marked "Required" in the template must be filled *immediately* upon creation.
   * **Issue**: This blocks the "Initialize -> Edit Later" workflow. Clinicians often want to open a record (initialize) before the patient walks in, but can't save it because they haven't filled in the diagnosis yet.

***

**Reference**: This proposal refines the original design documented in [Medical Record System - Business Logic & Technical Design](./medical_record_system.md).

## 2. Proposed Architecture: "Initialize-Then-Document"

We propose splitting the medical record lifecycle into two distinct phases: **Initialization** and **Documentation**.

### Phase 1: Initialization (The "New Record" Modal)

A small, lightweight modal solely for establishing the record's context.

* **Inputs**:
  * **Patient** (Implicit if on Patient Detail Page)
  * **Template** (Required, Immutable)
  * **Appointment** (Optional, Immutable-ish)
* **Action**: `Create` button.
* **Outcome**:
  * Creates a new `MedicalRecord` in the database.
  * **Modal Closes**.
  * The new record appears at the top of the Patient's Medical Record List.
  * User can then click the record to enter the **Full Page Editor**.

### Phase 2: Documentation (The "Full Page Editor")

A dedicated route (e.g., `/emr/:recordIdentifier`) for viewing and editing the clinical note.

* **UI Features**:
  * **Full Screen**: Maximizes real estate for text and photos.
  * **Fixed Header**: Shows Patient Info, Template Name, and Appointment Context.
    * *Appointment Editing*: Users can edit the associated appointment via a dropdown in the header. Changes save together with form content (not immediately).
  * **Auto-Save Ready**: A persistent page is safer for implementing V2 auto-save than a modal.
* **Validation Logic**:
  * **Calculated Flexibility**: All fields are treated as optional in the backend. Users can save partial or empty records at any time.
  * **"Required" Metadata Preservation**: We **retain** the `required` property in the Template Schema. This allows the UI to show visual hints (red asterisks) to guide the doctor, but the submission validator will **ignore** strict enforcement for V0.

### 2.3 Benefit: Simplification of Photo Lifecycle

The "Initialize-Then-Document" flow simplifies photo management by ensuring the record exists before photos are uploaded.

**Old Logic (No Record ID)**:
- Modal-based creation meant no record ID until save
- Photos uploaded to temporary storage
- Complex commit logic on modal save
- Garbage collection needed for abandoned modals

**New Logic (Staged Upload with Record ID)**:
- Record created *before* editor opens (has valid ID)
- Photos uploaded with `is_pending=true` and linked to record ID
- Photos remain staged until user clicks "Save"
- On save: Backend commits photos by setting `is_pending=false`
- On discard: Staged photos remain in database but can be garbage collected

**Why Staging with `is_pending`?**

We chose the "staging" approach for these reasons:

1. **Consistent with "Unsaved Changes" Semantics**: 
   - Upload = stage (not commit)
   - Save = commit everything (form + photos)
   - Discard = abandon staged changes
   - Clear mental model: nothing persists until "Save"

2. **Backend Already Implements It**: 
   - `MedicalRecordService.create_record()` and `update_record()` already handle photo commit via `attach_photos_to_record()`
   - Sets `is_pending=false` and links photos atomically
   - No code changes needed!

3. **Prevents Phantom Attachments**:
   - If user uploads photos then discards, photos remain staged (not visible in record)
   - Garbage collection can clean up old staged photos periodically
   - No confusion about "why are these photos here?"

4. **True "All or Nothing" Save**:
   - User expects "Save" to commit everything
   - User expects "Discard" to abandon everything
   - Staging approach matches these expectations

**Photo Lifecycle Flow:**

```
1. User uploads photo
   → Backend: is_pending=true, medical_record_id=123
   → Frontend: Photo appears in selector (staged)

2. User clicks "Save"
   → Frontend: Sends photo_ids=[1,2,3]
   → Backend: Sets is_pending=false for these photos
   → Photos now committed and visible in record

3. User clicks "Discard" (or closes browser)
   → Staged photos remain in database with is_pending=true
   → Garbage collection job cleans up old pending photos
   → No phantom attachments in record
```

This approach provides clear semantics and matches user expectations for document editing.

### 2.4 Benefit: Impact on Future Features

* **Auto-Save (V3)**:
  * **Old**: Auto-saving a transient modal is complex (where do you store the draft? localStorage? temporary DB row?).
  * **New**: Auto-saving a real DB record is trivial. We just issue `PUT` requests to the existing record ID in the background.
* **Conflict Prevention (V2)**:
  * **Old**: We couldn't "lock" a record being created because it had no ID.
  * **New**: As soon as a user enters the editor, we have a Record ID. We can easily broadcast "User A is editing Record #123" to prevent others from opening it.

***

## 3. Detailed Design

### 3.1 Database & API Changes

**Template Schema Update**:

* **Keep** `required` property in `TemplateField` structure (Do not delete it).
* **Usage**: Frontend uses this purely for UI decoration (`*` label), not for blocking submission.

**API Adjustments**:

* `POST /medical-records` & `PUT /medical-records`:
  * Remove any server-side validation that enforces presence of fields.
  * Accept partial or empty `values`.

### 3.2 UI Flow

**Old Flow**:

1. Click "New Record".
2. Modal Opens.
3. Select Template -> Select Appt -> Fill ALL Fields -> Upload Photos.
4. Click Save. (Do all this in one go).

**New Flow**:

1. Click "New Record".
2. **Small Modal Opens**: Select Template & Appointment.
   * *Smart Pre-selection*: The modal retains the logic to auto-select today's appointment.
3. Click "Create".
4. **Modal Closes**. New record appears in the list.
5. User clicks the record card.
6. **Navigates to `/patients/:id/records/:id`**.
7. User edits and clicks "Save".

### 3.3 Addressing Feedback

* **Orphaned Records**: Empty records are visually indicated with an "空白" (Empty) badge in the record list. Users can manually delete them if created by mistake.
* **Navigation Safety**: The new page includes a prominent back arrow button to return to the patient detail page.
* **Simplified Actions**: Record lists use a single "開啟" (Open) button instead of separate View/Edit buttons, as all records open in the same full-page editor.

### 3.3 Pros & Cons

| Feature | Pros | Cons |
| :--- | :--- | :--- |
| **Separation of Init/Edit** | Prevents template switching data loss. Clarifies intent. | Adds one extra click/navigation step. |
| **Full Page Editor** | Better focus. More space for photos/history. Safer for auto-save. URL shareable. | Losing context of the "Patient Detail Page" (though we can open in new tab or have a breadcrumb). |
| **Removal of "Required"** | Allows "Create Empty -> Edit Later" seamlessly. Simplifies validation logic. | Losing system guarantee of data completeness. |

### 3.4 Features to Port (Parity Check)

To maintain feature parity, the following logic from `MedicalRecordModal.tsx` must be preserved in the new architecture:

1. **Conflict Resolution (Optimistic Locking)**:
   * Detects 409 errors on save.
   * Displays modal offering "Reload" (overwrite local) or "Force Save" (overwrite server).
2. **Unsaved Changes Detection**:
   * Uses `useUnsavedChangesDetection` to warn users before navigating away or closing the page.
   * Tracks both form changes and photo changes for accurate dirty state.
3. **Dynamic Schema Generation**:
   * Logic to build Zod schemas based on field types (Date, Checkbox, Number).
   * **Modification**: Updated to ignore the `required` flag for validation purposes.
4. **Smart Appointment Pre-selection**:
   * *Port Location*: Moves to the **Initialization Modal**.
   * Logic: Priority 1 (Today), Priority 2 (Recent Past), Priority 3 (None).
5. **Appointment Editing**:
   * *Port Location*: Available in the **Full Page Editor**.
   * Appointment can be changed via dropdown in header.
   * Changes save together with form content (part of form state).
6. **Photo Selector Integration**:
   * Reuses `MedicalRecordPhotoSelector`.
   * Simplifies logic as `record_id` is guaranteed to exist at upload time.
7. **Empty Record Indication**:
   * Records with no content show "空白" (Empty) badge in lists.
   * Helps users identify records that need documentation.

***

## 4. Migration Strategy (from V0)

Since we are still in early development (V0), we can pivot relatively easily.

1. **Backend**:
   * (No database migration needed).
   * Ensure `MedicalRecordService` validation is relaxed (or non-existent).
2. **Frontend**:
   * Rename `MedicalRecordModal` to `CreateRecordDialog` (simplifies to just template/appt selection).
   * Create `MedicalRecordPage` (new route).
   * Update `createDynamicSchema` to mark all fields as `.optional()` regardless of the template's `required` flag.

## 5. Recommendation

**Strongly Recommend** moving to the **Page-Based Editor with Relaxed Validation**.
The current modal-heavy approach will hit a usability ceiling very quickly as we add more complex features (like drawing on diagrams, rich text, or massive photo galleries). Starting with a page-based structure now sets the correct foundation for a robust EMR system.

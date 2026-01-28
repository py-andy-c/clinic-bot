# PR Description: Modal Standardization & Aesthetic Alignment

## 📝 Summary

This PR completes the comprehensive standardization of the modal system across the clinic-bot platform. Guided by the new `docs/design_doc/modal_standardization.md`, we have refactored 20+ modals to ensure aesthetic consistency, improved mobile responsiveness, and a unified interaction model.

## 🚀 Key Changes

### 1. Component Standardization

* Migrated all active modals to use the `ModalParts` architecture (`ModalHeader`, `ModalBody`, `ModalFooter`).
* Enforced a **"Single Scroll Region"** principle: only the `ModalBody` scrolls, while Header and Footer remain pinned.
* Standardized padding (`px-6`, `py-3` / `py-4`) and border styling across all modal sections.

### 2. Visual & Semantic Buttons

* Replaced custom button styles with global utility classes: `.btn-primary`, `.btn-secondary`.
* Introduced and utilized semantic primary button variations for critical actions:
  * `.btn-primary-red` (Voiding, Deletion, Cancellation)
  * `.btn-primary-yellow` (Conflict Warnings)
  * `.btn-primary-green`, `.btn-primary-orange`, `.btn-primary-purple` (Status-specific colors)

### 3. Unified Close Policy

* Standardized the presence of the top-right "X" close button in `ModalHeader` for all modals, even those with "Cancel" actions in the footer, to ensure navigational consistency.
* Corrected `BaseModal` implementations to handle conditional rendering and scroll prevention properly.

### 4. Comprehensive Documentation

* Updated `docs/design_doc/modal_standardization.md` with:
  * A **Standardization Checklist** tracking the status of every modal.
  * A **Platform Mapping** (Clinic vs. LIFF) and **Example Page** column for easier auditing.
  * A technical breakdown of the **Code Reuse Pattern** for `BaseModal`.

***

## ✅ Refactored Modal Checklist

### **Calendar Flows**

* \[x] `calendar/NotificationModal`
* \[x] `calendar/ConflictModal`
* \[x] `calendar/ConflictWarningModal`
* \[x] `calendar/PractitionerSelectionModal`
* \[x] `calendar/ServiceItemSelectionModal`
* \[x] `calendar/EditAppointmentModal`
* \[x] `calendar/CreateAppointmentModal`
* \[x] `calendar/CheckoutModal`
* \[x] `calendar/EventModal`
* \[x] `calendar/ExceptionModal`
* \[x] `calendar/CancellationNoteModal`
* \[x] `calendar/CancellationPreviewModal`
* \[x] `calendar/ReceiptListModal`
* \[x] `calendar/ReceiptViewModal`

### **Settings & Patient Flows**

* \[x] `ResourceTypeEditModal`
* \[x] `MessagePreviewModal`
* \[x] `PatientCreationModal`
* \[x] `PatientCreationSuccessModal`
* \[x] `PractitionerAssignmentPromptModal`
* \[x] `PractitionerAssignmentConfirmationModal`

### **Shared Elements**

* \[x] `ModalContext` (Global Alert/Confirm)
* \[x] `shared/InfoModal`

***

## 🔍 Reviewer Note

> **Critical Audit Request**: While we have performed a sweep for all visible modal components, please double-check if any legacy or edge-case modals were missed during this refactor. If you encounter a modal that feels "off" (different padding, non-standard buttons, or double scrollbars), please flag it for inclusion!

## 🧪 Testing

* Ran `./run_tests.sh` (Frontend: ✅ PASSED).
* Manually verified modal layouts on both desktop and mobile viewports.

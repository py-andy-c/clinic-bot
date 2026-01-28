# Modal Standardization

Owners: Frontend Platform
Status: Final (v1)
Last updated: 2026-01-27

## Migration Status: ✅ **COMPLETE**

All modal components have been successfully migrated to use the standardized `BaseModal` + `ModalParts` architecture:

- **40 modal components** standardized across calendar, settings, patient flows, system admin, and internal components
- **3 custom modal implementations** migrated (MembersPage InviteModal, MembersPage EditRolesModal, SystemClinicsPage CreateClinicModal)
- **1 dead component removed** (ValidationSummaryModal)
- **1 LIFF modal left unchanged** (AppointmentList receipt modal - requires custom implementation for LINE app context)

The modal standardization is now 100% complete for the main application.

## Goals

* **Space-efficient**: maximize usable content area, minimize redundant padding/margins, avoid double scrollbars.
* **Aesthetic**: clean, balanced spacing, consistent hierarchy across all modals.
* **Consistent**: one mental model for structure, spacing, and behavior across settings, calendar, and shared modals.
* **Great UX**: clear actions, persistent access to primary buttons, predictable close behavior, mobile-friendly.

## Scope

Standardizes all usages of `BaseModal` and modal-like UIs, including:

* Settings modals (e.g., ResourceType, ServiceItem, message previews)
* Calendar modals (create/edit/selection/confirmation/receipt)
* Shared info/alert/confirm dialogs

***

## Core Principles

* **Single scroll region**: only the Body should scroll. Header and Footer remain visible.
* **One source of spacing**: avoid stacked paddings. Use section-level paddings; do not pad container and sections simultaneously.
* **Clear action affordances**: primary and secondary actions live in the Footer; close affordance policy is consistent (see Close Policy).
* **Responsive width**: modals expand sensibly without feeling cramped; safe margins on small screens.
* **Accessible behaviors**: keyboard support, ARIA labels, focus handling, and predictable escape/overlay behavior.

***

## Anatomy

A modal has up to three sections in this order:

* **Header** (`ModalHeader`)
  * Purpose: title and optional description/contextual actions.
  * Style: `px-6 py-3 border-b flex items-center`
  * Typography: `text-lg font-semibold` by default.
  * Optional right-side close button. If present: placed inline as the header's right-aligned element, vertically centered.

* **Body** (`ModalBody`)
  * Purpose: main content.
  * Style: `px-6 py-4 flex-1 min-h-0 overflow-y-auto` (this is the only scrollable region).
  * Internal rhythm: prefer `space-y-4` or `space-y-6`; avoid adding additional containers with their own max-height/overflow.

* **Footer** (`ModalFooter`)
  * Purpose: actions.
  * Style: `px-6 py-3 border-t flex justify-end space-x-3`.
  * Sticky feel (optional): `sticky bottom-0 bg-white/95 backdrop-blur supports-[backdrop-filter]:backdrop-blur z-10`.

The modal container (`BaseModal` panel) should be `flex flex-col overflow-hidden max-h-[90dvh] min-h-0` so only Body can scroll.

***

## Sizing and Widths

* **Size variants** for non-fullscreen modals:
  * **Small (`size="sm"`):** `sm:max-w-md md:max-w-lg` (384px, 512px) - Best for alerts, confirmations, simple actions
  * **Medium (`size="md"`):** `sm:max-w-lg md:max-w-xl lg:max-w-xl` (512px, 688px, 688px) - Default for most use cases
  * **Large (`size="lg"`):** `sm:max-w-xl md:max-w-2xl lg:max-w-2xl` (448px, 672px, 672px) - Best for complex forms, detailed content
* **Fullscreen flows**: use `fullScreen` in `BaseModal` and manage layout with their own header/body/footer but keep the same principles.
* **Constraint**: Do not set widths on inner wrappers; width is a responsibility of the modal container.
* **Mobile margins**: Maintained at `mx-4` (16px) for optimal content space on small screens.

***

## Close Policy (X vs 取消/關閉)

To ensure consistency across the platform:

* **Informational Modals**: Show the top-right "X" for dismissal.
* **Form Modals with Actions**: Show the top-right "X" for consistency (`showClose={true}` in `ModalHeader`).
* **Confirmation Modals**: Usually no "X"; force a "Yes/No" or "Confirm/Cancel" decision (optional "X" if appropriate).
* **Automation**: `BaseModal` automatically hides its own absolute-positioned close button if it detects a `ModalHeader` child (via `displayName`), preferring the header-integrated close button for a cleaner layout.
* **Localization**: All close buttons and aria-labels use the `common.close` translation key.
* **Interaction**: `Esc` maps to cancel behavior; overlay click-to-close is disabled by default for safety.

***

## Interaction and Accessibility

* `Esc` closes when safe; must invoke the same onCancel/unsaved-change logic as footer "Cancel".
* Focus management: initial focus set to the first primary action or a meaningful input.
* Trap focus within the modal (handled by `useFocusTrap` where applicable).
* Provide `aria-label` or `aria-labelledby` on `BaseModal` for screen readers.
* Ensure minimum hit target sizes (36–40px) for close buttons and actions.

***

## Scroll Strategy

* Only the Body scrolls. Avoid nested scroll containers within Body.
* If an inner section must scroll independently (rare), ensure it does not hide the Footer or create double scrollbars.
* Add `min-h-0` on flex parents and children involved in scrolling to allow proper flex shrinkage.

***

## Visual Style

* Header typography: `text-lg font-semibold`.
* Form field rhythm: prefer `space-y-4` and keep labels concise.
* Dividers: use `border-b` for header and `border-t` for footer.
* Close button style: minimal ghost/tertiary; avoid heavy shadows.

***

## Code Reuse & Component Hierarchy

To ensure consistency and reduce duplication, we use a tiered component strategy:

1. **`BaseModal` (Foundational)**
   * **File**: `frontend/src/components/shared/BaseModal.tsx`
   * **Responsibility**: Handles the "modal-ness" (Portals, Overlay, Scroll locking, Escape key, Back button support).
   * **Smart Close Button**: Automatically hides its built-in "X" if `ModalHeader` is used as a child.

2. **`ModalParts` (Structural)**
   * **File**: `frontend/src/components/shared/ModalParts.tsx`
   * **Responsibility**: Defines `ModalHeader`, `ModalBody`, and `ModalFooter`.
   * **Standardization**: Enforces the padding (`px-6`), borders, and flex layout.

3. **`InfoModal` & `Dialogs` (Derived)**
   * **Files**: `shared/InfoModal.tsx`, `contexts/ModalContext.tsx`
   * **Responsibility**: High-level abstractions for common patterns (Help info, Alert/Confirm).

***

## Standardization Checklist & Status

| Modal Component | Status | Layout Type | `ModalParts` Used? | Platform | Example Page / Usage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Shared / Context** | | | | | |
| `ModalContext` (Alert/Confirm) | ✅ Done | Standard | Yes | Both | Global (Alerts/Confirms) |
| `shared/InfoModal` | ✅ Done | Standard | Yes | Clinic | Settings (Help/Info Tooltips) |
| **Calendar Flows** | | | | | |
| `calendar/NotificationModal` | ✅ Done | Standard | Yes | Clinic | Calendar (Pending notifications) |
| `calendar/ConflictModal` | ✅ Done | Standard | Yes | Clinic | Calendar (Drag-and-drop conflicts) |
| `calendar/ConflictWarningModal` | ✅ Done | Standard | Yes | Clinic | Calendar (Force-create warnings) |
| `calendar/PractitionerSelectionModal`| ✅ Done | Standard | Yes | Clinic | Calendar (Create/Edit flow) |
| `calendar/ServiceItemSelectionModal` | ✅ Done | Standard | Yes | Clinic | Calendar (Create/Edit flow) |
| `calendar/EditAppointmentModal` | ✅ Done | Multi-step | Yes | Clinic | Calendar (Edit form) |
| `calendar/CreateAppointmentModal` | ✅ Done | Multi-step | Yes | Clinic | Calendar (Create form) |
| `calendar/CheckoutModal` | ✅ Done | Standard | Yes | Clinic | Calendar (Checkout flow) |
| `calendar/EventModal` | ✅ Done | Standard | Yes | Clinic | Calendar (Event details) |
| `calendar/ExceptionModal` | ✅ Done | Standard | Yes | Clinic | Calendar (Off-time creation) |
| `calendar/CancellationNoteModal` | ✅ Done | Standard | Yes | Clinic | Calendar (Cancellation flow) |
| `calendar/CancellationPreviewModal` | ✅ Done | Standard | Yes | Clinic | Calendar (Cancellation flow) |
| `calendar/ReceiptListModal` | ✅ Done | Standard | Yes | Clinic | Calendar (Receipt management) |
| `calendar/ReceiptViewModal` | ✅ Done | Fullscreen | Yes | Clinic | Calendar (Receipt viewing/voiding) |
| **Settings / Patient Flows** | | | | | |
| `ResourceTypeEditModal` | ✅ Done | Standard | Yes | Clinic | Settings > Resources |
| `MessagePreviewModal` | ✅ Done | Standard | Yes | Clinic | Settings > Service Items |
| `ServiceItemEditModal` | ✅ Done | Fullscreen | Yes | Clinic | Settings > Service Items |
| `PatientCreationModal` | ✅ Done | Standard | Yes | Clinic | Patients / Calendar |
| `PatientCreationSuccessModal` | ✅ Done | Standard | Yes | Clinic | Patients / Calendar |
| `PractitionerAssignmentPromptModal` | ✅ Done | Standard | Yes | Clinic | Calendar (Patient selection) |
| `PractitionerAssignmentConfirmationModal` | ✅ Done | Standard | Yes | Clinic | Calendar (Patient selection) |
| **System / Admin Flows** | | | | | |
| `MembersPage - InviteModal` | ✅ Done | Standard | Yes | Clinic | Settings > Members |
| `MembersPage - EditRolesModal` | ✅ Done | Standard | Yes | Clinic | Settings > Members |
| `SystemClinicsPage - CreateClinicModal` | ✅ Done | Standard | Yes | System | Admin > Clinics |
| **Internal / Special** | | | | | |
| `ReceiptPreviewModal` | ✅ Done | Fullscreen | Yes | Clinic | Settings > Receipts |
| `ChatTestModal` | ✅ Done | Standard | Yes | Clinic | Dev / Chat Test Page |

***

## Examples: Do / Don’t

* **Do**: Put `overflow-y-auto` on Body and not on the outer container or form.
* **Do**: Use `ml-auto` to right-align the inline X in the header.
* **Don’t**: Stack `p-6` on both the modal container and an inner wrapper.
* **Don’t**: Add inner `max-h` that creates a second scrollbar.

***

## Mobile Considerations

* Maintain side margins (via container `mx-4`) to avoid edge-to-edge feel.
* Prefer footer `關閉` on info modals for better reachability.
* Ensure sticky footer keeps actions visible without stealing excessive vertical space.

***

## Appendix: Tailwind Snippets

### Size Variants
* **Small modal**: `w-full mx-4 mb-4 max-h-[90dvh] min-h-0 overflow-hidden flex flex-col sm:max-w-md md:max-w-lg`
* **Medium modal (default)**: `w-full mx-4 mb-4 max-h-[90dvh] min-h-0 overflow-hidden flex flex-col sm:max-w-lg md:max-w-xl lg:max-w-xl`
* **Large modal**: `w-full mx-4 mb-4 max-h-[90dvh] min-h-0 overflow-hidden flex flex-col sm:max-w-xl md:max-w-2xl lg:max-w-2xl`

### Modal Parts
* Header: `px-6 py-3 border-b flex items-center`
* Body: `px-6 py-4 flex-1 min-h-0 overflow-y-auto`
* Footer: `px-6 py-3 border-t flex justify-end space-x-3`

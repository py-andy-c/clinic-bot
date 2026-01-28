# Modal Standardization

Owners: Frontend Platform
Status: Draft (v1)
Last updated: 2026-01-27

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

## Non-goals

* Changing business logic or validations within modals
* Replacing component libraries

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

* **Header**
  * Purpose: title and optional description/contextual actions.
  * Style: `px-6 py-3 border-b flex items-center`
  * Typography: `text-lg font-semibold` by default.
  * Optional right-side close button (see Close Policy). If present: placed inline as the header's right-aligned element, vertically centered.

* **Body**
  * Purpose: main content.
  * Style: `px-6 py-4 flex-1 min-h-0 overflow-y-auto` (this is the only scrollable region).
  * Internal rhythm: prefer `space-y-4` or `space-y-6`; avoid adding additional containers with their own max-height/overflow.

* **Footer**
  * Purpose: actions.
  * Style: `px-6 py-3 border-t flex justify-end space-x-3`.
  * Sticky feel (optional): `sticky bottom-0 bg-white/95 backdrop-blur supports-[backdrop-filter]:backdrop-blur z-10`.

The modal container (`BaseModal` panel) should be `flex flex-col overflow-hidden max-h-[90dvh] min-h-0` so only Body can scroll.

***

## Sizing and Widths

* Default responsive widths for non-fullscreen modals:
  * `w-full mx-4 mb-4 sm:max-w-lg md:max-w-xl lg:max-w-2xl`
* Fullscreen flows use `fullScreen` in `BaseModal` and manage layout with their own header/body/footer but keep the same principles.
* Do not set widths on inner wrappers; width is a responsibility of the modal container.

***

## Close Policy (X vs 取消/關閉)

* **Form modals with actions (create/edit forms)**
  * Footer shows primary (e.g., 儲存) and secondary (取消) actions.
  * Show the top-right "X" for consistency (`showCloseButton={true}` or `showClose={true}` in `ModalHeader`).
  * `Esc` maps to cancel behavior, including unsaved-change guards when applicable.
  * Overlay click-to-close is disabled by default unless the flow is safe to dismiss.

* **Informational/read-only modals**
  * Prefer a single close affordance:
    * Desktop: show the header "X" (in-row, right-aligned). No footer button.
    * Mobile: show a footer `關閉` button; optionally hide the "X" for reachability.
  * If both are present for specific reasons, the "X" must be visually lightweight.

* **Confirm/Alert dialogs**
  * Alert: a single primary button (OK). Avoid redundant X.
  * Confirm: two buttons (確認/取消). Optionally hide the X to reduce ambiguity; if present, X maps to 取消.

***

## Interaction and Accessibility

* `Esc` closes when safe; must invoke the same onCancel/unsaved-change logic as 取消.
* Focus management: initial focus set to the first primary action or a meaningful input.
* Trap focus within the modal; return focus to the trigger element on close (handled by consumer where needed).
* Provide `aria-label` or `aria-labelledby` on `BaseModal` for screen readers.
* Ensure minimum hit target sizes (36–40px) for close buttons and actions.

***

## Scroll Strategy

* Only the Body scrolls. Avoid nested scroll containers within Body.
* If an inner section must scroll independently (rare), ensure it does not hide the Footer or create double scrollbars.
* Add `min-h-0` on flex parents and children involved in scrolling to allow proper flex shrinkage.

***

## Visual Style

* Header typography: `text-lg font-semibold` (use `text-xl` only for prominent flows).
* Form field rhythm: prefer `space-y-4` and keep labels concise.
* Dividers: use `border-b` for header and `border-t` for footer; avoid extra borders unless needed for grouping.
* Close button style: minimal ghost/tertiary; avoid heavy shadows.

***

## BaseModal Usage Guidelines

* Non-fullscreen: rely on BaseModal container’s responsive widths and overflow; do not add outer padding.
* Fullscreen (`fullScreen`): supply your own header/body/footer, but keep single-scroll-region rule.
* Props to consider per modal:
  * `showCloseButton`: false for edit/create forms; true for info-only desktop modals.
  * `closeOnOverlayClick`: false by default; enable only for safe, non-destructive modals.
  * `aria-label` / `aria-labelledby`: required for accessibility.

***

## Component Structure Template

```tsx
<BaseModal onClose={onClose} aria-label="標題" showCloseButton={false}>
  <form className="w-full flex flex-col min-h-0" onSubmit={...}>
    <div className="px-6 py-3 border-b flex items-center">
      <h2 className="text-lg font-semibold text-gray-900">標題</h2>
      {/* Optional inline X on the right for info-only modals */}
    </div>

    <div className="px-6 py-4 flex-1 min-h-0 overflow-y-auto space-y-6">
      {/* Body content */}
    </div>

    <div className="px-6 py-3 border-t flex justify-end space-x-3">
      <button type="button" className="btn-secondary" onClick={onCancel}>取消</button>
      <button type="submit" className="btn-primary">儲存</button>
    </div>
  </form>
</BaseModal>
```

***

## Migration Guidance

1. Remove outer container paddings from modal content; rely on section paddings.
2. Introduce Header/Body/Footer sections with classes above.
3. Make Body the only scrollable area (`flex-1 min-h-0 overflow-y-auto`).
4. Remove nested `max-h`/`overflow` from inner wrappers.
5. Apply Close Policy:
   * Edit/create forms: show both header X and footer 取消/儲存 for consistency.
   - Info/read-only: use header X (desktop) or footer 關閉 (mobile).
6. Ensure `aria-label` or `aria-labelledby` is set.

### Checklist per modal

* \[ ] Uses BaseModal responsive container (no duplicate paddings)
* \[ ] Header present with correct sizing
* \[ ] Body is the only scroll region
* \[ ] Footer actions persistently visible
* \[ ] Close affordance follows the policy
* \[ ] Esc/overlay behavior appropriate
* \[ ] Works on mobile (safe margins, reachable actions)

***

## Code Reuse & Component Hierarchy

To ensure consistency and reduce duplication, we use a tiered component strategy:

1. **`BaseModal` (Foundational)**
   * **File**: `frontend/src/components/shared/BaseModal.tsx`
   * **Responsibility**: Handles the "modal-ness" (Portals, Overlay, Scroll locking, Escape key, Z-index, Mobile full-screen transitions).
   * **Reuse**: Used directly by all modal implementations.

2. **`ModalParts` (Structural)**
   * **File**: `frontend/src/components/shared/ModalParts.tsx`
   * **Responsibility**: Defines `ModalHeader`, `ModalBody`, and `ModalFooter`.
   * **Standardization**: Enforces the padding (`px-6`), borders, and flex-column layout required for the "single scroll region" principle.
   * **Reuse**: Primary way to structure content inside any `BaseModal`.

3. **`InfoModal` & `Dialogs` (Derived)**
   * **Files**: `shared/InfoModal.tsx`, `contexts/ModalContext.tsx`
   * **Responsibility**: High-level abstractions for common patterns (Information popups, Alert/Confirm dialogs).
   * **Reuse**: Use these whenever possible for non-custom UI to avoid writing modal boilerplate.

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
| `ServiceItemEditModal` | ⚠️ Partial | Fullscreen | No | Clinic | Settings > Service Items |
| `ValidationSummaryModal` | ❌ Unused | Standard | No | Clinic | Dead code. Not used in any current UI flow. |
| `PatientCreationModal` | ✅ Done | Standard | Yes | Clinic | Patients / Calendar |
| `PatientCreationSuccessModal` | ✅ Done | Standard | Yes | Clinic | Patients / Calendar |
| `PractitionerAssignmentPromptModal` | ✅ Done | Standard | Yes | Clinic | Calendar (Patient selection) |
| `PractitionerAssignmentConfirmationModal` | ✅ Done | Standard | Yes | Clinic | Calendar (Patient selection) |
| **Internal / Special** | | | | | |
| `ReceiptPreviewModal` | ℹ️ Exempt | Fullscreen | No | Clinic | Settings > Receipts |
| `ChatTestModal` | ℹ️ Exempt | Standard | No | Clinic | Dev / Chat Test Page |

***

## Examples: Do / Don’t

* **Do**: Put `overflow-y-auto` on Body and not on the outer container or form.
* **Do**: Use `ml-auto` to right-align the inline X in the header and keep `items-center`.
* **Don’t**: Stack `p-6` on both the modal container and an inner wrapper.
* **Don’t**: Use both header X and footer 取消 for edit forms.
* **Don’t**: Add inner `max-h` that creates a second scrollbar.

***

## Mobile Considerations

* Maintain side margins (via container `mx-4`) to avoid edge-to-edge feel.
* Prefer footer `關閉` on info modals (better reachability) and hide the X on small screens if necessary.
* Ensure sticky footer keeps actions visible without stealing excessive vertical space.

***

## Performance

* Avoid re-mounting heavy content in the Body when toggling headers/footers.
* Minimize shadow/blur effects on large areas to keep GPU usage low on low-end devices.

***

## Rollout Plan

1. Adopt this spec for all new modals.
2. Phase migration:
   * Phase 1: MessagePreviewModal, InfoModal, PractitionerNotificationTimeSettings.
   * Phase 2: Calendar selection/confirm modals.
   * Phase 3: Remaining calendar modals and any bespoke settings modals.
3. QA pass on desktop and mobile breakpoints.

***

## Open Questions

* Should we auto-provide a header slot in `BaseModal`? Current decision: keep BaseModal generic; header is an opt-in pattern.
* Do we want a shared `ModalHeader/Body/Footer` trio? Recommended for consistency; can be added later as thin wrappers.

***

## Appendix

* Tailwind snippets for quick copy:
  * Header: `px-6 py-3 border-b flex items-center`
  * Body: `px-6 py-4 flex-1 min-h-0 overflow-y-auto`
  * Footer: `px-6 py-3 border-t flex justify-end space-x-3`
  * Sticky Footer: `sticky bottom-0 bg-white/95 backdrop-blur supports-[backdrop-filter]:backdrop-blur z-10`
  * Container (non-fullscreen): `w-full mx-4 mb-4 max-h-[90dvh] min-h-0 overflow-hidden flex flex-col sm:max-w-lg md:max-w-xl lg:max-w-2xl`

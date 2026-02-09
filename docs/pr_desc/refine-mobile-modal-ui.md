# PR Description: Refine Edge-to-Edge Mobile Design for Modals

## Summary

This PR implements a true "edge-to-edge" mobile design for key administrative modals, specifically the `ServiceItemEditModal` and `MedicalRecordTemplateEditorModal`. The goal was to eliminate "double margins" and provide a seamless, full-width experience on mobile devices, matching the aesthetic of the Patient Detail and Medical Record pages.

## Changes Made

### Frontend UI/UX Refinement

* **Aggressive Mobile Optimization**: Applied extensive styling overrides to achieve a full-bleed mobile experience.
  * **Forced White Backgrounds**: Forced pure white backgrounds for `form` and `ModalBody` on mobile (replacing gray-50/50 backgrounds) to ensure a unified look.
  * **Zero Padding**: Used `!p-0` on `ModalBody` for mobile viewports to remove default horizontal and vertical constraints.
  * **Section Flattening**: Updated all `section` elements within these modals to:
    * Remove horizontal borders (`border-x-0`) on mobile.
    * Remove rounded corners and shadows on mobile.
    * Use only a bottom border (`border-b`) for separation instead of boxed containers.
    * Standardize inner padding (`p-5`) for mobile section content.
  * **Vertical Flow**: Removed vertical spacing (`space-y-0`) between major layout blocks on mobile to ensure sections sit flush against each other.

### Specific Component Updates

* **`ServiceItemEditModal.tsx`**:
  * Optimized "Basic Info", "Booking Rules", "Notes", "Resources", "Message Settings", and "Follow-up Settings" sections for edge-to-edge display.
  * Refined practitioner assignment cards to be edge-to-edge with `border-x-0` and `rounded-none` on mobile.
* **`MedicalRecordTemplateEditorModal.tsx`**:
  * Synchronized styling with the edge-to-edge standard established for service items.
* **`shared/ModalParts.tsx`**:
  * Adjusted default styles of `ModalHeader`, `ModalBody`, and `ModalFooter` to support zero-padding and consistent backgrounds when in full-screen/mobile mode.

## Visual Impact

* **Mobile**: Modals now feel like native full-screen views with content stretching to the edges of the screen, separated only by thin lines. This significantly improves readability and usable space on smaller screens.
* **Desktop**: Preserved the existing premium "centered card" look with shadows, rounded corners, and proper margins.

## Verification

* Visually inspected both modals on mobile resolutions to confirm:
  * No horizontal padding on the main body.
  * Sections are flush with the screen edges.
  * No shadows or rounded corners on mobile sections.
  * White background is consistent across header, body, and footer.

# Mobile Layout Optimization: Addressing "Double Margin"

## Context

The current mobile implementation of the Patient Detail Page uses a "Card" design pattern inherited from the desktop view. This pattern places content inside a white container (`bg-white`) with shadow (`shadow-md`) and padding (`p-4` or `p-6`). This card is then placed inside a page container that also has margins from the screen edge.

On small screens (mobile), this results in a "double margin" effect:

1. **Outer Margin:** Layout spacing between screen edge and card.
2. **Inner Padding:** Card padding between card edge and content.

This creates significant wasted horizontal space, compressing the actual content area and forcing more vertical scrolling than necessary.

## Design Goals

1. **Maximize Space Efficiency:** Recover wasted horizontal space on mobile devices.
2. **Maintain Aesthetic Appeal:** Ensure the design still looks "nice" and premium, avoiding a cluttered or broken appearance.
3. **Responsive Consistency:** Ensure a smooth transition between mobile and desktop views.

## Proposed Options

### Option 1: Edge-to-Edge "Flat" Sections (Recommended)

This approach mimics the list-style pages found in native iOS/Android system settings.

* **Logic:**
  * **Mobile (< 640px):** Remove the outer page margins and the card container styling (shadows, rounded corners, borders). Content spans 100% width of the screen. Sections are separated by simple dividers or thick gray spacers (e.g., `h-2 bg-gray-100`).
  * **Desktop (>= 640px):** Retain the existing "Floating Card" design with shadows and rounded corners.
* **Pros:**
  * Maximum space efficiency (zero wasted margin).
  * Native app feel on mobile.
  * Clear separation of content without bulky visuals.
* **Cons:**
  * Requires conditional styling based on breakpoints.
  * Might feel "less designed" if not handled carefully with typography and spacing.

**Visual Reference:**

```tsx
// Mobile
<div className="w-full bg-white border-b border-gray-200 p-4">
  <Content />
</div>

// Desktop
<div className="rounded-lg shadow-md bg-white p-6">
  <Content />
</div>
```

### Option 2: "Compact" Cards with Reduced Padding

This approach keeps the "Card" metaphor but aggressively optimizes it for mobile.

* **Logic:**
  * **Mobile:** Keep the cards, but reduce the *outer margin* to near-zero (e.g., `mx-2` or `mx-0`) and reduce the *inner padding* to the minimum viable (e.g., `p-3`).
  * **Desktop:** Standard spacing (`p-6`).
* **Pros:**
  * Maintains the "Card" visual consistency across all devices.
  * Easier to implement (just changing Tailwind spacing classes).
* **Cons:**
  * Still technically wastes some space compared to Option 1.
  * Can feel cramped if padding is reduced too much.

### Option 3: Full-Bleed Cards (Hybrid)

Retain the card "look" (white background against gray page) but make the cards touch the edges of the screen on mobile.

* **Logic:**
  * **Mobile:** Cards have `rounded-none`, `shadow-none` (or bottom-only border), and `mx-0`. They look like Option 1 but structurally remain distinct blocks.
  * **Desktop:** `rounded-lg`, `shadow-md`, `mx-auto`.
* **Difference from Option 1:** Option 1 implies a structural change to a list view; Option 3 is just removing the "floating" nature of the card while keeping internal layout identical.

## Recommendation

**Adopt Option 3 (Full-Bleed Cards).**

This strikes the best balance:

1. **Solves Double Margin:** By removing the outer margin (`mx-0`) and corner radius (`rounded-none`) on mobile, the "card" becomes the background, effectively pushing content to the edges (respecting internal padding only).
2. **Aesthetic:** It looks deliberate and premium, similar to how Instagram or Twitter feeds work (content flows edge-to-edge).
3. **Implementation:** It is purely a CSS/Tailwind class change (`sm:rounded-lg`, `sm:shadow-md`, `sm:mx-auto`, `w-full`).

**Key Applications:**

* **Patient Detail Sections**: Medical records, Appointment history, Photo gallery.
* **Administrative Modals**: `ServiceItemEditModal` and `MedicalRecordTemplateEditorModal` use this pattern to maximize editing space and eliminate side-margin waste on mobile.

### Implementation Plan

Refactor `PatientDetailSection` wrappers to use:

```css
/* Mobile (Default) */
w-full
bg-white
border-b border-gray-200 /* Divider between sections */
p-4 /* Single layer of padding */

/* Tablet/Desktop (sm:) */
sm:rounded-lg
sm:shadow-md
sm:border-0
sm:p-6
sm:mb-6
```

This transforms the "Double Margin" (Screen -> Margin -> Card -> Padding -> Content) into a "Single Margin" (Screen -> Padding -> Content).

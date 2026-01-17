# Design Doc & Implementation Guide: Calendar Layout Redesign

## 🚀 Goal
Transform the daily calendar view into a high-density, multi-practitioner workspace that feels native on mobile and professional on desktop. This redesign shifts from a fragmented layout to a **Unified Sticky Grid** architecture.

---

## 🏗️ 1. Unified Sticky Grid Architecture
*Crucial for alignment. Avoid JavaScript scroll synchronization at all costs.*

- **Single Viewport Pattern**: Place both the headers and the grid body inside the same `overflow: auto` container.
- **CSS Sticky Strategy**:
    - **Top Sticky**: `.header-row` (contains corner + resource headers) must be `position: sticky; top: 0; z-index: 100`.
    - **Left Sticky**: `.time-column` (gutter) must be `position: sticky; left: 0; z-index: 50`.
    - **Corner Case**: The `.time-corner` must be `position: sticky; top: 0; left: 0; z-index: 110` so it stays at the intersection when both axes scroll.
- **Ultra-Narrow Gutter**: Reduce the time gutter and top-left corner width to **28px** to minimize horizontal "dead space".
- **Synchronized Alignment**: Ensure the `.time-corner` (header) and `.time-column` (body) widths are mathematically identical (28px) to prevent misalignment.

---

## 📅 2. Multi-Level Date Navigation
*Avoid Gesture Conflict. Swiping horizontally now scrolls practitioners, not dates.*

- **The "Weekly Snap" Strip**: A fixed 7-day grid representing the current week.
    - **Logic**: Calculate the start of the week for the selected date. Render exactly those 7 days.
    - **Aesthetics**: Centered items with internal padding (Spec Height: **40px**).
- **Header Jump (DatePicker)**: The Month/Year label (e.g., `2026年1月 ▾`) in the global navbar must be an interactive trigger.
    - Clicking it should open the `DatePicker` modal for far-away jumps.
- **Global Header Injection**: 
    - Use a "Middle Slot" or "Teleport" pattern to push the calendar's `YYYY年M月` string into `ClinicLayout.tsx`.
    - Ensure this state is cleared on `componentWillUnmount`.

---

## 🎨 3. "Layered Background" Pattern
*Ensures readability when appointments overlap with breaks/exceptions.*

- **Z-Index Hierarchy**:
    1.  **Bottom**: Grid Slots (`rbc-time-slot`)
    2.  **Layer 1**: Exceptions/Breaks (`rbc-background-event`). Use a `repeating-linear-gradient` (striped) to indicate "Special Status."
    3.  **Layer 2**: Appointments (`rbc-event`). Must be opaque and **100% column width**.
- **Availability State**: Non-working hours should use a solid flat background color (e.g., `#f1f5f9`).

---

## 🕒 4. Precision Grit (15-Minute Granularity)
*High-fidelity scheduling with clear visual hierarchy.*

- **Vertical Scale**: 
    - Hour Height: **80px**.
    - Slot Height: **20px** (easy to tap on mobile).
- **Border Hierarchy**:
    - `Solid`: Top of the hour (:00).
    - `Light Dotted`: Every 30 minutes (:30).
    - `Ultra-Light/Transparent`: Every 15/45 minutes (:15, :45).
- **Time Label Alignment**: 
    - Labels must be **Numeric Only** (save space).
    - Use `transform: translateY(-50%)` to center the number EXACTLY on the horizontal hour line.
    - Skip the `0` (midnight) label for a cleaner layout transition.

---

## 📱 5. High-Density Responsive Specs
*Maximize content, minimize "UI Tax."*

- **Compressed Heights**:
    - **Global Navbar**: 48px.
    - **Date Strip**: 40px.
    - **Resource Headers**: 40px.
- **Adaptive Column Widths**:
    - **Dynamic Column Scaling**: Practitioner columns use `flex: 1` to expand and fill the available width. If the number of columns exceeds the viewport, they shrink to a **Minimum Width of 56px**, triggering horizontal scroll.
- **Branding Logic**: Hide the "診所小幫手" text on mobile; show only the `🏥` icon on the far left.

---

## 🛡️ 6. Mobile Bottom Accessibility
*Prevent events from being "trapped" under browser UI.*

- **Safe Area Support**: Apply `padding-bottom: env(safe-area-inset-bottom, 20px)` to the scrollable container.
- **Over-Scroll Buffer**: Add an extra **60px - 80px** of padding-bottom to the grid. This allows the 23:45 slot to be scrolled comfortably high above the URL bar/home indicator.

---

## ⚙️ 7. UX & Controls
- **Floating Action Buttons (FAB)**: 
    - **Primary (+)**: Add Appointment.
    - **Secondary (📅)**: Return to Today + Auto-Scroll to 9 AM.
    - **Secondary (⚙️)**: Open Settings Drawer (for view switching and resource filters).
- **Settings Drawer**: Consolidate "View Switching" (Day/Week/Month) and "Practitioner Selection" here to keep the main view decluttered.

---

---

## 🧠 8. Technical Implementation Learnings (Prototyping Insights)
*Knowledge gained during CSS/JS stress-testing of the mockup.*

- **The "Axis Misalignment" Trap**: Misalignment between the header row and grid body usually happens because the `.time-corner` and `.time-column` have different widths or box-sizing. **Rule**: Lock both to exactly **28px** and set `box-sizing: border-box`.
- **Absolute Centering of Time**: To get numbers (like "11") to sit exactly on the hour line:
    - Wrap the number in a `<span>` or `<div>`.
    - Set `.time-label { position: relative; }`.
    - Set the inner element to `position: absolute; top: 0; left: 0; width: 100%; transform: translateY(-50%); text-align: center;`.
- **Dynamic Width Synchronization**: 
    - Use `display: flex` for the header row and body grid.
    - Give both `.resource-header` and `.practitioner-column` the same `flex: 1` and `min-width: 56px`. This ensures headers and columns are always pixel-aligned regardless of scaling.
- **Vertical Spacing**: A `40px` height for headers/strips with `align-items: center` provides exactly enough visual "breathing room" (3-4px padding) without wasting space.

---

## 🛠️ Implementation Checklist for `CalendarView.tsx`
- [ ] **Unified Scroll**: Refactor the RBC layout to ensure the entire grid (headers + body) is wrapped in a single scrollable viewport.
- [ ] **Custom Slot Rendering**: Implement `slotPropGetter` to apply `.rbc-slot-unavailable` based on practitioner schedules.
- [ ] **Layered Z-Indexing**: 
    - Ensure background exceptions use a lower z-index than appointment events.
    - Set `opacity: 1` and `width: 100%` on appointments to prevent them from becoming unreadable "slivers."
- [ ] **Auto-Scroll Hook**: Create a `useScrollToTime` hook that calculates the pixel offset of 9:00 AM based on the `80px` hour height.
- [ ] **Date Strip Component**: Build a 7-day pagination strip that calculates its range based on the `selectedDate`.
- [ ] **Native Swipe Override**: Use `touch-action: pan-y` on the calendar body grid to prevent horizontal swiping from triggering date changes, allowing horizontal column scrolling instead.
- [ ] **Header Store**: Implement a simple store (or use existing state) to "teleport" the Month/Year string to the `ClinicLayout` top bar.
- [ ] **Quarter-Hour Styling**: Use `:nth-child` CSS rules on slots to render the hierarchical border system (Solid @ 60m, Light @ 30m, Transparent @ 15/45m).

# Design Doc: Calendar Layout Redesign

## Goal
Change the daily view layout of the calendar page to support side-by-side practitioner columns, grayed-out non-available hours, and interactive slot selection.

## Requirements
- **Side-by-Side Practitioners**: In Day view, each selected practitioner should have its own column.
- **Gray-out Non-Available Hours**: Hours outside the practitioner's default availability should be visually distinct (e.g., gray background).
- **Interactive Clicks**: Clicking on a specific time slot for a specific practitioner should allow creating appointments or availability exceptions for that practitioner.

## Technology Research: React Big Calendar (RBC)
Current codebase uses `react-big-calendar`. Research confirms that RBC supports the requested features:
1. **Resource View**: RBC has a "Resources" feature. When the `resources` prop is provided and `view="day"`, RBC automatically renders one column per resource.
2. **Custom Styling (Gray-out)**: The `slotPropGetter` prop allows applying custom CSS classes to individual time slots. This function receives the `date` and `resourceId`, which is perfect for checking against practitioner availability.
3. **Interactivity**: The `onSelectSlot` callback provides a `resourceId` when resources are used, enabling context-aware actions.
4. **Header Customization**: The `components.resourceHeader` allows full control over the column headers, enabling the addition of avatars.

## Implementation Plan

### 1. Data Structure Updates
- Modify `CalendarView` state to store practitioner availability (the `default_schedule` returned by the API).
- Create a `practitionerResources` array from the selected practitioners to pass to RBC's `resources` prop.

### 2. Frontend Components (`frontend/src/components/CalendarView.tsx`)
- **RBC Configuration**: 
    - Pass `resources={practitionerResources}`.
    - Set `resourceIdAccessor="id"` and `resourceTitleAccessor="title"`.
    - Use `slotPropGetter` for availability (gray-out) and `eventPropGetter` for full-width opaque cards.
- **Date Navigation Overlay**:
    - Implement a `DateStrip` component inside the sticky header.
    - Connect the global header "Middle Slot" to the calendar's `currentDate` state using `Zustand` or a shared `HeaderContext`.
- **Auto-Scroll Utility**:
    - Create a `useScrollToTime` hook to handle the initial 9 AM jump and "Today" button interactions.

### 3. Styling & Layout Redesign
- **Sticky Grid Architecture**:
    - Refactor the RBC container to use a single scrollable viewport.
    - Apply `position: sticky` via CSS classes to `rbc-time-header` and `rbc-time-gutter`.
- **Global Header Refinement**:
    - Define responsive branding rules: `display: none` for text on mobile, `flex: 1` alignment for center title.
- **Z-Index Layering**:
    - Specific CSS rules to ensure appointments (Layer 2) stay above breaks/exceptions (Layer 1).
- **Mobile Buffers**:
    - Implement `env(safe-area-inset-bottom)` and `padding-bottom` on the main viewport.

### 4. Integration with Existing Modals
- Ensure `handleSelectSlot` correctly passes the `practitionerId` to the `CreateAppointmentModal` and `ExceptionModal`.
- No changes needed to the backend as the `getBatchCalendar` endpoint already returns the necessary data (`default_schedule`).

## Alternatives Considered
- **FullCalendar**: While FullCalendar has a very mature "Resource Timeline" and "Resource Day View", many of its advanced resource features require a paid license (FullCalendar Scheduler). Given that `react-big-calendar` is already used and supports the basic requirements for free, we stick with RBC.

## Implementation Notes & Prototyping Decisions (based on [Mockup UI](../../mockups/calendar/index.html))

During the prototyping phase, several key UX and technical decisions were made to ensure a premium experience on both desktop and mobile:

### 1. Unified Sticky Grid Architecture
- **Alignment Challenge**: Syncing a separate header div with a scrollable body div often leads to pixel-misalignment due to scrollbar offsets and varied "flex-grow" behaviors.
- **Decision**: Use a **Single Viewport** architecture where both the header and the body are children of the same scrollable container.
    - **Sticky Headers**: Practitioner names stay at the `top: 0` using CSS `position: sticky`.
    - **Sticky Gutter**: The time column stays at the `left: 0` using CSS `position: sticky`.
    - **Result**: Perfect, mathematically-locked alignment between headers and columns during both vertical and horizontal scrolling.

### 2. Multi-Level Date Navigation
- **The "Weekly Snap" Strip**: Instead of a continuous free-scrolling list, the date strip is organized into a **7-day fixed week grid**. 
    - **Logic**: The strip always displays the full week containing the selected date (determined by the start of that week).
    - **Pros**: Maintains the calendar's temporal rhythm (Sun-Sat) and prevents "chopped" UI at the edges.
- **Header Jump (DatePicker)**: The Year/Month label in the global header is interactive (`cursor: pointer` with a `▾` indicator).
    - **Usage**: Tapping this label is the primary "Industry Standard" way for users to jump to dates far in the future or past via a full-month widget.
    - **Benefit**: Keeps the high-density daily view focused while providing powerful jump capabilities.

### 3. "Layered Background" Pattern for Overlaps
- **Constraint**: When appointments are scheduled during an "Availability Exception" (e.g., a break), standard layouts often split the column horizontally, making text vertical and unreadable.
- **Decision**: 
    - **Exceptions as Backgrounds**: Specific deviations (breaks, seminars) appear as a striped "base layer" at a lower z-index.
    - **Default Off-Hours**: Standard non-working hours appear as a solid flat gray background.
    - **Full-Width Appointment Cards**: Appointments always take 100% of the horizontal space, sitting on top of the backgrounds. This ensures the patient's name is always fully readable.

### 4. Time Management & Viewport
- **Full-Day Coverage**: The calendar range is extended to **00:00 – 23:59**.
- **9 AM Auto-Scroll**: To avoid starting the user at midnight, the `CalendarView` will automatically scroll to the 09:00 AM slot upon initialization.
- **Cleaner 0:00 Hour**: Skip or hide the "0:00" time label to improve visual hygiene at the top of the grid.
- **15-Minute Granularity**: Implement 15-minute time slots (4 slots per hour) to allow for more precise scheduling. Use an 80px height per hour (20px per 15-min slot) for comfortable mobile interaction.

### 5. Responsive Design & Visuals
- **Simplified Headers**: Practitioner headers will display **names only** (no avatars). This provides a cleaner high-density look and avoids visual clutter in multi-column views.
- **Minimum Column Widths**: Practitioner columns will have a fixed or minimum width (e.g., 200px) to prevent them from becoming unreadable "slivers" on mobile.
- **Top-Bar Optimization**: 
    - **Right-Aligned Menu**: The hamburger menu (☰) is relocated to the top-right corner to match production patterns.
    - **Adaptive Branding**: The platform name is hidden on mobile, leaving only the `🏥` icon on the left to prevent overlap with the centered date.
- **Typography & Depth**: Use **Outfit** and **Noto Sans TC**. Implement subtle drop shadows (`box-shadow`) and 8px corner radii for cards to create a premium, layered feel.

### 6. Floating Action Controls (FAB)
- **Consolidated Actions**: To keep the interface clean and maximize calendar real estate, settings and primary actions are moved to Floating Action Buttons in the bottom-right corner.
- **Three Core Buttons**:
    1. **Today (📅)**: Instantly jump back to the current date and auto-scroll to morning hours.
    2. **Settings (⚙️)**: Open a drawer for view switching (Month/Week/Day) and practitioner resource selection.
    3. **Add (＋)**: Primary trigger for the "Create Appointment" flow.
- **Persistence**: These floating controls **must remain visible and persistent** across all calendar views (Month, Week, and Day) to provide a consistent navigation anchor.

## Key Implementation Hazards & Best Practices

To ensure the production implementation matches the premium feel of the mockup, pay close attention to the following:

### 1. Z-Index Management
The "Layered Background" strategy relies on a strict z-index hierarchy:
- **Base**: `rbc-time-slot` (index 1)
- **Layer 1 (Exceptions)**: `rbc-background-event` / `exception-layer` (index 10). Should use striped `repeating-linear-gradient`.
- **Layer 2 (Appointments)**: `rbc-event` (index 20). Must be opaque and cover 100% width.
- **Top (Sticky UI)**: Resource Headers (index 100) and Floating Buttons (index 1000).

### 2. Sticky Container Hygiene
To avoid pixel misalignment between the time gutter and the columns:
- Ensure the parent container has `overflow: auto`.
- Apply `position: sticky; left: 0` to the entire time column and `top: 0` to the header row.
- **Avoid** syncing separate scroll containers with JavaScript if possible; CSS `sticky` is smoother and mathematically safer.

### 3. Disabling Default Swipes
The existing `handleTouchStart/End` logic in `CalendarView.tsx` currently triggers date changes on horizontal swipes.
- **Action**: Disable this global swipe listener specifically when in **Day View** so users can scroll through practitioner columns horizontally without accidentally changing the date.
- **Alternative**: Users must use the **Date Strip** for date changes on mobile.

### 4. Auto-Scroll Logic in React
- Use `useEffect` with a `ref` to the scroll viewport.
- trigger `scrollTo({ top: nineAmPixelOffset })` on initial load and when clicking the "Today" FAB.
- Pixel offset calculation: `(9 hours * 60 minutes) / (minutes per slot) * (slot height in px)`.

### 5. Data Density & Cleanliness
- **Headers**: Keep practitioner headers strictly text-only in multi-column view to prevent vertical "bloat" on mobile screens.
- **Borders**: Implement a hierarchical border system:
    - **Solid**: Every 60 minutes.
    - **Dashed/Light**: Every 30 minutes.
    - **Ultra-Light**: Every 15 minutes.
- **Time Label Alignment**: Vertically center time labels (e.g., "9:00") exactly on the horizontal hour line using `transform: translateY(-50%)`.

### 6. Global Header Integration Architecture
- **Context Injection**: To avoid polluting other pages, do **not** hardcode the date into `ClinicLayout.tsx`.
- **Middle Slot Pattern**:
    - `ClinicLayout` should offer a "Middle Slot" in the top bar.
    - `CalendarView` will use the `PageHeader` component or a dedicated `HeaderStore` to "teleport" the current "YYYY年M月" string to the top bar.
- **Lifecycle**: Ensure the date string is cleared on `componentWillUnmount` when leaving the calendar to restore the default top bar state.

### 7. Bottom Content Accessibility (Mobile)
- **Problem**: Late-night events (e.g., 23:30) can be obscured by the dynamic browser URL bar or hardware home indicators on mobile.
- **Solution**: 
    - **Safe Area Insets**: Use `padding-bottom: env(safe-area-inset-bottom)` on the main viewport.
    - **Over-Scroll Buffer**: Add an extra `60px - 80px` of padding at the bottom of the grid. This allows the user to scroll the final time slot well above the "danger zone" at the bottom of the physical screen.
    - **FAB Clearance**: Ensure the FAB container's bottom margin is also calculated using safe-area insets to prevent overlap with gesture bars.

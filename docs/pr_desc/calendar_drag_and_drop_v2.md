# PR Description: Advanced Calendar Drag-and-Drop & Edit Modal Logic

## Goal & Requirements
This PR delivers a comprehensive upgrade to the calendar's drag-and-drop experience, focusing on meeting "industrial-standard" expectations for interactivity, visual feedback, and data integrity.

**Key Requirements Met:**
1.  **Premium Drag Experience**:
    *   **Snapping**: Cursor-based horizontal snapping for predictable column switching, distinct from vertical time-slot snapping.
    *   **Visuals**: High-fidelity "ghost" preview for the active drag item and a dashed "hollow" placeholder for the original event.
    *   **Data Density**: Drag preview prioritizes critical info (Time, Practitioner) with unified styling.
2.  **Interaction Safety**:
    *   **Restricted Zones**: Resource columns (e.g., Rooms) are visually locked (darkened, grayscale) during drag to indicate they are invalid drop targets for appointments.
    *   **Text Selection**: Global text selection is disabled during drag operations to prevent UI clutter.
3.  **Data Integrity in Edit Flow**:
    *   **Edit Modal Logic**: Fixed a regression where the "Confirm Changes" modal showed identical "Before" and "After" values. The modal now correctly receives the *original* event state alongside the *new* dragged destination values.

## The Fix

### 1. Calendar Grid Interaction (`CalendarGrid.tsx`)
-   **Cursor-Based Logic**: Refactored `calculatePreview` to switch columns only when the mouse cursor enters a new region.
-   **Visual Layers**:
    *   **Z-Index**: Elevated the original event placeholder (`z-index: 30`) to ensure visibility over overlapping events.
    *   **Restricted Zones**: Implementation of a `.restrictedZone` class that applies a high-contrast grayscale filter (`grayscale(0.8)`, `opacity: 0.6`) to invalid resource columns during drag.
-   **Typography**: Unified all drag preview text (Time, Practitioner, Title) to use `text-gray-700` for consistent readability.

### 2. Edit Modal Data Flow (`AvailabilityPage.tsx`, `EditAppointmentModal.tsx`)
-   **State Separation**:
    *   Modified `handleEventReschedule` to **stop mutating** the event object.
    *   Introduced `pendingRescheduleInfo` state to store the drag destination (new start time, new practitioner).
    *   The `selectedEvent` state now preserves the pristine "Before" state of the appointment.
-   **Modal Initialization**:
    *   Updated `EditAppointmentModal` to accept an `initialValues` prop.
    *   The form hook now prefers `initialValues` (the new drag info) for initializing fields, while the "Review" step uses the `event` prop to display the correct "Original" data.

### 3. Global Polish
-   **CSS Utilities**: Added global `.no-selection` utility in `index.css` to prevent text highlighting artifacts.
-   **Type Safety**: Hardened prop types to handle exact optional property constraints in TypeScript.

## Verification
-   **Test Coverage**: All frontend tests verified as **[SUCCESS] ✅ PASSED**.
-   **Manual Validation**:
    *   Dragging an event correctly shows the ghost preview.
    *   Resource columns darken to indicate no-entry.
    *   Dropping an event opens the Edit Modal.
    *   The Edit Modal's "Review" step correctly shows *different* values for "Original" and "New" times.

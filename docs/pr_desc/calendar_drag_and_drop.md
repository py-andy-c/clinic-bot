# PR Description: Advanced Calendar Drag-and-Drop Experience

## Goal & Requirements
The goal of this PR is to transform the calendar's drag-and-drop interaction from a basic implementation to a premium, high-fidelity experience modeled after industrial standards like Google Calendar. Key requirements included:

- **Visual Continuity**: Maintain a clear reference to the original event position while providing a solid, snappy preview of the new location.
- **Data-Dense Feedback**: Prioritize scheduling critical information (Time and Practitioner) over secondary metadata (Event Name) during the drag process.
- **Predictable Snapping**:
    *   **Vertical**: Snap to time intervals while maintaining the user's relative "grab point" on the event.
    *   **Horizontal**: Switch columns (Practitioners/Resources/Days) based purely on the cursor's entrance into a new region, preventing accidental "flickering" jumps.
- **Cross-Column Context**: Clearly indicate if an event is being reassigned to a different therapist or resource during the move.
- **Robustness**: Ensure the new interaction model works seamlessly across both Day and Weekly views without regressions in keyboard navigation or performance.

## The Fix

### 1. Advanced Interaction Model
- **Cursor-Based Horizontal Snapping**: Refactored the column-switching logic in `calculatePreview` to use the raw `clientX` position. Columns now only switch when the user's cursor physically enters the next column's boundary, significantly improving intent detection.
- **Relative Vertical Snapping**: Maintained the `dragOffset` calculation so that theSnapped preview box follows the cursor's vertical movement precisely relative to where the user initially clicked.

### 2. Redesigned Visual Feedback
- **Dashed Original Placeholder**: The original event now remains in its initial slot as a "hollow" placeholder with a dashed border and subtle gray text. This provides a clear "home base" reference.
- **Solid Premium Preview**: Implemented a semi-transparent solid box for the active drag target, featuring a drop shadow and crisp typography.
- **Information Hierarchy**:
    *   Increased font size for **Time** (Bold) and **Practitioner** (Medium) to 12px for immediate visibility.
    *   Reordered elements to follow a logical **Time → Practitioner → Event Name** sequence.
    *   Implemented smart truncation for event names (overflow hide without ellipsis) to keep the UI clean even in narrow columns.

### 3. Dynamic Contextual Awareness
- **`dragColumnInfo` System**: Introduced a memoized tracker that detects when an event is dragged across columns and resolves the names of the "From" and "To" practitioners/resources in real-time.
- **Integrated Labels**: Displayed the reassignment target directly within the drag preview to confirm new ownership before the drop.

### 4. Code Quality & Performance
- **Simplified Memoization**: Optimized `useMemo` hooks by removing unnecessary dependencies, ensuring the grid only re-renders the minimum necessary components during a drag.
- **Type Safety**: Standardized the `activeDragEventId` to use `undefined` consistently, resolving TypeScript linting errors and improving component prop predictability.
- **Verified Stability**: All frontend unit tests pass successfully, ensuring core calendar functionality remains rock-solid.

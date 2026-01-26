# PR Description: Improve Calendar Overlapping Event Visualization

## Overview
This PR improves the visual clarity of the calendar when multiple events overlap. It replaces the previous "staircase" (stacking cards) model with a modern **Greedy Column Packing** algorithm with **Right Expansion**, similar to the behavior of Google Calendar and Apple Calendar.

## Problem
The previous implementation used a fixed-percentage offset for overlapping events, which meant that as more events overlapped, they became increasingly narrow and obscured the text of the events "underneath" them. This made it difficult to read titles and details in dense schedules (e.g., 3+ overlapping appointments).

## Changes

### 1. New Layout Algorithm (`calendarGridUtils.ts`)
- **Greedy Column Packing**: Events are now assigned to the first available column from left to right. This ensures that every event's left edge (and its title) remains visible.
- **Right Expansion**: After column assignment, the algorithm checks if an event can "stretch" into empty columns to its right. If subsequent columns are free for that event's specific duration, it expands to fill them, maximizing horizontal space.
- **Cluster Grouping**: Events are still grouped into clusters (or "blocks") where an overlap exists, ensuring the layout remains consistent within that time block.

### 2. UI Enhancements (`CalendarGrid.tsx`)
- **Dynamic Styling**: Added logic to detect "narrow" events (less than 50% column width).
- **Responsive Text**: Narrow events automatically reduce their padding and font size to ensure as much text as possible is displayed without clipping.
- **Z-Index Refinement**: Maintained a hierarchy where appointments stay above availability exceptions, but within a cluster, the column order determines the stacking to prevent messy overlaps.

### 3. Technical Cleanup & Documentation
- **Unit Tests**: Added comprehensive tests in `calendarGridUtils.test.ts` to verify greedy packing and the Right Expansion logic.
- **Interface Updates**: Refactored `OverlappingEventGroup` to store structured layout metadata rather than raw CSS percentages.
- **Design Doc**: Created `docs/design_doc/calendar_overlap_improvement.md` outlining the research and implementation details.

## Visual Comparison
- **Current (Before)**: Events stacked like cards, with subsequent events covering 85% of the previous one.
- **Target (After)**: Events are neatly organized into columns. If space is available to the right, events expand to fill it (Google Calendar style).

## Testing Performed
- Ran `npm test src/utils/__tests__/calendarGridUtils.test.ts` (12/12 passing).
- Verified "Right Expansion" with complex overlapping scenarios (e.g., one long event in column 0, and two short events in column 1).
- Checked responsive font/padding adjustments in narrow columns.

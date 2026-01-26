# Design Doc: Improving Calendar Overlapping Event Visualization

## Status
- **Author**: Antigravity
- **Last Updated**: 2026-01-25
- **Status**: Proposed

## 1. Problem Statement
The current calendar implementation uses a "staircase" overlap approach where overlapping events are slightly offset horizontally but maintain a large width (e.g., 76-85% of the total width). This leads to several issues as seen in the user's screenshots:
1. **Unreadability**: Events overlap significantly, obscuring text in the events below.
2. **Visual Clutter**: When many events overlap (e.g., 5+), the staircase effect creates a messy visual that is hard to scan.
3. **Inconsistency**: Popular calendar apps like Google Calendar and Apple Calendar use a "columnar" approach which is generally more readable.

## 2. Research Findings

### 2.1 Current Implementation (Clinic Bot)
- **Algorithm**: Cluster-based grouping.
- **Positioning**: Each event gets a wide width (`100% - (N-1)*overlap%`) and a small offset (`index * overlap%`).
- **Z-Index**: Incremental z-index based on index in cluster.

### 2.2 Google Calendar Approach
- **Algorithm**: Greedy Column Packing with Right Expansion.
- **Logic**:
    1. Events are grouped into clusters.
    2. Within a cluster, events are assigned to the first available column $(0, 1, 2, ...)$ such that they don't overlap with other events in that column.
    3. The width of a column is initially `100% / max_columns_in_cluster`.
    4. **Expansion**: If an event is in column `i` and there are no events in columns `i+1, i+2...` for that event's duration, it expands to fill those columns.
- **Benefit**: Maximizes legibility and uses space efficiently.

### 2.3 Apple Calendar Approach
- **Algorithm**: Similar to Google but with a subtle overlap.
- **Logic**: Events are in columns, but they might slightly overlap the next column (often by a few pixels) to maximize horizontal space for text while maintaining a clear "stacked" structure.

## 3. Proposed Options

### Option A: Greedy Column Packing (Recommended)
Implement the Google Calendar style algorithm.
- **Logic**:
    1. Sort events in cluster by start time.
    2. Assign each to the first available column.
    3. Calculate total columns $N$.
    4. Base width $W = 100/N$.
    5. `left = column * W`.
    6. `width = W` (initially).
- **Pros**: Very clean, standard UX, no overlapping text.
- **Cons**: Events become narrow if there are many overlaps.

### Option B: Greedy Column Packing with Right Expansion
Extends Option A by allowing events to "stretch" to the right if space is available.
- **Logic**: After column assignment, check if the event can expand into subsequent columns without hitting another event.
- **Pros**: Best use of space. Keeps events as wide as possible.
- **Cons**: Slightly more complex algorithm.

### Option C: Improved Staircase (Modern Apple-style)
Similar to current but with a much higher overlap and fixed minimum width.
- **Logic**: Instead of wide events with small offsets, use narrower events with larger offsets, or a "stacked cards" look where only the left ~20-30% of the underlying event is covered.
- **Pros**: Maintains the "stacking" feel the user currently has but makes it more intentional.
- **Cons**: Still has overlapping text issues.

## 4. Recommendation: Option B (Google-style with Expansion)
I recommend implementing **Option B**. It provides the best balance of readability and space usage. Most users are familiar with this behavior from Google Calendar.

### Implementation Plan
1.  **Refactor `calculateOverlappingEvents`**:
    - Update it to return not just clusters, but also assign a `column` and `totalColumns` to each event within the cluster.
    - Implement the "Right Expansion" logic to calculate how many columns each event can span.
2.  **Update `calculateEventInGroupPosition`**:
    - Use the assigned `column` and `span` to calculate `left` and `width` percentages.
    - Remove the hardcoded `overlapPercent` logic.

### Pseudo-code for Recommended Algorithm (Option B)

```typescript
function layoutEvents(events) {
  // 1. Sort by start time, then duration
  const sorted = events.sort((a, b) => a.start - b.start || b.end - a.end);
  
  // 2. Group into clusters
  const clusters = [];
  for (const event of sorted) {
    let cluster = clusters.find(c => c.end > event.start);
    if (!cluster) {
      cluster = { events: [], end: 0 };
      clusters.push(cluster);
    }
    cluster.events.push(event);
    cluster.end = Math.max(cluster.end, event.end);
  }

  // 3. Within each cluster, assign columns greedily
  for (const cluster of clusters) {
    const columns = []; // array of ends of events in each column
    for (const event of cluster.events) {
      let colIdx = columns.findIndex(end => end <= event.start);
      if (colIdx === -1) {
        colIdx = columns.length;
        columns.push(event.end);
      } else {
        columns[colIdx] = event.end;
      }
      event.column = colIdx;
    }
    const totalCols = columns.length;
    
    // 4. Calculate expansion (Right Expansion)
    for (const event of cluster.events) {
       let span = 1;
       // Check if columns to the right are free for this event's duration
       // (This is a simplified version; real expansion needs careful overlap checks)
       event.totalColumns = totalCols;
       event.span = span; 
    }
  }
}
```

## 5. Visual Mockup Reference
Referencing the user's provided screenshots:
- **Current**: Staircase with wide overlaps (Screenshots 1 & 4).
- **Target**: Columnar layout (Screenshot 2 - Google) or clean stacking (Screenshot 3 - Apple).
- **Proposal**: Moving towards Screenshot 2's logic for maximum clarity.

# Resource Selection Component - Business Logic

## Overview

The Resource Selection component provides a space-efficient interface for selecting resources required for appointments. It uses a collapsible design that shows a summary by default and expands to show detailed selection when needed.

## UI Structure

### Two-Level Expansion

1. **Top Layer**: Main expand/collapse for the entire resource selection section
   - **Collapsed (default)**: Shows compact summary text (e.g., "治療室: 1/1 ✓ (治療室1) | 設備: 0/1 ⚠️")
   - **Expanded**: Shows detailed resource selection interface

2. **Second Layer**: Individual expand/collapse for each resource type section
   - Each resource type can be independently expanded/collapsed
   - Shows grid of available resources when expanded

## Auto-Expansion Logic

### Top Layer Auto-Expansion

The top layer automatically expands when **ANY** of these conditions are met:

1. **Unmet Requirements**: At least one resource type has `selectedCount < required_quantity`
2. **Resource Conflicts**: At least one resource type has `available_quantity < required_quantity` (insufficient available resources)
3. **Prepopulated Resources**: Resources are prepopulated (e.g., when duplicating or editing an appointment)
4. **Additional Resource Types**: User has added additional resource types beyond requirements

### Second Layer Auto-Expansion

Individual resource type sections automatically expand when:
- Top layer is expanded **AND**
- The specific section has issues:
  - `selectedCount < required_quantity`, OR
  - `available_quantity < required_quantity` (resource conflict), OR
  - Selected resources have conflicts with other appointments

**Important**: When auto-expanding, existing expanded sections (especially additional resource types) are preserved.

## Additional Resource Types

Users can add resource types beyond the predefined requirements:

1. Click "新增其他資源類型" button
2. Select a resource type from the dropdown
3. The new resource type section appears and is automatically expanded
4. User can select resources from that type (no quantity requirements)

**State Preservation**: Additional resource types are preserved across component remounts (e.g., when date/time is cleared) using refs.

## Summary Display

### Required Resource Types
- Format: `{typeName}: {selected}/{required} {status} ({selectedNames})`
- Status indicators:
  - `✓` = Requirement met
  - `⚠️` = Requirement not met or conflict exists
- Example: `治療室: 1/1 ✓ (治療室1)` or `設備: 0/1 ⚠️`

### Additional Resource Types
- Format: `{typeName}: {selected}/{selected} ✓ ({selectedNames})`
- Example: `床: 2/2 ✓ (床A, 床B)`

### Conflict Indicators
- Resources with conflicts show `⚠️` after the name in the summary
- Example: `治療室: 1/1 ✓ (治療室1⚠️)` indicates the selected resource has a conflict

## Key Behaviors

1. **State Preservation**: Additional resource types and expanded sections are preserved when the component remounts (e.g., when date/time changes)

2. **Auto-Selection**: System automatically selects suggested resources when available

3. **Conflict Detection**: Shows conflicts at both the resource type level (insufficient availability) and individual resource level (conflicts with other appointments)

4. **Manual Control**: Users can always manually expand/collapse the top layer and individual sections regardless of auto-expansion rules

## Implementation Notes

- Uses refs to preserve `additionalResourceTypes`, `expandedSections`, and `additionalResources` across remounts
- Helper functions (`getResourceById`, `getResourceTypeName`, etc.) are memoized with `useCallback` for performance
- `selectedByType` and `summaryText` are memoized with `useMemo` to avoid unnecessary recomputations


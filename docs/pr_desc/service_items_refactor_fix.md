# Service Items Settings Refactor and Drag-and-Drop Fix

## Overview
This PR refactors the Service Items Settings page to adhere to the project's architectural guidelines and fixes a critical regression in the drag-and-drop functionality.

## Changes

### 1. Architecture Cleanup
- **Removed Zustand**: Deleted `serviceItemsStore.ts` and `SettingsContext.tsx` to comply with the project's rule against using Zustand for local UI state.
- **State Management**: Migrated UI state (dragged item, editing state) to `useState` within `SettingsServiceItemsPage`.
- **Data Fetching**: Fully leveraged React Query (TanStack Query) for server state management, caching, and optimistic updates.

### 2. Drag-and-Drop Fix
- **Fix Stale Closure**: Updated `handleMoveServiceItem` in `SettingsServiceItemsPage.tsx` to include `appointmentTypeIdToIndexMap` in its dependency array. This ensures the move handler always has access to the latest index map, fixing the issue where dragging failed after the initial load.
- **Performance**: Implemented `useMemo` to generate an $O(1)$ lookup map (`appointmentTypeIdToIndexMap`) for efficient index retrieval during drag operations.
- **Mobile Support**: Verified and maintained `Touch Event API` support in `ServiceItemsTable.tsx` for mobile devices.

### 3. Styling & Cleanup
- **Tailwind JIT Fix**: Replaced dynamic class strings (e.g., `opacity-${value}`) with inline `style` props to prevent Tailwind from purging these classes in production.
- **Log Cleanup**: Removed all `console.log` debugging statements and commented-out code.

## Verification
- **Manual Testing**: Verified drag-and-drop reordering works correctly on desktop.
- **Regression**: Confirmed that the "move" handler triggers correctly and updates the UI optimistically.

## Refactor: Modernize Service Items Settings Page

This pull request completes a significant refactoring of the `SettingsServiceItemsPage` to improve its architecture, type safety, performance, and maintainability. The primary goal was to migrate component-level state to a centralized Zustand store, enforce strict TypeScript typing, and implement robust error handling with rollback mechanisms.

### Key Changes:

1.  **State Management with Zustand:**
    *   All local UI state (e.g., `editingItemId`, `searchQuery`, `draggedItemId`) has been moved to a dedicated Zustand store (`serviceItemsStore.ts`). This centralizes state logic and simplifies the main component.

2.  **Strict Type Enforcement:**
    *   Replaced all instances of `any` with specific types inferred from Zod schemas (`ClinicSettings`) or defined in `types.ts` (`AppointmentType`, `ServiceTypeGroup`).
    *   API payloads for creating and reordering items/groups are now strictly typed (`AppointmentTypeOrderPayload`, `GroupOrderPayload`).

3.  **Robust Optimistic Updates with Rollback:**
    *   Implemented "Snapshot and Rollback" pattern for all mutation operations (drag-and-drop, save order, etc.)
    *   Uses React Query's `getQueryData` and `setQueryData` to capture state before mutations
    *   Automatic rollback on API failure ensures data integrity
    *   Added `cancelQueries` to prevent race conditions during optimistic updates

4.  **Performance Optimizations:**
    *   Replaced O(n) `findIndex` and `find` operations with O(1) lookups using memoized Maps
    *   Created `appointmentTypeIdToIndexMap` and `serviceGroupIdToIndexMap` for efficient drag-and-drop operations
    *   Optimized re-renders with proper dependency arrays and memoization

5.  **Enhanced User Experience:**
    *   Added visual drop indicators (blue borders) showing where items will land during drag operations
    *   Implemented full mobile touch support with `handleTouchStart`, `handleTouchMove`, and `handleTouchEnd`
    *   Improved drag state management with proper cleanup to prevent memory leaks

6.  **Code Quality Improvements:**
    *   Extracted all magic numbers to named constants (debounce delays, border widths, opacity values)
    *   Centralized configuration in `CONSTANTS` objects for better maintainability
    *   Improved error handling with consistent logging and user feedback

7.  **Bug Fixes and Type Resolution:**
    *   Resolved numerous TypeScript errors that surfaced during the refactor in `ServiceItemsTable.tsx` and `SettingsContext.tsx`
    *   Fixed a subtle bug in the drag-and-drop `handleDragOver` logic where an incorrect variable was used
    *   Corrected the `SettingsContext` to properly fetch data from their respective hooks (`useClinicSettings` and `useServiceTypeGroups`)
    *   Fixed memory leaks by adding proper cleanup in `useEffect` hooks

8.  **Test Suite Compliance:**
    *   After fixing the type errors introduced during the refactor, the entire frontend test suite (`run_tests.sh`) is now passing
    *   All new functionality is covered by existing tests

### Technical Implementation Details:

- **Snapshot Pattern**: Before performing an optimistic update, the current React Query cache state is captured. If the API call fails, the cache is restored to this snapshot, ensuring data consistency.
- **Memoized Lookups**: Created ID-to-index mappings using `useMemo` to optimize performance for clinics with large numbers of service items.
- **Touch Event Handling**: Implemented comprehensive touch event support for mobile devices, ensuring the drag-and-drop functionality works seamlessly across all platforms.
- **Visual Feedback**: Added blue border indicators that show users exactly where their dragged item will be placed, improving the overall user experience.

These changes make the settings page more robust, performant, and safer to modify while providing a better user experience across all devices.
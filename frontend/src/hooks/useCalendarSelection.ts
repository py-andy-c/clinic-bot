import { useState, useEffect, useRef } from 'react';
import { calendarStorage } from '../utils/storage';

interface UseCalendarSelectionOptions<T extends { id: number }> {
  /** Current list of items (e.g., practitioners, resources) */
  items: T[];
  /** User ID for storage key */
  userId: number | undefined;
  /** Clinic ID for storage key */
  clinicId: number | null | undefined;
  /** Function to validate if an item is valid (e.g., not deleted) */
  validateItem: (item: T) => boolean;
  /** Storage type - 'practitioners' uses calendarStorage, 'resources' uses resource selection */
  storageType: 'practitioners' | 'resources';
  /** Whether to wait for all items to load before marking as loaded (prevents race conditions) */
  waitForAllItems?: boolean;
  /** Callback when selection changes (for practitioners, this is called after validation) */
  onSelectionChange?: (ids: number[]) => void;
}

/**
 * Unified hook for managing calendar selection persistence.
 * 
 * Handles:
 * - Loading persisted IDs from storage
 * - Validating IDs against current items list
 * - Saving selection changes
 * - Clearing selection on clinic change
 * - Race condition prevention (waiting for all items to load)
 */
export function useCalendarSelection<T extends { id: number }>({
  items,
  userId,
  clinicId,
  validateItem,
  storageType,
  waitForAllItems = false,
  onSelectionChange,
}: UseCalendarSelectionOptions<T>) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const hasLoadedRef = useRef(false);
  const isInitialLoadRef = useRef(true);
  const previousClinicIdRef = useRef<number | null>(null);
  const persistedIdsRef = useRef<number[]>([]);

  // Reset when clinic changes
  useEffect(() => {
    if (clinicId !== previousClinicIdRef.current && previousClinicIdRef.current !== null) {
      hasLoadedRef.current = false;
      isInitialLoadRef.current = true;
      setSelectedIds([]);
    }
    previousClinicIdRef.current = clinicId ?? null;
  }, [clinicId]);

  // Load persisted selection
  useEffect(() => {
    if (!userId || !clinicId || items.length === 0) {
      return;
    }

    // Skip if already loaded (unless we're waiting for more items)
    if (hasLoadedRef.current && !waitForAllItems) {
      return;
    }

    // Load persisted IDs
    let persistedIds: number[] = [];
    if (storageType === 'resources') {
      persistedIds = calendarStorage.getResourceSelection(userId, clinicId);
    } else {
      // For practitioners, IDs are stored in calendarState
      const state = calendarStorage.getCalendarState(userId, clinicId);
      persistedIds = state?.additionalPractitionerIds || [];
    }

    persistedIdsRef.current = persistedIds;

    // Filter out invalid IDs
    const validIds = persistedIds.filter(id => {
      const item = items.find(i => i.id === id);
      return item && validateItem(item);
    });

    // If waitForAllItems is true, check if we filtered out IDs
    // This means items might still be loading - wait for more items
    if (waitForAllItems && validIds.length < persistedIds.length && persistedIds.length > 0) {
      // Don't mark as loaded yet - wait for more items
      return;
    }

    // All persisted IDs are valid (or there were none), set the selection
    setSelectedIds(validIds);
    hasLoadedRef.current = true;
    isInitialLoadRef.current = true; // Mark that we're doing initial load

    // Notify parent of the loaded selection
    if (onSelectionChange) {
      onSelectionChange(validIds);
    }

    // Reset initial load flag after a tick to allow save effect to run for user changes
    // Use requestAnimationFrame for better timing and cleanup
    const timeoutId = setTimeout(() => {
      isInitialLoadRef.current = false;
    }, 0);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [userId, clinicId, items, validateItem, storageType, waitForAllItems]);

  // Save selection when it changes (after initial load)
  useEffect(() => {
    if (!userId || !clinicId || !hasLoadedRef.current || isInitialLoadRef.current) {
      // Don't save if not loaded yet or during initial load
      return;
    }

    if (storageType === 'resources') {
      calendarStorage.setResourceSelection(userId, clinicId, selectedIds);
    } else {
      // For practitioners, update calendarState
      const currentState = calendarStorage.getCalendarState(userId, clinicId);
      const defaultDate = new Date().toISOString().split('T')[0];
      const updatedState = {
        view: (currentState?.view || 'day') as 'month' | 'week' | 'day',
        currentDate: (currentState?.currentDate ?? defaultDate) as string,
        additionalPractitionerIds: selectedIds,
        defaultPractitionerId: currentState?.defaultPractitionerId || null,
      };
      calendarStorage.setCalendarState(userId, clinicId, updatedState);
    }
  }, [userId, clinicId, selectedIds, storageType]);

  // Clean up invalid IDs when items change
  useEffect(() => {
    if (!hasLoadedRef.current || selectedIds.length === 0) {
      return;
    }

    const validIds = selectedIds.filter(id => {
      const item = items.find(i => i.id === id);
      return item && validateItem(item);
    });

    if (validIds.length !== selectedIds.length) {
      setSelectedIds(validIds);
    }
    // Note: We intentionally don't include selectedIds in dependencies to avoid infinite loops
    // This effect only runs when items or validateItem changes, which is when cleanup is needed
  }, [items, validateItem]);

  return {
    selectedIds,
    setSelectedIds,
    hasLoaded: hasLoadedRef.current,
  };
}


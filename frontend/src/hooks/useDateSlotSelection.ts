/**
 * Custom hook for managing date and slot selection in appointment flows.
 * 
 * Handles:
 * - Loading slots from cache when date is selected
 * - Making API calls only when necessary (dates outside current month)
 * - Coordinating with batch availability loading
 */

import { useState, useEffect } from 'react';

interface UseDateSlotSelectionProps {
  selectedDate: string | null;
  appointmentTypeId: number | null;
  selectedPractitionerId: number | null;
  excludeCalendarEventId?: number | null;
  currentMonth: Date;
  cachedAvailabilityData: Map<string, { slots: Array<{ start_time: string; end_time?: string; is_recommended?: boolean }> }>;
  loadingAvailability: boolean;
  batchInitiatedRef: React.MutableRefObject<boolean>;
}

interface UseDateSlotSelectionReturn {
  availableSlots: string[];
  isLoadingSlots: boolean;
}

export const useDateSlotSelection = ({
  selectedDate,
  appointmentTypeId,
  selectedPractitionerId,
  excludeCalendarEventId,
  currentMonth,
  cachedAvailabilityData,
  loadingAvailability,
  batchInitiatedRef,
}: UseDateSlotSelectionProps): UseDateSlotSelectionReturn => {
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);

  // Clear slots when practitioner changes
  useEffect(() => {
    setAvailableSlots([]);
    setIsLoadingSlots(false);
  }, [selectedPractitionerId]);

  // Update slots from cache when cache is updated and a date is selected
  // This effect handles the case where batch completes after date is already selected
  useEffect(() => {
    if (!selectedDate || !selectedPractitionerId) {
      return;
    }

    // Wait for loading to complete before checking cache
    if (loadingAvailability) {
      return;
    }

    // Cache key includes practitioner ID to ensure we get the right practitioner's slots
    const cacheKey = `${selectedPractitionerId}-${selectedDate}`;
    
    if (cachedAvailabilityData.size > 0) {
      const cachedData = cachedAvailabilityData.get(cacheKey);
      if (cachedData) {
        // Use cached data - no API call needed
        const slots = cachedData.slots.map((slot) => slot.start_time);
        setAvailableSlots(slots);
        setIsLoadingSlots(false);
      } else {
        // Cache exists but doesn't have data for this practitioner-date combination
        // This can happen when switching practitioners - clear slots
        setAvailableSlots([]);
        setIsLoadingSlots(false);
      }
    } else {
      // Cache is empty - clear slots
      setAvailableSlots([]);
      setIsLoadingSlots(false);
    }
  }, [selectedDate, selectedPractitionerId, cachedAvailabilityData, loadingAvailability]);

  // Load available slots when date is selected
  // Only makes API calls for dates outside the current month (not in batch cache)
  useEffect(() => {
    if (selectedDate && appointmentTypeId && selectedPractitionerId) {
      const loadAvailableSlots = async () => {
        // Wait for batch to complete to avoid race condition
        if (loadingAvailability || !batchInitiatedRef.current) {
          // Batch is still loading or hasn't started, wait for it to complete
          // The cache update effect will handle updating slots when batch completes
          return;
        }

        // Check if date is in the current month (should be in batch cache)
        const selectedDateObj = new Date(selectedDate + 'T00:00:00');
        const isInCurrentMonth = 
          selectedDateObj.getFullYear() === currentMonth.getFullYear() &&
          selectedDateObj.getMonth() === currentMonth.getMonth();

        // If date is in current month, rely entirely on cache - don't make GET call
        // The cache update effect will handle populating slots when batch completes
        if (isInCurrentMonth) {
          // Cache key includes practitioner ID
          const cacheKey = `${selectedPractitionerId}-${selectedDate}`;
          const cachedData = cachedAvailabilityData.get(cacheKey);
          if (cachedData) {
            // Use cached data - no API call needed
            const slots = cachedData.slots.map((slot) => slot.start_time);
            setAvailableSlots(slots);
            setIsLoadingSlots(false);
          }
          // If not in cache yet, cache update effect will handle it when batch completes
          return;
        }

        // Date is outside current month - check cache first
        // Cache key includes practitioner ID
        const cacheKey = `${selectedPractitionerId}-${selectedDate}`;
        const cachedData = cachedAvailabilityData.get(cacheKey);
        if (cachedData) {
          // Use cached data - no API call needed
          const slots = cachedData.slots.map((slot) => slot.start_time);
          setAvailableSlots(slots);
          setIsLoadingSlots(false);
          return;
        }

        // Date is outside current month and not in cache
        // Don't make GET call - user is viewing a different month, so clear slots
        // This prevents unnecessary API calls when user navigates to a different month
        setAvailableSlots([]);
        setIsLoadingSlots(false);
      };
      loadAvailableSlots();
    }
  }, [
    selectedDate,
    appointmentTypeId,
    selectedPractitionerId,
    excludeCalendarEventId,
    cachedAvailabilityData,
    loadingAvailability,
    currentMonth,
    batchInitiatedRef,
  ]);

  return {
    availableSlots,
    isLoadingSlots,
  };
};


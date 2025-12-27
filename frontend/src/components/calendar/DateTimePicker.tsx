/**
 * DateTimePicker Component
 * 
 * Shared date/time picker component for appointment creation and editing.
 * Features calendar view with month navigation and time slot selection.
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { LoadingSpinner, TimeInput, ConflictDisplay, InfoButton, InfoModal } from '../shared';
import { apiService } from '../../services/api';
import { logger } from '../../utils/logger';
import { SchedulingConflictResponse } from '../../types';
import { useDateSlotSelection } from '../../hooks/useDateSlotSelection';
import { useDebounce } from '../../hooks/useDebounce';
import {
  generateCalendarDays,
  isToday,
  formatMonthYear,
  formatDateString,
  buildDatesToCheckForMonth,
  formatAppointmentDateTime,
} from '../../utils/calendarUtils';
import {
  getCacheKey,
  getCachedSlots,
  setCachedSlots,
} from '../../utils/availabilityCache';
import moment from 'moment-timezone';

export interface DateTimePickerProps {
  selectedDate: string | null;
  selectedTime: string;
  selectedPractitionerId: number | null;
  appointmentTypeId: number | null;
  onDateSelect: (date: string | null) => void;
  onTimeSelect: (time: string) => void;
  // Optional: exclude this calendar event ID from conflict checking (for appointment editing)
  excludeCalendarEventId?: number | null;
  error?: string | null;
  // Optional: notify parent when the current date has any available slots
  onHasAvailableSlotsChange?: (hasSlots: boolean) => void;
  // Optional: notify parent when practitioner doesn't offer appointment type (404 error)
  onPractitionerError?: (errorMessage: string) => void;
  // Optional: force clear cache when practitioner error is detected
  practitionerError?: string | null;
  // Optional: enable override mode toggle
  allowOverride?: boolean;
  // Optional: callback when override mode changes
  onOverrideChange?: (enabled: boolean) => void;
  // Optional: force override mode state from parent
  isOverrideMode?: boolean;
  // Optional: initial expanded state
  initialExpanded?: boolean;
}

const dayNames = ['日', '一', '二', '三', '四', '五', '六'];

export const DateTimePicker: React.FC<DateTimePickerProps> = React.memo(({
  selectedDate,
  selectedTime,
  selectedPractitionerId,
  appointmentTypeId,
  onDateSelect,
  onTimeSelect,
  excludeCalendarEventId,
  error,
  onHasAvailableSlotsChange,
  onPractitionerError,
  practitionerError,
  allowOverride = false,
  onOverrideChange,
  isOverrideMode: parentOverrideMode,
  initialExpanded = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(initialExpanded);
  const pickerRef = useRef<HTMLDivElement>(null);
  
  // Store initial values to ensure original time is always selectable in edit mode,
  // even if it doesn't align with the standard availability grid.
  const initialValuesRef = useRef({
    date: selectedDate,
    time: selectedTime,
    practitionerId: selectedPractitionerId
  });

  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    // Initialize to selected date or today
    if (selectedDate) {
      const parts = selectedDate.split('-').map(Number);
      const year = parts[0] ?? new Date().getFullYear();
      const month = parts[1] ?? new Date().getMonth() + 1;
      const day = parts[2] ?? new Date().getDate();
      return new Date(year, month - 1, day);
    }
    return new Date();
  });
  const [datesWithSlots, setDatesWithSlots] = useState<Set<string>>(new Set());
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  // Cache batch availability data to avoid redundant API calls when dates are selected
  const [cachedAvailabilityData, setCachedAvailabilityData] = useState<Map<string, { slots: any[] }>>(new Map());
  // Track if batch has been initiated to prevent race condition with date selection
  const batchInitiatedRef = useRef(false);
  // Track if we've initialized temp state for this expand session
  const hasInitializedRef = useRef(false);
  // Track if user manually collapsed to prevent immediate re-expansion
  const userCollapsedRef = useRef(false);
  // Track if a date was just clicked to preserve tempDate during initialization
  const dateJustClickedRef = useRef(false);

  // Temp selection state for UI navigation (only used when expanded)
  const [tempDate, setTempDate] = useState<string | null>(selectedDate);
  const [tempTime, setTempTime] = useState<string>(selectedTime);
  // Track last manually selected time (not auto-filled) to preserve when switching dates
  const [lastManuallySelectedTime, setLastManuallySelectedTime] = useState<string | null>(null);

  // Override mode state
  const [overrideMode, setOverrideMode] = useState(false);
  const [freeFormTime, setFreeFormTime] = useState('');
  const [conflictInfo, setConflictInfo] = useState<SchedulingConflictResponse | null>(null);
  const [isCheckingConflict, setIsCheckingConflict] = useState(false);
  const [conflictCheckError, setConflictCheckError] = useState<string | null>(null);
  const [showOverrideInfoModal, setShowOverrideInfoModal] = useState(false);

  // Determine which date/time to use for display and slot loading
  // Use tempDate/tempTime when expanded (for UI navigation), selectedDate/selectedTime when collapsed
  // If tempDate is set (user clicked a date), use it even if picker appears collapsed
  const displayDate = (isExpanded && tempDate) ? tempDate : (tempDate || selectedDate);
  const displayTime = isExpanded ? tempTime : selectedTime;

  // Use custom hook for date/slot selection logic
  const { availableSlots, isLoadingSlots } = useDateSlotSelection({
    selectedDate: displayDate,
    appointmentTypeId,
    selectedPractitionerId,
    excludeCalendarEventId: excludeCalendarEventId ?? null,
    currentMonth,
    cachedAvailabilityData,
    loadingAvailability,
    batchInitiatedRef,
  });

  // Build time slots list - backend already includes original time when excludeCalendarEventId is provided
  // Use tempDate when expanded, selectedDate when collapsed
  const allTimeSlots = useMemo(() => {
    // If there's a practitioner error, don't show any slots
    if (practitionerError) {
      return [];
    }
    
    const slots = [...availableSlots];

    // In edit mode, if we are on the original date and practitioner, 
    // ensure the original time is included in the list even if it's not in the standard grid.
    if (excludeCalendarEventId && 
        displayDate === initialValuesRef.current.date && 
        selectedPractitionerId === initialValuesRef.current.practitionerId &&
        initialValuesRef.current.time &&
        !slots.includes(initialValuesRef.current.time)) {
      slots.push(initialValuesRef.current.time);
      slots.sort();
    }
    
    return slots;
  }, [availableSlots, practitionerError, excludeCalendarEventId, displayDate, selectedPractitionerId]);

  // Debounced conflict checking - debounce time/date changes, but check immediately when practitioner/appointment type changes
  const debouncedTime = useDebounce(displayTime, 300);
  const debouncedDate = useDebounce(displayDate, 300);
  
  // Track previous practitioner/appointment type to detect immediate changes
  const prevPractitionerRef = useRef(selectedPractitionerId);
  const prevAppointmentTypeRef = useRef(appointmentTypeId);

  // Track the last checked values to avoid redundant calls
  const lastCheckedRef = useRef<{
    practitionerId: number | null;
    typeId: number | null;
    date: string | null;
    time: string | null;
  }>({
    practitionerId: null,
    typeId: null,
    date: null,
    time: null
  });

  // Conflict detection effect - always check conflicts when date/time/practitioner/appointment type changes
  useEffect(() => {
    // Check if practitioner or appointment type changed (Immediate triggers)
    const practitionerOrTypeChanged = 
      prevPractitionerRef.current !== selectedPractitionerId || 
      prevAppointmentTypeRef.current !== appointmentTypeId;
    
    // Determine which values to use for checking
    // Use immediate values for practitioner/type changes, debounced for date/time changes
    const checkDate = practitionerOrTypeChanged ? displayDate : debouncedDate;
    const checkTime = practitionerOrTypeChanged ? displayTime : debouncedTime;

    // Update refs for next run
    prevPractitionerRef.current = selectedPractitionerId;
    prevAppointmentTypeRef.current = appointmentTypeId;

    // Skip if missing required values
    if (!checkDate || !checkTime || !selectedPractitionerId || !appointmentTypeId) {
      setConflictInfo(null);
      setConflictCheckError(null);
      return;
    }

    // Avoid redundant checks if values haven't changed from last checked
    if (
      lastCheckedRef.current.practitionerId === selectedPractitionerId &&
      lastCheckedRef.current.typeId === appointmentTypeId &&
      lastCheckedRef.current.date === checkDate &&
      lastCheckedRef.current.time === checkTime
    ) {
      return;
    }

    // Update last checked ref
    lastCheckedRef.current = {
      practitionerId: selectedPractitionerId,
      typeId: appointmentTypeId,
      date: checkDate,
      time: checkTime
    };

    // Skip initial conflict check for existing appointments (Stable Mount)
    const isOriginalValue = 
      checkDate === initialValuesRef.current.date && 
      checkTime === initialValuesRef.current.time && 
      selectedPractitionerId === initialValuesRef.current.practitionerId;
    
    if (isOriginalValue && excludeCalendarEventId) {
      setConflictInfo(null);
      setConflictCheckError(null);
      return;
    }

    const abortController = new AbortController();

    const checkConflicts = async () => {
      // If the selected time is in our cached available slots, assume no conflict
      // This provides a snappy UX for standard slot selection.
      // Final validation still happens on the backend during save.
      if (allTimeSlots.includes(checkTime)) {
        setConflictInfo(null);
        setConflictCheckError(null);
        setIsCheckingConflict(false);
        return;
      }

      setIsCheckingConflict(true);
      setConflictCheckError(null);
      try {
        const response = await apiService.checkSchedulingConflicts(
          selectedPractitionerId,
          checkDate,
          checkTime,
          appointmentTypeId,
          excludeCalendarEventId ?? undefined,
          abortController.signal
        );
        // Only update conflict info once we have the result to prevent UI flashing
        setConflictInfo(response);
      } catch (error: any) {
        if (error?.name === 'CanceledError' || error?.name === 'AbortError') return;
        logger.error('Failed to check scheduling conflicts:', error);
        // Show user-friendly error message per design doc
        setConflictCheckError('無法檢查時間衝突，請稍後再試');
        // Clear conflict info on error - don't block scheduling
        setConflictInfo(null);
      } finally {
        setIsCheckingConflict(false);
      }
    };

    checkConflicts();
    return () => abortController.abort();
  }, [debouncedDate, debouncedTime, selectedPractitionerId, appointmentTypeId, excludeCalendarEventId, displayDate, displayTime, allTimeSlots]);

  // Update currentMonth when selectedDate changes (but only if it's a different month)
  // Don't reset if user manually navigated to a different month
  useEffect(() => {
    if (selectedDate) {
      const parts = selectedDate.split('-').map(Number);
      const year = parts[0] ?? new Date().getFullYear();
      const month = parts[1] ?? new Date().getMonth() + 1;
      const day = parts[2] ?? new Date().getDate();
      const selectedDateMonth = new Date(year, month - 1, day);
      const selectedMonth = new Date(year, month - 1, 1);
      
      // Use functional update to get current value and avoid stale closure
      setCurrentMonth(prevMonth => {
        // Only update if selectedDate is in a different month than current month
        // This allows manual navigation to work without being reset
        if (selectedDateMonth.getMonth() !== prevMonth.getMonth() || 
            selectedDateMonth.getFullYear() !== prevMonth.getFullYear()) {
          return selectedMonth;
        }
        return prevMonth; // Keep current month if same
      });
    }
  }, [selectedDate]); // Only run when selectedDate changes, not when currentMonth changes

  // Clear slots and cache when practitioner changes or when practitioner error is detected
  useEffect(() => {
    setDatesWithSlots(new Set());
    setCachedAvailabilityData(new Map());
    batchInitiatedRef.current = false;
    setLastManuallySelectedTime(null); // Clear last manually selected time
    if (onHasAvailableSlotsChange) {
      onHasAvailableSlotsChange(false);
    }
  }, [selectedPractitionerId, practitionerError, onHasAvailableSlotsChange]);

  // Clear lastManuallySelectedTime when appointment type changes
  useEffect(() => {
    setLastManuallySelectedTime(null);
  }, [appointmentTypeId]);

  // Track previous slot candidate values to detect changes
  const prevSlotCandidatesRef = useRef<{
    practitionerId: number | null;
    appointmentTypeId: number | null;
    date: string | null;
  }>({
    practitionerId: selectedPractitionerId,
    appointmentTypeId: appointmentTypeId,
    date: selectedDate,
  });

  // Reset override mode when slot candidates change (practitioner/appointment type/date)
  useEffect(() => {
    const prev = prevSlotCandidatesRef.current;
    const hasChanged = 
      prev.practitionerId !== selectedPractitionerId ||
      prev.appointmentTypeId !== appointmentTypeId ||
      prev.date !== selectedDate;
    
    if (hasChanged) {
      // Update ref first to prevent duplicate resets
      prevSlotCandidatesRef.current = {
        practitionerId: selectedPractitionerId,
        appointmentTypeId: appointmentTypeId,
        date: selectedDate,
      };
      
      // Reset override mode if it's currently enabled
      if (overrideMode) {
        setOverrideMode(false);
        onOverrideChange?.(false);
        setConflictInfo(null);
        setFreeFormTime('');
      }
    }
  }, [selectedPractitionerId, appointmentTypeId, selectedDate, overrideMode, onOverrideChange]);

  // Sync override mode with parent prop
  useEffect(() => {
    if (parentOverrideMode !== undefined) {
      setOverrideMode(parentOverrideMode);
    }
  }, [parentOverrideMode]);

  // Load month availability for calendar
  useEffect(() => {
    // Defer loading until expanded, UNLESS a time is already selected (Create mode pre-fill)
    const shouldLoad = isExpanded || (selectedDate && selectedTime && !excludeCalendarEventId);
    
    if (!shouldLoad || !appointmentTypeId || !selectedPractitionerId) {
      if (!shouldLoad) {
        setDatesWithSlots(new Set());
        batchInitiatedRef.current = false;
      }
      return;
    }

    const abortController = new AbortController();

    const loadMonthAvailability = async () => {
      setLoadingAvailability(true);
      batchInitiatedRef.current = true;
      try {
        const datesToCheck = buildDatesToCheckForMonth(currentMonth);
        if (datesToCheck.length === 0) {
          setDatesWithSlots(new Set());
          setLoadingAvailability(false);
          return;
        }

        const monthKey = `${currentMonth.getFullYear()}-${currentMonth.getMonth() + 1}`;
        
        // Check global cache first
        const datesWithAvailableSlots = new Set<string>();
        const newLocalCache = new Map<string, { slots: any[] }>();
        let allInCache = true;

        datesToCheck.forEach(date => {
          const cacheKey = getCacheKey(selectedPractitionerId, appointmentTypeId, monthKey, date);
          const cachedSlots = getCachedSlots(cacheKey);
          if (cachedSlots !== null) {
            newLocalCache.set(`${selectedPractitionerId}-${date}`, { slots: cachedSlots });
            if (cachedSlots.length > 0) datesWithAvailableSlots.add(date);
          } else {
            allInCache = false;
          }
        });

        if (allInCache && datesToCheck.length > 0) {
          setCachedAvailabilityData(newLocalCache);
          setDatesWithSlots(datesWithAvailableSlots);
          setLoadingAvailability(false);
          return;
        }

        try {
          const batchResponse = await apiService.getBatchAvailableSlots(
            selectedPractitionerId,
            datesToCheck,
            appointmentTypeId,
            excludeCalendarEventId ?? undefined,
            abortController.signal
          );

          const finalDatesWithAvailableSlots = new Set<string>();
          const finalLocalCache = new Map<string, { slots: any[] }>();

          batchResponse.results.forEach((result) => {
            if (result.date) {
              const cacheKey = getCacheKey(selectedPractitionerId, appointmentTypeId, monthKey, result.date);
              const slots = result.available_slots || [];
              
              setCachedSlots(cacheKey, slots);
              finalLocalCache.set(`${selectedPractitionerId}-${result.date}`, { slots });
              
              if (slots.length > 0) {
                finalDatesWithAvailableSlots.add(result.date);
              }
            }
          });

          setCachedAvailabilityData(finalLocalCache);
          setDatesWithSlots(finalDatesWithAvailableSlots);
        } catch (err: any) {
          if (err?.name === 'CanceledError' || err?.name === 'AbortError') return;
          const statusCode = err?.response?.status;
          if (statusCode === 404) {
            const practitionerErrorMessage = '此治療師不提供此預約類型';
            if (onPractitionerError) onPractitionerError(practitionerErrorMessage);
            setDatesWithSlots(new Set());
            if (onHasAvailableSlotsChange) onHasAvailableSlotsChange(false);
          } else {
            setDatesWithSlots(new Set());
          }
        }
      } catch (err) {
        if ((err as any)?.name === 'CanceledError' || (err as any)?.name === 'AbortError') return;
        logger.error('Failed to load month availability:', err);
      } finally {
        setLoadingAvailability(false);
      }
    };

    loadMonthAvailability();
    return () => abortController.abort();
  }, [currentMonth, appointmentTypeId, selectedPractitionerId, excludeCalendarEventId, isExpanded, onHasAvailableSlotsChange, onPractitionerError]);

  // Date/slot selection logic is now handled by useDateSlotSelection hook

  // Calendar helpers
  const calendarDays = useMemo(() => generateCalendarDays(currentMonth), [currentMonth]);

  const isDateAvailable = (date: Date): boolean => {
    const dateString = formatDateString(date);
    return datesWithSlots.has(dateString);
  };

  // Auto-expand when empty (no date or time selected)
  // The unavailable time check above handles expanding when time becomes unavailable
  // But don't auto-expand if user just manually collapsed
  useEffect(() => {
    if ((!selectedDate || !selectedTime) && !userCollapsedRef.current) {
      setIsExpanded(true);
    } else if (selectedDate && selectedTime) {
      // Reset flag when picker becomes non-empty (user has made a selection)
      userCollapsedRef.current = false;
    }
  }, [selectedDate, selectedTime]);

  // Reset user collapse flag when picker becomes expanded (allows future auto-expand)
  useEffect(() => {
    if (isExpanded) {
      userCollapsedRef.current = false;
    }
  }, [isExpanded]);

  // Initialize temp state when expanding (only when isExpanded changes, not when tempDate changes)
  useEffect(() => {
    if (isExpanded) {
      // Only initialize if we haven't initialized yet for this expand session
      // This prevents resetting tempTime when user navigates between dates
      // But if tempDate is already set (from date click), preserve it
      if (!hasInitializedRef.current) {
        // If we just clicked a date, tempDate is already set, so don't overwrite it
        if (!dateJustClickedRef.current) {
          setTempDate(selectedDate);
          setTempTime(selectedTime);
        }
        // Set lastManuallySelectedTime to original selectedTime so it can be auto-selected when switching dates
        if (selectedTime) {
          setLastManuallySelectedTime(selectedTime);
        }
        hasInitializedRef.current = true;
        dateJustClickedRef.current = false; // Reset flag
      }
    } else {
      // Clear temp state when collapsing
      setTempDate(null);
      setTempTime('');
      setLastManuallySelectedTime(null);
      hasInitializedRef.current = false; // Reset flag for next expand
      dateJustClickedRef.current = false; // Reset flag
    }
  }, [isExpanded, selectedDate, selectedTime]);

  const handleDateSelect = (date: Date) => {
    const dateString = formatDateString(date);
    // Always set tempDate when a date is selected, regardless of whether it has slots
    // This ensures the time picker shows up even if the date doesn't have slots yet
    dateJustClickedRef.current = true; // Mark that we just clicked a date
    setTempDate(dateString);
    setTempTime('');
    // Ensure picker is expanded so time slots are visible
    if (!isExpanded) {
      setIsExpanded(true);
    }
    // Also call parent's onDateSelect to update selectedDate
    onDateSelect(dateString);
  };

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  // Sort time slots chronologically (no AM/PM grouping)
  const sortedTimeSlots = useMemo(() => {
    return [...allTimeSlots].sort();
  }, [allTimeSlots]);

  // Notify parent about availability of time slots for the currently selected date
  useEffect(() => {
    if (onHasAvailableSlotsChange) {
      onHasAvailableSlotsChange(allTimeSlots.length > 0);
    }
  }, [allTimeSlots.length, onHasAvailableSlotsChange]);

  // Auto-deselect and expand if selectedTime becomes unavailable
  // This ensures the picker is never collapsed with an unavailable time selected
  // Checks when: slots load, date changes, practitioner changes, appointment type changes
  // NOTE: Skip this check when override mode is enabled - override mode allows any time
  useEffect(() => {
    // Skip check if override mode is enabled - override mode allows scheduling outside normal availability
    if (overrideMode) {
      return;
    }

    // Skip check while slots are loading to avoid clearing time prematurely
    // Also check loadingAvailability since isLoadingSlots might be false while batch is loading
    if (isLoadingSlots || loadingAvailability || !selectedTime || !selectedDate || !selectedPractitionerId) {
      return;
    }

    // Only check availability if batch has been initiated (meaning we've attempted to load slots)
    // This prevents clearing time before slots have been loaded
    if (!batchInitiatedRef.current) {
      return;
    }

    // Check if cache has data for this date - if not, slots haven't loaded yet
    // We need to wait for the cache to be populated before we can determine if time is unavailable
    const cacheKey = `${selectedPractitionerId}-${selectedDate}`;
    const hasCacheData = cachedAvailabilityData.has(cacheKey);

    // If cache doesn't have data for this date yet, don't clear - slots are still loading
    if (!hasCacheData) {
      return;
    }

    // In edit mode (excludeCalendarEventId is set), the backend should include the current
    // appointment's time in available slots. If allTimeSlots is empty, it might be a loading
    // issue or the backend hasn't included it yet. Don't clear in this case.
    if (excludeCalendarEventId && allTimeSlots.length === 0) {
      return;
    }

    // Check if selectedTime is unavailable:
    // - No slots available for the date (only if not in edit mode), OR
    // - Slots are available but selectedTime is not in them
    const isUnavailable = (!excludeCalendarEventId && allTimeSlots.length === 0) || 
                          (allTimeSlots.length > 0 && !allTimeSlots.includes(selectedTime));
    
    if (isUnavailable) {
      onTimeSelect('');
      setIsExpanded(true);
      setTempTime('');
      userCollapsedRef.current = false;
    }
  }, [selectedTime, allTimeSlots, isLoadingSlots, loadingAvailability, selectedDate, selectedPractitionerId, appointmentTypeId, cachedAvailabilityData, excludeCalendarEventId, onTimeSelect, overrideMode]);

  // Auto-select last manually selected time when date changes in expanded view
  useEffect(() => {
    if (isExpanded && tempDate && !tempTime && lastManuallySelectedTime && allTimeSlots.includes(lastManuallySelectedTime)) {
      setTempTime(lastManuallySelectedTime);
    }
  }, [isExpanded, tempDate, tempTime, lastManuallySelectedTime, allTimeSlots]);

  // Handle collapse - just collapse, state is already synced to parent
  const handleCollapse = useCallback(() => {
    // Mark that user manually collapsed to prevent immediate re-expansion
    userCollapsedRef.current = true;
    setIsExpanded(false);
  }, []);

  // Handle click outside to collapse
  useEffect(() => {
    if (!isExpanded) return;
    
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsidePicker = pickerRef.current && pickerRef.current.contains(target);
      // Check if click is inside a modal (modals are rendered via portal to document.body)
      // This is a defensive check - BaseModal should stop propagation, but this provides extra safety
      const isInsideModal = (target as Element)?.closest?.('[role="dialog"]') !== null;
      
      if (pickerRef.current && !isInsidePicker && !isInsideModal) {
        handleCollapse();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isExpanded, handleCollapse]);

  // Format collapsed display
  const getCollapsedDisplay = (): string => {
    if (!selectedDate || !selectedTime) {
      return '請選擇';
    }
    const dateTime = moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei');
    return formatAppointmentDateTime(dateTime.toDate());
  };

  const handleCollapsedClick = () => {
    setIsExpanded(true);
  };

  const handleTimeSelect = (time: string) => {
    // Update temp time for UI display
    setTempTime(time);
    setLastManuallySelectedTime(time);
    // Immediately update parent state - no need to wait for collapse
    onTimeSelect(time);
  };

  const handleOverrideToggle = (enabled: boolean) => {
    setOverrideMode(enabled);
    onOverrideChange?.(enabled);

    if (!enabled) {
      // When turning off override mode, clear conflict info and reset to dropdown mode
      setConflictInfo(null);
      setFreeFormTime('');
      // If current time is not in available slots, clear it
      if (displayTime && !availableSlots.includes(displayTime)) {
        onTimeSelect('');
        setTempTime('');
      }
    } else {
      // When turning on override mode, set free-form time to current selected time if valid
      if (displayTime) {
        setFreeFormTime(displayTime);
      }
    }
  };

  const handleFreeFormTimeChange = (time: string) => {
    setFreeFormTime(time);
    onTimeSelect(time);
    setTempTime(time);
  };

  // Collapsed view
  if (!isExpanded) {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          日期與時間 <span className="text-red-500">*</span>
        </label>
        <button
          type="button"
          onClick={handleCollapsedClick}
          className={`w-full border rounded-md px-3 py-2 text-left transition-colors flex items-center justify-between ${
            error
              ? 'border-red-300 bg-red-50'
              : 'border-gray-300 bg-white hover:border-gray-400'
          }`}
        >
          <span className={selectedDate && selectedTime ? 'text-gray-900' : 'text-gray-500'}>
            {getCollapsedDisplay()}
          </span>
          <div className="flex items-center gap-2">
            {isCheckingConflict && (
              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-400"></div>
            )}
            <svg
              className="w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>
        {error && (
          <p className="mt-1 text-sm text-red-600">{error}</p>
        )}
        {/* Conflict Display - always visible when there's a conflict */}
        {selectedDate && selectedTime && (
          <>
            {conflictCheckError ? (
              <div className="mt-2 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-md p-2">
                {conflictCheckError}
              </div>
            ) : (
              <div className="mt-2">
                <ConflictDisplay
                  conflictInfo={conflictInfo}
                />
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // Expanded view
  return (
    <div ref={pickerRef}>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        日期與時間 <span className="text-red-500">*</span>
      </label>
      <div className="space-y-4 mt-2">
        {/* Calendar View */}
        <div>
        {/* Month Navigation Header */}
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={handlePrevMonth}
            className="p-1.5 hover:bg-gray-100 rounded-full transition-colors"
            aria-label="上個月"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h3 className="text-base font-semibold text-gray-900">
            {formatMonthYear(currentMonth)}
          </h3>
          <button
            onClick={handleNextMonth}
            className="p-1.5 hover:bg-gray-100 rounded-full transition-colors"
            aria-label="下個月"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Days of Week Header */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {dayNames.map((day) => (
            <div key={day} className="text-center text-sm font-medium text-gray-600 py-1">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        {loadingAvailability ? (
          <div className="flex items-center justify-center py-4">
            <LoadingSpinner size="sm" />
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((date, index) => {
              if (!date) {
                return <div key={`empty-${index}`} className="h-9" />;
              }

              const dateString = formatDateString(date);
              const available = isDateAvailable(date);
              const selected = displayDate === dateString;
              const todayDate = isToday(date);
              // In override mode, all dates are selectable (even if no normal availability)
              const isEnabled = overrideMode || available;
              // In override mode, all dates should look the same (light up) - treat all as available for styling
              const displayAsAvailable = overrideMode ? true : available;

              return (
                <button
                  key={dateString}
                  onClick={() => handleDateSelect(date)}
                  disabled={!isEnabled}
                  className={`h-9 text-center rounded-lg transition-colors ${
                    selected
                      ? 'bg-blue-500 text-white font-semibold'
                      : isEnabled
                      ? 'bg-white text-gray-900 font-semibold hover:bg-gray-50 border border-gray-200'
                      : 'bg-gray-50 text-gray-400 cursor-not-allowed border border-gray-100'
                  }`}
                >
                  <div className="flex items-center justify-center h-full">
                    <span className={`${selected ? 'text-white' : displayAsAvailable ? 'text-gray-900' : 'text-gray-400'} ${todayDate ? `border-b-2 ${selected ? 'border-white' : 'border-gray-500'}` : ''}`}>
                      {date.getDate()}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Override Toggle */}
      {allowOverride && displayDate && (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="override-mode"
            checked={overrideMode}
            onChange={(e) => handleOverrideToggle(e.target.checked)}
            className="h-4 w-4 text-amber-600 focus:ring-amber-500 border-gray-300 rounded"
            aria-label="允許衝突時間"
          />
          <label htmlFor="override-mode" className="text-sm text-gray-700 flex items-center gap-1">
            允許衝突時間
            <InfoButton 
              onClick={() => setShowOverrideInfoModal(true)} 
              ariaLabel="允許衝突時間說明"
              size="small"
            />
          </label>
        </div>
      )}

      {/* Time Selection */}
      {displayDate ? (
        <div>
          {isLoadingSlots ? (
            <div className="flex items-center justify-center py-4">
              <LoadingSpinner size="sm" />
            </div>
          ) : overrideMode ? (
            // Free-form time input mode
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className="block text-sm font-medium text-gray-700">
                  時間 <span className="text-red-500">*</span>
                </label>
                {isCheckingConflict && (
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-400"></div>
                )}
              </div>
              <TimeInput
                value={freeFormTime}
                onChange={handleFreeFormTimeChange}
                placeholder="HH:MM"
                className="w-full"
              />
            </div>
          ) : error && allTimeSlots.length === 0 ? (
            // Only show error if there are no time slots available
            // If there are slots, show them even if there's an error (error might be stale)
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          ) : allTimeSlots.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-gray-700">時段</h4>
                {isCheckingConflict && (
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-400"></div>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2">
                {sortedTimeSlots.map((time) => {
                  const isSelected = displayTime === time;

                  return (
                    <button
                      key={time}
                      onClick={() => handleTimeSelect(time)}
                      className={`border rounded-md py-1.5 px-2 transition-colors text-sm font-medium ${
                        isSelected
                          ? 'bg-blue-500 text-white border-transparent'
                          : 'bg-white border-gray-200 hover:border-primary-300 hover:bg-primary-50 text-gray-900'
                      }`}
                    >
                      {time}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-gray-500">此日期沒有可用時段</p>
              <p className="text-sm text-gray-400 mt-2">請選擇其他日期</p>
            </div>
          )}
        </div>
      ) : null}
      </div>
      
      {/* Conflict Display - always visible when there's a conflict, outside collapsible section */}
      {displayDate && displayTime && (
        <>
          {conflictCheckError ? (
            <div className="mt-3 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-md p-2">
              {conflictCheckError}
            </div>
          ) : (
            <div className="mt-3">
              <ConflictDisplay
                conflictInfo={conflictInfo}
              />
            </div>
          )}
        </>
      )}
      
      {/* Override Mode Info Modal */}
      <InfoModal
        isOpen={showOverrideInfoModal}
        onClose={() => setShowOverrideInfoModal(false)}
        title="允許衝突時間"
        ariaLabel="允許衝突時間說明"
      >
        <p>顯示的時段是根據治療師的排程表計算的可用時間。</p>
        <p>啟用此選項後，您可以手動輸入任何時間來建立預約，即使該時間不在顯示的可用時段內，或與其他預約衝突。</p>
        <p>系統仍會顯示衝突警告，但不會阻止您建立預約。</p>
      </InfoModal>
    </div>
  );
});

DateTimePicker.displayName = 'DateTimePicker';


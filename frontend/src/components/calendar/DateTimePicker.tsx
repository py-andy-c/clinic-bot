/**
 * DateTimePicker Component
 * 
 * Shared date/time picker component for appointment creation and editing.
 * Features calendar view with month navigation and time slot selection.
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { LoadingSpinner } from '../shared';
import { apiService } from '../../services/api';
import { logger } from '../../utils/logger';
import { useDateSlotSelection } from '../../hooks/useDateSlotSelection';
import {
  formatTo12Hour,
  groupTimeSlots,
  generateCalendarDays,
  isToday,
  formatMonthYear,
  formatDateString,
  buildDatesToCheckForMonth,
  formatAppointmentDateTime,
} from '../../utils/calendarUtils';
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
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
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

  // Temp selection state for UI navigation (only used when expanded)
  const [tempDate, setTempDate] = useState<string | null>(null);
  const [tempTime, setTempTime] = useState<string>('');
  // Track last manually selected time (not auto-filled) to preserve when switching dates
  const [lastManuallySelectedTime, setLastManuallySelectedTime] = useState<string | null>(null);

  // Determine which date/time to use for display and slot loading
  // Use tempDate/tempTime when expanded (for UI navigation), selectedDate/selectedTime when collapsed
  const displayDate = isExpanded && tempDate ? tempDate : selectedDate;
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

  // Load month availability for calendar
  useEffect(() => {
    if (!appointmentTypeId || !selectedPractitionerId) {
      setDatesWithSlots(new Set());
      setCachedAvailabilityData(new Map()); // Clear cache when dependencies are missing
      batchInitiatedRef.current = false; // Reset batch initiated flag
      return;
    }

    const loadMonthAvailability = async () => {
      setLoadingAvailability(true); // Set loading first to prevent race condition
      batchInitiatedRef.current = true; // Mark batch as initiated
      try {
        // Use shared utility to build dates array
        const datesToCheck = buildDatesToCheckForMonth(currentMonth);

        // Use batch endpoint to fetch availability for all dates in one request
        if (datesToCheck.length === 0) {
          setDatesWithSlots(new Set());
          setCachedAvailabilityData(new Map()); // Clear cache when no dates to check
          setLoadingAvailability(false);
          return;
        }

        // Validate we don't exceed the backend limit (31 dates)
        if (datesToCheck.length > 31) {
          logger.warn(`Too many dates to check (${datesToCheck.length}), limiting to 31`);
          datesToCheck.splice(31);
        }

        try {
          const batchResponse = await apiService.getBatchAvailableSlots(
            selectedPractitionerId,
            datesToCheck,
            appointmentTypeId,
            excludeCalendarEventId ?? undefined
          );

          // Cache batch results for reuse when dates are selected
          // Cache key includes practitioner ID to ensure cache is practitioner-specific
          const newCache = new Map<string, { slots: any[] }>();
          const datesWithAvailableSlots = new Set<string>();
          batchResponse.results.forEach((result) => {
            // Date is now included in response (unified format with LIFF endpoint)
            if (result.date) {
              // Cache key includes practitioner ID to prevent cross-practitioner cache pollution
              const cacheKey = `${selectedPractitionerId}-${result.date}`;
              // Cache the slots data for this date
              newCache.set(cacheKey, { slots: result.available_slots || [] });
              
              // Track dates with available slots
              if (result.available_slots && result.available_slots.length > 0) {
                datesWithAvailableSlots.add(result.date);
              }
            }
          });

          setCachedAvailabilityData(newCache);
          setDatesWithSlots(datesWithAvailableSlots);
        } catch (err: any) {
          // Log error with details for debugging
          // Note: This is for internal logging only, not user-facing
          const errorMessage = err?.response?.data?.detail || err?.message || 'Unknown error';
          const statusCode = err?.response?.status;
          
          // Don't retry on 400 errors (validation errors) - these are expected for dates beyond booking window
          if (statusCode === 400) {
            logger.log(`Some dates in month ${currentMonth.getFullYear()}-${currentMonth.getMonth() + 1} are beyond booking window:`, errorMessage);
            // Set empty results but don't treat as error - backend now filters invalid dates
            setDatesWithSlots(new Set());
            setCachedAvailabilityData(new Map());
          } else if (statusCode === 404) {
            // Practitioner doesn't offer this appointment type
            logger.warn(`Practitioner ${selectedPractitionerId} doesn't offer appointment type ${appointmentTypeId}:`, errorMessage);
            const practitionerErrorMessage = '此治療師不提供此預約類型';
            if (onPractitionerError) {
              onPractitionerError(practitionerErrorMessage);
            }
            setDatesWithSlots(new Set());
            setCachedAvailabilityData(new Map()); // Clear cache on error
            // Clear available slots
            if (onHasAvailableSlotsChange) {
              onHasAvailableSlotsChange(false);
            }
          } else {
            logger.warn(`Failed to load batch availability for month ${currentMonth.getFullYear()}-${currentMonth.getMonth() + 1}:`, errorMessage, err);
            setDatesWithSlots(new Set());
            setCachedAvailabilityData(new Map()); // Clear cache on error
          }
          // Don't throw - allow user to continue using the calendar
        }
      } catch (err) {
        logger.error('Failed to load month availability:', err);
        setCachedAvailabilityData(new Map()); // Clear cache on error
      } finally {
        setLoadingAvailability(false);
      }
    };

    loadMonthAvailability();
  }, [currentMonth, appointmentTypeId, selectedPractitionerId, excludeCalendarEventId]);

  // Date/slot selection logic is now handled by useDateSlotSelection hook

  // Calendar helpers
  const calendarDays = useMemo(() => generateCalendarDays(currentMonth), [currentMonth]);

  const isDateAvailable = (date: Date): boolean => {
    const dateString = formatDateString(date);
    return datesWithSlots.has(dateString);
  };

  // Initialize temp state when expanding (only when isExpanded changes, not when tempDate changes)
  useEffect(() => {
    if (isExpanded) {
      // Only initialize if we haven't initialized yet for this expand session
      // This prevents resetting tempTime when user navigates between dates
      if (!hasInitializedRef.current) {
        setTempDate(selectedDate);
        setTempTime(selectedTime);
        hasInitializedRef.current = true;
      }
    } else {
      // Clear temp state when collapsing
      setTempDate(null);
      setTempTime('');
      setLastManuallySelectedTime(null);
      hasInitializedRef.current = false; // Reset flag for next expand
    }
  }, [isExpanded, selectedDate, selectedTime]);

  const handleDateSelect = (date: Date) => {
    const dateString = formatDateString(date);
    if (datesWithSlots.has(dateString)) {
      // Update temp date and clear temp time
      // Time will be auto-selected by the effect if lastManuallySelectedTime is available
      setTempDate(dateString);
      setTempTime('');
    }
  };

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  // Build time slots list - backend already includes original time when excludeCalendarEventId is provided
  // Use tempDate when expanded, selectedDate when collapsed
  const allTimeSlots = useMemo(() => {
    // If there's a practitioner error, don't show any slots
    if (practitionerError) {
      return [];
    }
    
    // Backend already includes original time in availableSlots when excludeCalendarEventId is provided
    // No need to manually add it
    return [...availableSlots];
  }, [availableSlots, practitionerError]);

  // Group time slots
  const { amSlots, pmSlots } = useMemo(() => {
    return groupTimeSlots(allTimeSlots);
  }, [allTimeSlots]);

  // Notify parent about availability of time slots for the currently selected date
  useEffect(() => {
    if (onHasAvailableSlotsChange) {
      onHasAvailableSlotsChange(allTimeSlots.length > 0);
    }
  }, [allTimeSlots.length, onHasAvailableSlotsChange]);

  // Auto-select last manually selected time when date changes in expanded view
  useEffect(() => {
    if (isExpanded && tempDate && !tempTime && lastManuallySelectedTime && allTimeSlots.includes(lastManuallySelectedTime)) {
      setTempTime(lastManuallySelectedTime);
    }
  }, [isExpanded, tempDate, tempTime, lastManuallySelectedTime, allTimeSlots]);

  // Handle collapse - save temp state to confirmed or clear both
  const handleCollapse = useCallback(() => {
    if (tempDate && tempTime) {
      // Both valid - save both
      onDateSelect(tempDate);
      onTimeSelect(tempTime);
    } else {
      // Not both valid - clear both
      onDateSelect(null);
      onTimeSelect('');
    }
    setIsExpanded(false);
  }, [tempDate, tempTime, onDateSelect, onTimeSelect]);

  // Handle click outside to collapse
  useEffect(() => {
    if (!isExpanded) return;
    
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        // Defer collapse to allow checkbox click events to complete
        setTimeout(() => {
          handleCollapse();
        }, 0);
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
    // Update temp time and track as manually selected
    setTempTime(time);
    setLastManuallySelectedTime(time);
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
          className={`w-full border rounded-md px-3 py-2 text-left transition-colors ${
            error
              ? 'border-red-300 bg-red-50'
              : 'border-gray-300 bg-white hover:border-gray-400'
          }`}
        >
          <span className={selectedDate && selectedTime ? 'text-gray-900' : 'text-gray-500'}>
            {getCollapsedDisplay()}
          </span>
          <svg
            className="w-5 h-5 float-right text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {error && (
          <p className="mt-1 text-sm text-red-600">{error}</p>
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
      <div className="space-y-6 mt-2">
        {/* Calendar View */}
        <div>
        {/* Month Navigation Header */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={handlePrevMonth}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            aria-label="上個月"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h3 className="text-lg font-semibold text-gray-900">
            {formatMonthYear(currentMonth)}
          </h3>
          <button
            onClick={handleNextMonth}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            aria-label="下個月"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Days of Week Header */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {dayNames.map((day) => (
            <div key={day} className="text-center text-sm font-medium text-gray-600 py-2">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        {loadingAvailability ? (
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner size="sm" />
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((date, index) => {
              if (!date) {
                return <div key={`empty-${index}`} className="aspect-square" />;
              }

              const dateString = formatDateString(date);
              const available = isDateAvailable(date);
              const selected = displayDate === dateString;
              const todayDate = isToday(date);

              return (
                <button
                  key={dateString}
                  onClick={() => handleDateSelect(date)}
                  disabled={!available}
                  className={`aspect-square text-center rounded-lg transition-colors ${
                    selected
                      ? 'bg-teal-500 text-white font-semibold'
                      : available
                      ? 'bg-white text-gray-900 font-semibold hover:bg-gray-50 border border-gray-200'
                      : 'bg-gray-50 text-gray-400 cursor-not-allowed border border-gray-100'
                  }`}
                >
                  <div className="flex flex-col items-center justify-center h-full">
                    <span className={selected ? 'text-white' : available ? 'text-gray-900' : 'text-gray-400'}>
                      {date.getDate()}
                    </span>
                    {todayDate && (
                      <div className={`w-4 h-0.5 mt-0.5 ${selected ? 'bg-white' : 'bg-gray-500'}`} />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Time Selection */}
      {displayDate ? (
        <div>
          <h3 className="font-medium text-gray-900 mb-2">可預約時段</h3>

          {isLoadingSlots ? (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner size="sm" />
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          ) : allTimeSlots.length > 0 ? (
            <div className="space-y-4">
              {amSlots.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">上午</h4>
                  <div className="grid grid-cols-3 gap-2">
                    {amSlots.map((time) => {
                      const formatted = formatTo12Hour(time);
                      const isSelected = displayTime === time;

                      return (
                        <button
                          key={time}
                          onClick={() => handleTimeSelect(time)}
                          className={`bg-white border rounded-md py-2 px-2 transition-colors text-sm font-medium ${
                            isSelected
                              ? 'border-primary-500 bg-primary-50 text-primary-700'
                              : 'border-gray-200 hover:border-primary-300 hover:bg-primary-50 text-gray-900'
                          }`}
                        >
                          {formatted.time12}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {pmSlots.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">下午</h4>
                  <div className="grid grid-cols-3 gap-2">
                    {pmSlots.map((time) => {
                      const formatted = formatTo12Hour(time);
                      const isSelected = displayTime === time;

                      return (
                        <button
                          key={time}
                          onClick={() => handleTimeSelect(time)}
                          className={`bg-white border rounded-md py-2 px-2 transition-colors text-sm font-medium ${
                            isSelected
                              ? 'border-primary-500 bg-primary-50 text-primary-700'
                              : 'border-gray-200 hover:border-primary-300 hover:bg-primary-50 text-gray-900'
                          }`}
                        >
                          {formatted.time12}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500">此日期沒有可用時段</p>
              <p className="text-sm text-gray-400 mt-2">請選擇其他日期</p>
            </div>
          )}
        </div>
      ) : (
        <div>
          <h3 className="font-medium text-gray-900 mb-2">可預約時段</h3>
          <p className="text-sm text-gray-500">請先選擇日期</p>
        </div>
      )}
      </div>
      {error && (
        <p className="mt-1 text-sm text-red-600">{error}</p>
      )}
    </div>
  );
});

DateTimePicker.displayName = 'DateTimePicker';


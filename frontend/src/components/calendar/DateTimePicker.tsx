/**
 * DateTimePicker Component
 * 
 * Shared date/time picker component for appointment creation and editing.
 * Features calendar view with month navigation and time slot selection.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
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
} from '../../utils/calendarUtils';

export interface DateTimePickerProps {
  selectedDate: string | null;
  selectedTime: string;
  selectedPractitionerId: number | null;
  appointmentTypeId: number | null;
  onDateSelect: (date: string) => void;
  onTimeSelect: (time: string) => void;
  // Optional: include original appointment time even if not available
  originalTime?: string | null;
  originalDate?: string | null;
  originalPractitionerId?: number | null;
  // Optional: exclude this calendar event ID from conflict checking (for appointment editing)
  excludeCalendarEventId?: number | null;
  error?: string | null;
}

const dayNames = ['日', '一', '二', '三', '四', '五', '六'];

export const DateTimePicker: React.FC<DateTimePickerProps> = React.memo(({
  selectedDate,
  selectedTime,
  selectedPractitionerId,
  appointmentTypeId,
  onDateSelect,
  onTimeSelect,
  originalTime,
  originalDate,
  originalPractitionerId,
  excludeCalendarEventId,
  error,
}) => {
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

  // Use custom hook for date/slot selection logic
  const { availableSlots, isLoadingSlots } = useDateSlotSelection({
    selectedDate,
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
          const newCache = new Map<string, { slots: any[] }>();
          const datesWithAvailableSlots = new Set<string>();
          batchResponse.results.forEach((result) => {
            // Date is now included in response (unified format with LIFF endpoint)
            if (result.date) {
              // Cache the slots data for this date
              newCache.set(result.date, { slots: result.available_slots || [] });
              
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
          const errorMessage = err?.response?.data?.detail || err?.message || 'Unknown error';
          const statusCode = err?.response?.status;
          
          // Don't retry on 400 errors (validation errors) - these are expected for dates beyond booking window
          if (statusCode === 400) {
            logger.log(`Some dates in month ${currentMonth.getFullYear()}-${currentMonth.getMonth() + 1} are beyond booking window:`, errorMessage);
            // Set empty results but don't treat as error - backend now filters invalid dates
            setDatesWithSlots(new Set());
            setCachedAvailabilityData(new Map());
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

  const handleDateSelect = (date: Date) => {
    const dateString = formatDateString(date);
    if (datesWithSlots.has(dateString)) {
      onDateSelect(dateString);
      onTimeSelect(''); // Clear time when date changes
    }
  };

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  // Build time slots list - include original time if editing and date/practitioner match
  const allTimeSlots = useMemo(() => {
    const slots = [...availableSlots];
    
    // If editing and original time/date/practitioner match, include original time even if not available
    if (originalTime && originalDate && originalPractitionerId) {
      const isOriginalDate = selectedDate === originalDate;
      const isOriginalPractitioner = selectedPractitionerId === originalPractitionerId;
      if (isOriginalDate && isOriginalPractitioner && !slots.includes(originalTime)) {
        slots.push(originalTime);
        slots.sort();
      }
    }
    
    return slots;
  }, [availableSlots, originalTime, originalDate, originalPractitionerId, selectedDate, selectedPractitionerId]);

  // Group time slots
  const { amSlots, pmSlots } = useMemo(() => {
    return groupTimeSlots(allTimeSlots);
  }, [allTimeSlots]);

  return (
    <div className="space-y-6">
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
              const selected = selectedDate === dateString;
              const isOriginalDate = originalDate ? dateString === originalDate : false;
              // Show original indicator when original date is not selected and a different date has been selected
              const isOriginalButNotSelected = isOriginalDate && !selected && selectedDate !== null;
              const todayDate = isToday(date);

              return (
                <button
                  key={dateString}
                  onClick={() => handleDateSelect(date)}
                  disabled={!available}
                  className={`aspect-square text-center rounded-lg transition-colors relative ${
                    selected
                      ? 'bg-teal-500 text-white font-semibold'
                      : available
                      ? 'bg-white text-gray-900 font-semibold hover:bg-gray-50 border border-gray-200'
                      : 'bg-gray-50 text-gray-400 cursor-not-allowed border border-gray-100'
                  } ${isOriginalDate ? 'ring-2 ring-blue-300' : ''}`}
                >
                  {isOriginalButNotSelected && (
                    <span className={`absolute -top-1.5 -right-1.5 text-[10px] font-medium px-1 py-0.5 rounded ${
                      available ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-500'
                    }`}>
                      原
                    </span>
                  )}
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
      {selectedDate ? (
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
                      const isSelected = selectedTime === time;
                      const isOriginalTime = originalTime && originalDate && originalPractitionerId
                        ? time === originalTime && selectedDate === originalDate && selectedPractitionerId === originalPractitionerId
                        : false;
                      // Show original indicator when original time is not selected and a different time has been selected
                      const isOriginalButNotSelected = isOriginalTime && !isSelected && selectedTime !== null;

                      return (
                        <button
                          key={time}
                          onClick={() => onTimeSelect(time)}
                          className={`bg-white border rounded-md py-2 px-2 transition-colors text-sm font-medium relative ${
                            isSelected
                              ? 'border-primary-500 bg-primary-50 text-primary-700'
                              : 'border-gray-200 hover:border-primary-300 hover:bg-primary-50 text-gray-900'
                          } ${isOriginalTime ? 'ring-2 ring-blue-300' : ''}`}
                        >
                          {isOriginalButNotSelected && (
                            <span className="absolute -top-2 -right-2 bg-blue-500 text-white text-xs font-medium px-1.5 py-0.5 rounded shadow-sm">
                              原
                            </span>
                          )}
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
                      const isSelected = selectedTime === time;
                      const isOriginalTime = originalTime && originalDate && originalPractitionerId
                        ? time === originalTime && selectedDate === originalDate && selectedPractitionerId === originalPractitionerId
                        : false;
                      // Show original indicator when original time is not selected and a different time has been selected
                      const isOriginalButNotSelected = isOriginalTime && !isSelected && selectedTime !== null;

                      return (
                        <button
                          key={time}
                          onClick={() => onTimeSelect(time)}
                          className={`bg-white border rounded-md py-2 px-2 transition-colors text-sm font-medium relative ${
                            isSelected
                              ? 'border-primary-500 bg-primary-50 text-primary-700'
                              : 'border-gray-200 hover:border-primary-300 hover:bg-primary-50 text-gray-900'
                          } ${isOriginalTime ? 'ring-2 ring-blue-300' : ''}`}
                        >
                          {isOriginalButNotSelected && (
                            <span className="absolute -top-2 -right-2 bg-blue-500 text-white text-xs font-medium px-1.5 py-0.5 rounded shadow-sm">
                              原
                            </span>
                          )}
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
  );
});

DateTimePicker.displayName = 'DateTimePicker';


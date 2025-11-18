/**
 * DateTimePicker Component
 * 
 * Shared date/time picker component for appointment creation and editing.
 * Features calendar view with month navigation and time slot selection.
 */

import React, { useState, useEffect, useMemo } from 'react';
import moment from 'moment-timezone';
import { LoadingSpinner } from '../shared';
import { apiService } from '../../services/api';
import { logger } from '../../utils/logger';
import {
  formatTo12Hour,
  groupTimeSlots,
  generateCalendarDays,
  isToday,
  formatMonthYear,
  formatDateString,
} from '../../utils/calendarUtils';

const TAIWAN_TIMEZONE = 'Asia/Taipei';

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
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);

  // Update currentMonth when selectedDate changes
  useEffect(() => {
    if (selectedDate) {
      const parts = selectedDate.split('-').map(Number);
      const year = parts[0] ?? new Date().getFullYear();
      const month = parts[1] ?? new Date().getMonth() + 1;
      const day = parts[2] ?? new Date().getDate();
      const newMonth = new Date(year, month - 1, day);
      if (newMonth.getMonth() !== currentMonth.getMonth() || newMonth.getFullYear() !== currentMonth.getFullYear()) {
        setCurrentMonth(new Date(year, month - 1, 1));
      }
    }
  }, [selectedDate, currentMonth]);

  // Load month availability for calendar
  useEffect(() => {
    if (!appointmentTypeId || !selectedPractitionerId) {
      setDatesWithSlots(new Set());
      return;
    }

    const loadMonthAvailability = async () => {
      setLoadingAvailability(true);
      try {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        const lastDay = new Date(year, month + 1, 0).getDate();
        // Get today's date in Taiwan timezone to match backend validation
        const todayTaiwan = moment.tz(TAIWAN_TIMEZONE).startOf('day');
        const todayDateString = todayTaiwan.format('YYYY-MM-DD');

        const datesToCheck: string[] = [];
        for (let day = 1; day <= lastDay; day++) {
          const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          // Only check dates that are today or in the future (avoid 400 errors for past dates)
          // Compare date strings to ensure we're using the same timezone as the backend
          if (dateString >= todayDateString) {
            datesToCheck.push(dateString);
          }
        }

        const availabilityPromises = datesToCheck.map(async (dateString) => {
          try {
            const response = await apiService.getAvailableSlots(selectedPractitionerId, dateString, appointmentTypeId, excludeCalendarEventId ?? undefined);
            return response.available_slots && response.available_slots.length > 0 ? dateString : null;
          } catch (err) {
            // Log error but don't fail the entire month load
            logger.warn(`Failed to load availability for ${dateString}:`, err);
            return null;
          }
        });

        const results = await Promise.all(availabilityPromises);
        const datesWithAvailableSlots = new Set<string>(
          results.filter((date): date is string => date !== null)
        );
        setDatesWithSlots(datesWithAvailableSlots);
      } catch (err) {
        logger.error('Failed to load month availability:', err);
      } finally {
        setLoadingAvailability(false);
      }
    };

    loadMonthAvailability();
  }, [currentMonth, appointmentTypeId, selectedPractitionerId]);

  // Load available slots when date is selected
  useEffect(() => {
    if (selectedDate && appointmentTypeId && selectedPractitionerId) {
      const loadAvailableSlots = async () => {
        setIsLoadingSlots(true);
        try {
          const response = await apiService.getAvailableSlots(selectedPractitionerId, selectedDate, appointmentTypeId, excludeCalendarEventId ?? undefined);
          setAvailableSlots(response.available_slots.map(slot => slot.start_time));
        } catch (err) {
          logger.error('Failed to load available slots:', err);
          setAvailableSlots([]);
        } finally {
          setIsLoadingSlots(false);
        }
      };
      loadAvailableSlots();
    }
  }, [selectedDate, appointmentTypeId, selectedPractitionerId, excludeCalendarEventId]);

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
                      return (
                        <button
                          key={time}
                          onClick={() => onTimeSelect(time)}
                          className={`bg-white border rounded-md py-2 px-2 transition-colors text-sm font-medium ${
                            selectedTime === time
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
                      return (
                        <button
                          key={time}
                          onClick={() => onTimeSelect(time)}
                          className={`bg-white border rounded-md py-2 px-2 transition-colors text-sm font-medium ${
                            selectedTime === time
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
  );
});

DateTimePicker.displayName = 'DateTimePicker';


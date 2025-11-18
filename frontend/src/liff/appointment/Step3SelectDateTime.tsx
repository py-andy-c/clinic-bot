import React, { useState, useEffect } from 'react';
import moment from 'moment-timezone';
import { logger } from '../../utils/logger';
import { LoadingSpinner } from '../../components/shared';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { liffApiService } from '../../services/liffApi';
import AvailabilityNotificationButton from '../components/AvailabilityNotificationButton';
import {
  formatTo12Hour,
  groupTimeSlots,
  generateCalendarDays,
  isToday,
  formatMonthYear,
  formatDateString,
} from '../../utils/calendarUtils';

const Step3SelectDateTime: React.FC = () => {
  const { appointmentTypeId, practitionerId, setDateTime, clinicId } = useAppointmentStore();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [slotDetails, setSlotDetails] = useState<Map<string, { is_recommended?: boolean }>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [datesWithSlots, setDatesWithSlots] = useState<Set<string>>(new Set());
  const [loadingAvailability, setLoadingAvailability] = useState(false);

  // Generate calendar days using shared utility
  const calendarDays = generateCalendarDays(currentMonth);

  // Load availability for all dates in current month
  useEffect(() => {
    if (!clinicId || !appointmentTypeId) return;

    const loadMonthAvailability = async () => {
      setLoadingAvailability(true);
      try {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        const lastDay = new Date(year, month + 1, 0).getDate();
        // Get today's date in Taiwan timezone to match backend validation
        const todayTaiwan = moment.tz('Asia/Taipei').startOf('day');
        const todayDateString = todayTaiwan.format('YYYY-MM-DD');

        // Build array of dates to check
        const datesToCheck: string[] = [];
        for (let day = 1; day <= lastDay; day++) {
            const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          // Only check dates that are today or in the future (avoid 400 errors for past dates)
          // Compare date strings to ensure we're using the same timezone as the backend
          if (dateString >= todayDateString) {
            datesToCheck.push(dateString);
    }
        }

        // Load availability in parallel for all dates
        const availabilityPromises = datesToCheck.map(async (dateString) => {
          try {
            const response = await liffApiService.getAvailability({
              date: dateString,
              appointment_type_id: appointmentTypeId,
              practitioner_id: practitionerId ?? undefined,
            });
            return response.slots && response.slots.length > 0 ? dateString : null;
          } catch (err) {
            // Silently skip dates that fail (likely no availability)
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
  }, [currentMonth, clinicId, appointmentTypeId, practitionerId]);

  useEffect(() => {
    if (selectedDate) {
      loadAvailableSlots(selectedDate);
    }
  }, [selectedDate, appointmentTypeId, practitionerId, clinicId]);

  const loadAvailableSlots = async (date: string) => {
    if (!clinicId || !appointmentTypeId) return;

    try {
      setIsLoading(true);
      setError(null);
      setSlotDetails(new Map()); // Clear previous slot details

      const response = await liffApiService.getAvailability({
        date,
        appointment_type_id: appointmentTypeId,
        practitioner_id: practitionerId ?? undefined,
      });

      // Extract time slots from response
      const slots = response.slots.map(slot => slot.start_time);
      setAvailableSlots(slots);
      
      // Store slot details for recommended badge display
      const detailsMap = new Map<string, { is_recommended?: boolean }>();
      response.slots.forEach(slot => {
        if (slot.is_recommended !== undefined) {
          detailsMap.set(slot.start_time, { is_recommended: slot.is_recommended });
        }
      });
      setSlotDetails(detailsMap);
    } catch (err) {
      logger.error('Failed to load available slots:', err);
      setError('無法載入可用時段');
      setSlotDetails(new Map()); // Clear on error
    } finally {
      setIsLoading(false);
    }
  };

  const handleDateSelect = (date: Date) => {
    // Format date as YYYY-MM-DD using shared utility
    const dateString = formatDateString(date);
    // Only allow selection if date has available slots
    if (datesWithSlots.has(dateString)) {
      setSelectedDate(dateString);
    }
  };

  const handleTimeSelect = (time: string) => {
    if (selectedDate) {
      setDateTime(selectedDate, time);
    }
  };

  // Use shared utility for date availability check
  const isDateAvailable = (date: Date): boolean => {
    const dateString = formatDateString(date);
    return datesWithSlots.has(dateString);
  };

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  // Day names in Chinese (starting with Sunday)
  const dayNames = ['日', '一', '二', '三', '四', '五', '六'];

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          選擇日期與時間
        </h2>
      </div>

      {/* Calendar View */}
      <div className="mb-6">
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

              // Format date using shared utility
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
        <div className="mb-6">
          <h3 className="font-medium text-gray-900 mb-2">可預約時段</h3>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner size="sm" />
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          ) : availableSlots.length > 0 ? (
            (() => {
              const { amSlots, pmSlots } = groupTimeSlots(availableSlots);
              return (
                <div className="space-y-4">
                  {amSlots.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">上午</h4>
                      <div className="grid grid-cols-3 gap-2">
                        {amSlots.map((time) => {
                          const formatted = formatTo12Hour(time);
                          const isRecommended = slotDetails.get(time)?.is_recommended === true;
                          return (
                            <button
                              key={time}
                              onClick={() => handleTimeSelect(time)}
                              className={`relative bg-white border rounded-md py-2 px-2 hover:border-primary-300 hover:bg-primary-50 transition-colors text-sm font-medium text-gray-900 ${
                                isRecommended ? 'border-teal-400 border-2' : 'border-gray-200'
                              }`}
                            >
                              {formatted.time12}
                              {isRecommended && (
                                <span className="absolute -top-2 -right-2 bg-teal-500 text-white text-xs font-medium px-1.5 py-0.5 rounded shadow-sm">
                                  建議
                                </span>
                              )}
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
                          const isRecommended = slotDetails.get(time)?.is_recommended === true;
                          return (
                            <button
                              key={time}
                              onClick={() => handleTimeSelect(time)}
                              className={`relative bg-white border rounded-md py-2 px-2 hover:border-primary-300 hover:bg-primary-50 transition-colors text-sm font-medium text-gray-900 ${
                                isRecommended ? 'border-teal-400 border-2' : 'border-gray-200'
                              }`}
                            >
                              {formatted.time12}
                              {isRecommended && (
                                <span className="absolute -top-2 -right-2 bg-teal-500 text-white text-xs font-medium px-1.5 py-0.5 rounded shadow-sm">
                                  建議
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500">此日期沒有可用時段</p>
              <p className="text-sm text-gray-400 mt-2">請選擇其他日期</p>
            </div>
          )}
          
          {/* Availability Notification Button - shown under time slots */}
          {selectedDate && (
            <AvailabilityNotificationButton className="mt-4" />
          )}
        </div>
      ) : (
        <div className="mb-6">
          <h3 className="font-medium text-gray-900 mb-2">可預約時段</h3>
        </div>
      )}

      {/* Redirect to Availability Notification - shown when no date selected */}
      {!selectedDate && (
        <AvailabilityNotificationButton className="mt-6" />
      )}
    </div>
  );
};

export default Step3SelectDateTime;

import React, { useState, useEffect } from 'react';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { liffApiService } from '../../services/liffApi';

const Step3SelectDateTime: React.FC = () => {
  const { appointmentTypeId, practitionerId, setDateTime, clinicId, step, setStep } = useAppointmentStore();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [datesWithSlots, setDatesWithSlots] = useState<Set<string>>(new Set());
  const [loadingAvailability, setLoadingAvailability] = useState(false);

  // Generate calendar days for current month
  const generateCalendarDays = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay(); // 0 = Sunday

    const days: (Date | null)[] = [];

    // Add null for days before month starts
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }

    // Add all days in the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }

    return days;
  };

  const calendarDays = generateCalendarDays();

  // Load availability for all dates in current month
  useEffect(() => {
    if (!clinicId || !appointmentTypeId) return;

    const loadMonthAvailability = async () => {
      setLoadingAvailability(true);
      try {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        const lastDay = new Date(year, month + 1, 0).getDate();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Build array of dates to check
        const datesToCheck: string[] = [];
        for (let day = 1; day <= lastDay; day++) {
          const date = new Date(year, month, day);
          // Skip past dates
          if (date >= today) {
            datesToCheck.push(date.toISOString().split('T')[0]);
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
        console.error('Failed to load month availability:', err);
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

      const response = await liffApiService.getAvailability({
        date,
        appointment_type_id: appointmentTypeId,
        practitioner_id: practitionerId ?? undefined,
      });

      // Extract time slots from response
      const slots = response.slots.map(slot => slot.start_time);
      setAvailableSlots(slots);
    } catch (err) {
      console.error('Failed to load available slots:', err);
      setError('無法載入可用時段');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDateSelect = (date: Date) => {
    const dateString = date.toISOString().split('T')[0];
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

  // Convert 24-hour time to 12-hour format
  const formatTo12Hour = (time24: string): { time12: string; period: 'AM' | 'PM' } => {
    const [hours, minutes] = time24.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    return {
      time12: `${hours12.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`,
      period
    };
  };

  // Group time slots into AM and PM
  const groupTimeSlots = (slots: string[]) => {
    const amSlots: string[] = [];
    const pmSlots: string[] = [];

    slots.forEach(slot => {
      const formatted = formatTo12Hour(slot);
      if (formatted.period === 'AM') {
        amSlots.push(slot);
      } else {
        pmSlots.push(slot);
      }
    });

    return { amSlots, pmSlots };
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const isDateAvailable = (date: Date): boolean => {
    const dateString = date.toISOString().split('T')[0];
    return datesWithSlots.has(dateString);
  };

  const formatMonthYear = (date: Date): string => {
    return date.toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: 'long'
    });
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
            aria-label="Previous month"
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
            aria-label="Next month"
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
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((date, index) => {
              if (!date) {
                return <div key={`empty-${index}`} className="aspect-square" />;
              }

              const dateString = date.toISOString().split('T')[0];
              const available = isDateAvailable(date);
              const selected = selectedDate === dateString;
              const today = isToday(date);

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
                    {today && (
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
          <p className="text-sm text-gray-500 mb-3">請選擇看診日期</p>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
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
                          return (
                            <button
                              key={time}
                              onClick={() => handleTimeSelect(time)}
                              className="bg-white border border-gray-200 rounded-md py-2 px-2 hover:border-primary-300 hover:bg-primary-50 transition-colors text-sm font-medium text-gray-900"
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
                              onClick={() => handleTimeSelect(time)}
                              className="bg-white border border-gray-200 rounded-md py-2 px-2 hover:border-primary-300 hover:bg-primary-50 transition-colors text-sm font-medium text-gray-900"
                            >
                              {formatted.time12}
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
        </div>
      ) : (
        <div className="mb-6">
          <h3 className="font-medium text-gray-900 mb-2">可預約時段</h3>
          <p className="text-sm text-gray-500">請選擇看診日期</p>
        </div>
      )}

      {/* Back button */}
      <div className="mt-6">
        <button
          onClick={() => setStep(step - 1)}
          className="w-full bg-white border-2 border-gray-300 text-gray-700 py-3 px-4 rounded-md hover:border-gray-400 hover:bg-gray-50 active:bg-gray-100 transition-all duration-200 font-medium"
        >
          返回上一步
        </button>
      </div>
    </div>
  );
};

export default Step3SelectDateTime;

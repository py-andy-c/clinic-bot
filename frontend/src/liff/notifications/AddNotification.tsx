import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useNavigate } from 'react-router-dom';
import moment from 'moment-timezone';
import { logger } from '../../utils/logger';
import { LoadingSpinner, ErrorMessage } from '../../components/shared';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { AppointmentType, Practitioner } from '../../types';
import { liffApiService } from '../../services/liffApi';
import { preserveQueryParams } from '../../utils/urlUtils';
import {
  generateCalendarDays,
  isToday,
  formatMonthYear,
  formatDateString,
} from '../../utils/calendarUtils';

type TimeWindow = 'morning' | 'afternoon' | 'evening';

interface DateTimeWindowEntry {
  date: string; // YYYY-MM-DD
  timeWindows: TimeWindow[]; // Can have multiple time windows per date
}

const MAX_TIME_WINDOWS = 10;
const MAX_DAYS_AHEAD = 30;

const AddNotification: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const TIME_WINDOW_LABELS: Record<TimeWindow, string> = {
    morning: t('notifications.add.timeWindow.morning'),
    afternoon: t('notifications.add.timeWindow.afternoon'),
    evening: t('notifications.add.timeWindow.evening'),
  };

  const TIME_WINDOW_DESCRIPTIONS: Record<TimeWindow, string> = {
    morning: t('notifications.add.timeWindow.morningDesc'),
    afternoon: t('notifications.add.timeWindow.afternoonDesc'),
    evening: t('notifications.add.timeWindow.eveningDesc'),
  };
  const { clinicId, appointmentTypeId, practitionerId } = useAppointmentStore();
  
  // Pre-fill from URL params (when redirected from appointment flow)
  const urlAppointmentTypeId = searchParams.get('appointment_type_id');
  const urlPractitionerId = searchParams.get('practitioner_id');

  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([]);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [selectedAppointmentTypeId, setSelectedAppointmentTypeId] = useState<number | null>(
    appointmentTypeId || (urlAppointmentTypeId ? parseInt(urlAppointmentTypeId, 10) : null)
  );
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<number | null>(
    practitionerId || (urlPractitionerId ? parseInt(urlPractitionerId, 10) : null)
  );
  const [selectedDates, setSelectedDates] = useState<DateTimeWindowEntry[]>([]);
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generate calendar days
  const calendarDays = generateCalendarDays(currentMonth);

  // Load appointment types
  useEffect(() => {
    const loadAppointmentTypes = async () => {
      if (!clinicId) return;

      try {
        setIsLoading(true);
        const response = await liffApiService.getAppointmentTypes(clinicId);
        const types: AppointmentType[] = response.appointment_types.map(type => ({
          ...type,
          clinic_id: clinicId,
          is_deleted: false,
        }));
        setAppointmentTypes(types);
      } catch (err) {
        logger.error('Failed to load appointment types:', err);
        setError(t('appointment.errors.loadTypes'));
      } finally {
        setIsLoading(false);
      }
    };

    loadAppointmentTypes();
  }, [clinicId]);

  // Filter by allow_patient_booking (default to true if not set)
  // Reuse the same filtering logic as Step1SelectType
  const activeAppointmentTypes = appointmentTypes.filter(
    type => type.allow_patient_booking !== false
  );

  // Load practitioners when appointment type is selected
  useEffect(() => {
    const loadPractitioners = async () => {
      if (!clinicId || !selectedAppointmentTypeId) {
        setPractitioners([]);
        return;
      }

      try {
        const response = await liffApiService.getPractitioners(clinicId, selectedAppointmentTypeId);
        setPractitioners(response.practitioners);
      } catch (err) {
        logger.error('Failed to load practitioners:', err);
      }
    };

    loadPractitioners();
  }, [clinicId, selectedAppointmentTypeId]);

  const handleDateSelect = (date: Date) => {
    const dateString = formatDateString(date);
    const today = moment.tz('Asia/Taipei').startOf('day');
    const maxDate = today.clone().add(MAX_DAYS_AHEAD, 'days');
    const selectedMoment = moment.tz(dateString, 'Asia/Taipei').startOf('day');
    
    // Validate date is within range
    if (selectedMoment.isBefore(today, 'day')) {
      return; // Can't select past dates
    }
    if (selectedMoment.isAfter(maxDate, 'day')) {
      return; // Can't select beyond max days
    }

    // Check if date already exists
    const existingIndex = selectedDates.findIndex(d => d.date === dateString);
    if (existingIndex >= 0) {
      // Date already selected, remove it
      setSelectedDates(prev => prev.filter((_, i) => i !== existingIndex));
    } else {
      // Check total time windows limit
      const totalWindows = selectedDates.reduce((sum, d) => sum + d.timeWindows.length, 0);
      if (totalWindows >= MAX_TIME_WINDOWS) {
        setError(t('notifications.add.maxTimeWindows', { max: MAX_TIME_WINDOWS }));
        return;
      }
      // Add new date entry
      setSelectedDates(prev => [...prev, { date: dateString, timeWindows: [] }]);
    }
  };

  const toggleTimeWindow = (dateIndex: number, timeWindow: TimeWindow) => {
    setSelectedDates(prev => {
      // Check total limit before adding
      const totalWindows = prev.reduce((sum, d) => sum + d.timeWindows.length, 0);
      const entry = prev[dateIndex];
      if (!entry) {
        return prev; // Invalid index, return unchanged
      }
      const isSelected = entry.timeWindows.includes(timeWindow);
      
      if (!isSelected && totalWindows >= MAX_TIME_WINDOWS) {
        setError(t('notifications.add.maxTimeWindows', { max: MAX_TIME_WINDOWS }));
        return prev;
      }
      
      // Create new array with updated entry
      const newDates = prev.map((d, i) => {
        if (i === dateIndex) {
          if (isSelected) {
            // Remove time window
            return {
              ...d,
              timeWindows: d.timeWindows.filter(tw => tw !== timeWindow),
            };
          } else {
            // Add time window
            return {
              ...d,
              timeWindows: [...d.timeWindows, timeWindow],
            };
          }
        }
        return d;
      });
      
      // Clear error if we successfully added
      if (!isSelected) {
        setError(null);
      }
      
      return newDates;
    });
  };

  const removeDateEntry = (index: number) => {
    setSelectedDates(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!selectedAppointmentTypeId) {
      setError(t('notifications.add.selectAppointmentType'));
      return;
    }

    // Convert selectedDates to time_windows format
    const timeWindows: Array<{ date: string; time_window: TimeWindow }> = [];
    for (const entry of selectedDates) {
      for (const timeWindow of entry.timeWindows) {
        timeWindows.push({ date: entry.date, time_window: timeWindow });
      }
    }

    if (timeWindows.length === 0) {
      setError(t('notifications.add.selectAtLeastOne'));
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      await liffApiService.createAvailabilityNotification({
        appointment_type_id: selectedAppointmentTypeId,
        practitioner_id: selectedPractitionerId,
        time_windows: timeWindows,
      });

      // Navigate to the notifications list (manage view)
      const newUrl = preserveQueryParams('/liff', { mode: 'notifications' });
      navigate(newUrl);
    } catch (err: any) {
      logger.error('Failed to create notification:', err);
      const errorMessage = err.response?.data?.detail || t('notifications.add.createFailed');
      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDateDisplay = (dateStr: string): string => {
    const date = moment.tz(dateStr, 'Asia/Taipei');
    const dayNames = t('datetime.dayNames', { returnObjects: true }) as string[];
    const weekday = dayNames[date.day()];
    const monthDayFormat = t('datetime.monthDayFormat');
    return `${date.format(monthDayFormat)}(${weekday})`;
  };

  const isDateSelected = (date: Date): boolean => {
    const dateString = formatDateString(date);
    return selectedDates.some(d => d.date === dateString);
  };

  const isDateSelectable = (date: Date): boolean => {
    const dateString = formatDateString(date);
    const today = moment.tz('Asia/Taipei').startOf('day');
    const maxDate = today.clone().add(MAX_DAYS_AHEAD, 'days');
    const selectedMoment = moment.tz(dateString, 'Asia/Taipei').startOf('day');
    
    return selectedMoment.isSameOrAfter(today, 'day') && selectedMoment.isSameOrBefore(maxDate, 'day');
  };

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const dayNames = t('datetime.dayNames', { returnObjects: true }) as string[];
  const totalTimeWindows = selectedDates.reduce((sum, d) => sum + d.timeWindows.length, 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  if (error && !isSubmitting) {
    return (
      <div className="px-4 py-8">
        <ErrorMessage message={error} onRetry={() => setError(null)} />
      </div>
    );
  }

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">{t('notifications.add.title')}</h2>
        <p className="text-sm text-gray-500">{t('notifications.add.description')}</p>
      </div>

      {/* Appointment Type Selection */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {t('notifications.add.appointmentType')} <span className="text-red-500">{t('notifications.add.required')}</span>
        </label>
        <div className="space-y-2">
          {activeAppointmentTypes.map(type => (
            <button
              key={type.id}
              onClick={() => {
                setSelectedAppointmentTypeId(type.id);
                setSelectedPractitionerId(null); // Reset practitioner when type changes
                setSelectedDates([]); // Reset dates when type changes
              }}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${
                selectedAppointmentTypeId === type.id
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="font-medium text-gray-900">{type.name}</div>
              <div className="text-sm text-gray-500">{t('notifications.add.minutes', { minutes: type.duration_minutes })}</div>
              {type.description && (
                <div className="text-sm text-gray-600 mt-1">{type.description}</div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Practitioner Selection */}
      {selectedAppointmentTypeId && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('notifications.add.practitioner')}
          </label>
          <div className="space-y-2">
            {practitioners.length > 1 && (
              <button
                onClick={() => setSelectedPractitionerId(null)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selectedPractitionerId === null
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="font-medium text-gray-900">{t('practitioner.notSpecified')}</div>
                <div className="text-sm text-gray-500">{t('practitioner.notSpecifiedDesc')}</div>
              </button>
            )}
            {practitioners.map(practitioner => (
              <button
                key={practitioner.id}
                onClick={() => setSelectedPractitionerId(practitioner.id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selectedPractitionerId === practitioner.id
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="font-medium text-gray-900">{practitioner.full_name}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Date Picker and Time Windows Selection */}
      {selectedAppointmentTypeId && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('notifications.add.selectDateTime')} <span className="text-red-500">{t('notifications.add.required')}</span>
            <span className="text-sm font-normal text-gray-500 ml-2">
              ({totalTimeWindows}/{MAX_TIME_WINDOWS})
            </span>
          </label>
          <p className="text-sm text-gray-500 mb-4">
            {t('notifications.add.selectDateTimeDesc', { max: MAX_TIME_WINDOWS })}
          </p>

          {/* Date Picker Calendar */}
          <div className="mb-6 border border-gray-200 rounded-lg p-4 bg-white">
            {/* Month Navigation */}
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={handlePrevMonth}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                aria-label={t('notifications.add.prevMonth')}
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
                aria-label={t('notifications.add.nextMonth')}
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
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((date, index) => {
                if (!date) {
                  return <div key={`empty-${index}`} className="aspect-square" />;
                }

                const dateString = formatDateString(date);
                const selectable = isDateSelectable(date);
                const selected = isDateSelected(date);
                const todayDate = isToday(date);

                return (
                  <button
                    key={dateString}
                    onClick={() => handleDateSelect(date)}
                    disabled={!selectable}
                    className={`aspect-square text-center rounded-lg transition-colors relative ${
                      selected
                        ? 'bg-primary-500 text-white font-semibold'
                        : selectable
                        ? 'bg-white text-gray-900 font-semibold hover:bg-gray-50 border border-gray-200'
                        : 'bg-gray-50 text-gray-400 cursor-not-allowed border border-gray-100'
                    }`}
                  >
                    <div className="flex flex-col items-center justify-center h-full">
                      <span className={selected ? 'text-white' : selectable ? 'text-gray-900' : 'text-gray-400'}>
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
          </div>

          {/* Selected Dates with Time Windows */}
          {selectedDates.length > 0 && (
            <div className="space-y-3">
              {selectedDates.map((entry, index) => (
                <div key={entry.date} className="border border-gray-200 rounded-lg p-4 bg-white">
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-medium text-gray-900">
                      {formatDateDisplay(entry.date)}
                    </div>
                    <button
                      onClick={() => removeDateEntry(index)}
                      className="text-red-600 hover:text-red-700 p-1"
                      aria-label={t('notifications.add.removeDate')}
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(['morning', 'afternoon', 'evening'] as TimeWindow[]).map(timeWindow => {
                      const isSelected = entry.timeWindows.includes(timeWindow);
                      const isDisabled = !isSelected && totalTimeWindows >= MAX_TIME_WINDOWS;
                      
                      return (
                        <button
                          key={timeWindow}
                          onClick={() => toggleTimeWindow(index, timeWindow)}
                          disabled={isDisabled}
                          className={`p-3 rounded-lg text-sm font-medium transition-colors ${
                            isSelected
                              ? 'bg-primary-500 text-white'
                              : isDisabled
                              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              : 'bg-white border border-gray-200 text-gray-700 hover:border-primary-300'
                          }`}
                        >
                          <div>{TIME_WINDOW_LABELS[timeWindow]}</div>
                          <div className={`text-xs mt-1 ${isSelected ? 'text-white' : 'text-gray-500'}`}>
                            {TIME_WINDOW_DESCRIPTIONS[timeWindow]}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Submit Button */}
      <div className="sticky bottom-0 bg-gray-50 pt-4 pb-4 -mx-4 px-4 border-t border-gray-200">
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || !selectedAppointmentTypeId || totalTimeWindows === 0}
          className={`w-full py-3 px-4 rounded-lg font-medium transition-colors ${
            isSubmitting || !selectedAppointmentTypeId || totalTimeWindows === 0
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-primary-600 text-white hover:bg-primary-700'
          }`}
        >
          {isSubmitting ? t('notifications.add.creating') : t('notifications.add.createButton')}
        </button>
      </div>
    </div>
  );
};

export default AddNotification;

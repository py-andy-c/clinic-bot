import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppointmentStore } from '../../../stores/appointmentStore';
import { liffApiService } from '../../../services/liffApi';
import MultipleTimeSlotSelector from './MultipleTimeSlotSelector';
import SelectedSlotsDisplay from './SelectedSlotsDisplay';
import {
  generateCalendarDays,
  isToday,
  formatMonthYear,
  formatDateString,
  buildDatesToCheckForMonth,
} from '../../../utils/calendarUtils';

const MultiSlotDateTimeSelector: React.FC = () => {
  const { t } = useTranslation();
  const { appointmentTypeId, practitionerId, clinicId, selectedTimeSlots, addTimeSlot, removeTimeSlot } = useAppointmentStore();

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [slotDetails, setSlotDetails] = useState<Map<string, { is_recommended?: boolean }>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [datesWithSlots, setDatesWithSlots] = useState<Set<string>>(new Set());
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [cachedAvailabilityData, setCachedAvailabilityData] = useState<Map<string, { slots: any[] }>>(new Map());

  // Generate calendar days using shared utility
  const calendarDays = generateCalendarDays(currentMonth);

  // Load availability for all dates in current month
  useEffect(() => {
    if (!clinicId || !appointmentTypeId) return;

    const loadMonthAvailability = async () => {
      setLoadingAvailability(true);
      try {
        const datesToCheck = buildDatesToCheckForMonth(currentMonth);

        const batchResponse = await liffApiService.getAvailabilityBatch({
          dates: datesToCheck,
          appointment_type_id: appointmentTypeId,
          practitioner_id: practitionerId ?? undefined,
        });

        const newCache = new Map<string, { slots: any[] }>();
        batchResponse.results.forEach(result => {
          const cacheKey = practitionerId ? `${practitionerId}-${result.date}` : result.date;
          newCache.set(cacheKey, { slots: result.slots });
        });
        setCachedAvailabilityData(newCache);

        const datesWithAvailableSlots = new Set<string>(
          batchResponse.results
            .filter(result => result.slots && result.slots.length > 0)
            .map(result => result.date)
        );

        setDatesWithSlots(datesWithAvailableSlots);
      } catch (err) {
        setDatesWithSlots(new Set());
      } finally {
        setLoadingAvailability(false);
      }
    };

    loadMonthAvailability();
  }, [currentMonth, clinicId, appointmentTypeId, practitionerId]);

  const loadAvailableSlots = useCallback(async (date: string) => {
    if (!clinicId || !appointmentTypeId) return;

    const cacheKey = practitionerId ? `${practitionerId}-${date}` : date;
    const cachedData = cachedAvailabilityData.get(cacheKey);
    if (cachedData) {
      const slots = cachedData.slots.map((slot: any) => slot.start_time);
      setAvailableSlots(slots);

      const detailsMap = new Map<string, { is_recommended?: boolean }>();
      cachedData.slots.forEach((slot: any) => {
        if (slot.is_recommended !== undefined) {
          detailsMap.set(slot.start_time, { is_recommended: slot.is_recommended });
        }
      });
      setSlotDetails(detailsMap);
      setError(null);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      setSlotDetails(new Map());

      const response = await liffApiService.getAvailability({
        date,
        appointment_type_id: appointmentTypeId,
        practitioner_id: practitionerId ?? undefined,
      });

      const slots = response.slots.map(slot => slot.start_time);
      setAvailableSlots(slots);

      const detailsMap = new Map<string, { is_recommended?: boolean }>();
      response.slots.forEach(slot => {
        if (slot.is_recommended !== undefined) {
          detailsMap.set(slot.start_time, { is_recommended: slot.is_recommended });
        }
      });
      setSlotDetails(detailsMap);
    } catch (err) {
      setError(t('datetime.loadFailed'));
      setSlotDetails(new Map());
    } finally {
      setIsLoading(false);
    }
  }, [clinicId, appointmentTypeId, practitionerId, cachedAvailabilityData]);

  useEffect(() => {
    if (selectedDate) {
      loadAvailableSlots(selectedDate);
    }
  }, [selectedDate, loadAvailableSlots]);

  const handleDateSelect = (date: Date) => {
    const dateString = formatDateString(date);
    if (datesWithSlots.has(dateString)) {
      setSelectedDate(dateString);
    }
  };

  const handleTimeSelect = (time: string) => {
    if (selectedDate) {
      const existingSlot = selectedTimeSlots.find(slot => slot.date === selectedDate && slot.time === time);
      if (existingSlot) {
        removeTimeSlot(selectedDate, time);
      } else {
        addTimeSlot(selectedDate, time);
      }
    }
  };

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

  const dayNames = t('datetime.dayNames', { returnObjects: true }) as string[];

  return (
    <div>
      {/* Calendar View */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={handlePrevMonth}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            aria-label={t('datetime.prevMonth')}
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
            aria-label={t('datetime.nextMonth')}
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-2">
          {dayNames.map((day) => (
            <div key={day} className="text-center text-sm font-medium text-gray-600 py-2">
              {day}
            </div>
          ))}
        </div>

        {loadingAvailability ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
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

      {/* Multi-Slot Selection */}
      {selectedDate && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium text-gray-900">{t('datetime.availableSlots')}</h3>
            <span className="text-sm text-blue-600 font-medium">
              {t('datetime.selectMultipleSlots', '選擇所有您方便的時段，可跨不同日期')}
            </span>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          ) : availableSlots.length > 0 ? (
            <MultipleTimeSlotSelector
              availableSlots={availableSlots}
              selectedTimeSlots={selectedTimeSlots}
              selectedDate={selectedDate}
              slotDetails={slotDetails}
              onTimeSelect={handleTimeSelect}
            />
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500">{t('datetime.noSlots')}</p>
              <p className="text-sm text-gray-400 mt-2">{t('datetime.noSlotsDesc')}</p>
            </div>
          )}

          <SelectedSlotsDisplay
            selectedTimeSlots={selectedTimeSlots}
            onRemoveSlot={removeTimeSlot}
            showConfirmButton={false}
          />
        </div>
      )}
    </div>
  );
};

export default MultiSlotDateTimeSelector;
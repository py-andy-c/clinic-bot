import React, { useState, useEffect } from 'react';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { liffApiService } from '../../services/liffApi';

const Step3SelectDateTime: React.FC = () => {
  const { appointmentTypeId, practitionerId, setDateTime, clinicId, step, setStep } = useAppointmentStore();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generate next 30 days for date selection
  const generateDates = () => {
    const dates = [];
    const today = new Date();

    for (let i = 0; i < 30; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      dates.push(date);
    }

    return dates;
  };

  const dates = generateDates();

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
    setSelectedDate(dateString as string);
  };

  const handleTimeSelect = (time: string) => {
    if (selectedDate) {
      setDateTime(selectedDate, time);
    }
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('zh-TW', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          選擇日期與時間
        </h2>
        <p className="text-gray-600">
          請選擇您方便的就診日期和時間
        </p>
      </div>

      {/* Date Selection */}
      <div className="mb-6">
        <h3 className="font-medium text-gray-900 mb-3">選擇日期</h3>
        <div className="grid grid-cols-7 gap-2">
          {dates.slice(0, 21).map((date) => (
            <button
              key={date.toISOString()}
              onClick={() => handleDateSelect(date)}
              className={`p-3 text-center rounded-lg border transition-colors ${
                selectedDate === date.toISOString().split('T')[0]
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white border-gray-200 hover:border-primary-300'
              }`}
            >
              <div className="text-xs">{formatDate(date)}</div>
              {isToday(date) && (
                <div className="text-xs mt-1 opacity-75">今天</div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Time Selection */}
      {selectedDate && (
        <div className="mb-6">
          <h3 className="font-medium text-gray-900 mb-3">選擇時間</h3>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          ) : availableSlots.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {availableSlots.map((time) => (
                <button
                  key={time}
                  onClick={() => handleTimeSelect(time)}
                  className="bg-white border border-gray-200 rounded-md py-3 px-2 hover:border-primary-300 hover:bg-primary-50 transition-colors text-sm"
                >
                  {time}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500">此日期沒有可用時段</p>
              <p className="text-sm text-gray-400 mt-2">請選擇其他日期</p>
            </div>
          )}
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

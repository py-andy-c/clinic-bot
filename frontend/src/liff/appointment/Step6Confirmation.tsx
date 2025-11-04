import React, { useState } from 'react';
import moment from 'moment-timezone';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { liffApiService } from '../../services/liffApi';

const Step6Confirmation: React.FC = () => {
  const { appointmentType, practitioner, practitionerId, isAutoAssigned, date, startTime, patient, notes, clinicId, step, setStep, updateAssignedPractitioner, setCreatedAppointment } = useAppointmentStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!appointmentType || !date || !startTime || !patient || !clinicId) return;

    try {
      setIsSubmitting(true);
      setError(null);

      // Parse date and time as Taiwan time (Asia/Taipei)
      // Treat the selected time as Taiwan time regardless of browser timezone
      const taiwanTimezone = 'Asia/Taipei';
      const timeWithSeconds = startTime.includes(':') && startTime.split(':').length === 2 
        ? `${startTime}:00` 
        : startTime;
      
      // Parse as Taiwan time using moment-timezone
      const startDateTimeTaiwan = moment.tz(`${date}T${timeWithSeconds}`, taiwanTimezone);
      
      if (!startDateTimeTaiwan.isValid()) {
        setError('日期時間格式錯誤');
        return;
      }

      // Send Taiwan time with timezone indicator to API
      // Format as ISO string with timezone offset (e.g., 2024-11-03T11:00:00+08:00)
      const response = await liffApiService.createAppointment({
        patient_id: patient.id,
        appointment_type_id: appointmentType.id,
        practitioner_id: practitioner?.id ?? undefined,
        start_time: startDateTimeTaiwan.format(),
        notes: notes || undefined,
      });

      // Update UI with assigned practitioner info if auto-assigned
      const wasAutoAssigned = practitionerId === null;
      if (wasAutoAssigned && response.practitioner_name) {
        // Update store with assigned practitioner and mark as auto-assigned
        updateAssignedPractitioner(response.practitioner_id, {
          id: response.practitioner_id,
          full_name: response.practitioner_name,
          offered_types: [] // We don't have this info, but it's not critical for display
        }, true);
      }

      // Store created appointment data for Step 7
      setCreatedAppointment({
        appointment_id: response.appointment_id,
        calendar_event_id: response.calendar_event_id,
        start_time: response.start_time,
        end_time: response.end_time,
      });

      // Success - move to step 7
      useAppointmentStore.setState({ step: 7 });
    } catch (err) {
      console.error('Failed to create appointment:', err);
      setError(err instanceof Error ? err.message : '預約失敗，請稍後再試');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDateTime = () => {
    if (!date || !startTime) return '';
    
    // Parse as Taiwan time for display
    const taiwanTimezone = 'Asia/Taipei';
    const timeWithSeconds = startTime.includes(':') && startTime.split(':').length === 2 
      ? `${startTime}:00` 
      : startTime;
    const dateTimeTaiwan = moment.tz(`${date}T${timeWithSeconds}`, taiwanTimezone);
    
    if (!dateTimeTaiwan.isValid()) {
      return '';
    }
    
    // Format weekday as (日), (一), (二), etc.
    const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const weekday = weekdayNames[dateTimeTaiwan.day()]; // moment uses .day() instead of .getDay()
    
    const dateStr = dateTimeTaiwan.format('YYYY/MM/DD');
    const timeStr = dateTimeTaiwan.format('HH:mm');
    
    return `${dateStr} (${weekday}) ${timeStr}`;
  };

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          確認預約
        </h2>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-gray-600">預約類型：</span>
            <span className="font-medium">{appointmentType?.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">治療師：</span>
            <span className="font-medium">
              {practitioner?.full_name || '不指定'}
              {isAutoAssigned && <span className="text-sm text-blue-600 ml-2">(系統安排)</span>}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">日期時間：</span>
            <span className="font-medium">{formatDateTime()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">就診人：</span>
            <span className="font-medium">{patient?.full_name}</span>
          </div>
          {notes && (
            <div>
              <span className="text-gray-600">備註：</span>
              <p className="mt-1 text-sm bg-gray-50 p-2 rounded">{notes}</p>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <div className="space-y-3">
        <button
          onClick={handleConfirm}
          disabled={isSubmitting}
          className="w-full bg-primary-600 text-white py-3 px-4 rounded-md hover:bg-primary-700 disabled:opacity-50"
        >
          {isSubmitting ? '預約中...' : '確認預約'}
        </button>

        <button
          onClick={() => setStep(step - 1)}
          className="w-full bg-white border-2 border-gray-300 text-gray-700 py-3 px-4 rounded-md hover:border-gray-400 hover:bg-gray-50 active:bg-gray-100 transition-all duration-200 font-medium"
        >
          返回修改
        </button>
      </div>
    </div>
  );
};

export default Step6Confirmation;

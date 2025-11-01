import React, { useState } from 'react';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { liffApiService } from '../../services/liffApi';

const Step6Confirmation: React.FC = () => {
  const { appointmentType, practitioner, date, startTime, patient, notes, clinicId, step, setStep } = useAppointmentStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!appointmentType || !date || !startTime || !patient || !clinicId) return;

    try {
      setIsSubmitting(true);
      setError(null);

      const startDateTime = new Date(`${date}T${startTime}`);

      await liffApiService.createAppointment({
        patient_id: patient.id,
        appointment_type_id: appointmentType.id,
        practitioner_id: practitioner?.id ?? undefined,
        start_time: startDateTime.toISOString(),
        notes: notes || undefined,
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
    const dateTime = new Date(`${date}T${startTime}`);
    return dateTime.toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  };

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          確認預約
        </h2>
        <p className="text-gray-600">
          請確認預約資訊是否正確
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-gray-600">預約類型：</span>
            <span className="font-medium">{appointmentType?.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">治療師：</span>
            <span className="font-medium">{practitioner?.full_name || '不指定'}</span>
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

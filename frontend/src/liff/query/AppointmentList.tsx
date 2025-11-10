import React, { useState, useEffect } from 'react';
import { logger } from '../../utils/logger';
import { LoadingSpinner, ErrorMessage } from '../../components/shared';
import { liffApiService } from '../../services/liffApi';
import AppointmentCard from './AppointmentCard';
import { useModal } from '../../contexts/ModalContext';

interface Appointment {
  id: number;
  patient_id: number;
  patient_name: string;
  practitioner_name: string;
  appointment_type_name: string;
  start_time: string;
  end_time: string;
  status: 'confirmed' | 'canceled_by_patient' | 'canceled_by_clinic';
  notes?: string;
}

const AppointmentList: React.FC = () => {
  const { alert: showAlert, confirm: showConfirm } = useModal();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAppointments();
  }, []);

  const loadAppointments = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await liffApiService.getAppointments(true); // upcoming only
      setAppointments(response.appointments);
    } catch (err) {
      logger.error('Failed to load appointments:', err);
      setError('無法載入預約記錄');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelAppointment = async (appointmentId: number) => {
    const confirmed = await showConfirm('確定要取消此預約嗎？', '確認取消');

    if (!confirmed) return;

    try {
      await liffApiService.cancelAppointment(appointmentId);
      // Refresh the list
      loadAppointments();
    } catch (err) {
      logger.error('Failed to cancel appointment:', err);
      await showAlert('取消預約失敗，請稍後再試', '取消失敗');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-md mx-auto">
          <div className="my-8">
            <ErrorMessage message={error} onRetry={loadAppointments} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-md mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            預約管理
          </h1>
        </div>

        {appointments.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-400 text-6xl mb-4">📅</div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              目前沒有預約
            </h3>
            <p className="text-gray-600 mb-6">
              點選「新增預約」來預約您的就診時間
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {appointments.map((appointment) => (
              <AppointmentCard
                key={appointment.id}
                appointment={appointment}
                onCancel={() => handleCancelAppointment(appointment.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AppointmentList;

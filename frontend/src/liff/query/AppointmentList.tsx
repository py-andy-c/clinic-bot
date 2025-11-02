import React, { useState, useEffect } from 'react';
import { liffApiService } from '../../services/liffApi';
import AppointmentCard from './AppointmentCard';

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
      console.error('Failed to load appointments:', err);
      setError('無法載入預約記錄');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelAppointment = async (appointmentId: number) => {
    if (!confirm('確定要取消此預約嗎？')) return;

    try {
      await liffApiService.cancelAppointment(appointmentId);
      // Refresh the list
      loadAppointments();
    } catch (err) {
      console.error('Failed to cancel appointment:', err);
      alert('取消預約失敗，請稍後再試');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-md mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-md p-4 my-8">
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={loadAppointments}
              className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700"
            >
              重試
            </button>
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
            預約查詢
          </h1>
        </div>

        {appointments.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-400 text-6xl mb-4">📅</div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              目前沒有預約
            </h3>
            <p className="text-gray-600 mb-6">
              點選「線上約診」來預約您的就診時間
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

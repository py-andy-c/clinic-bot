import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { logger } from '../../utils/logger';
import { LoadingSpinner, ErrorMessage } from '../../components/shared';
import { liffApiService } from '../../services/liffApi';
import AppointmentCard from './AppointmentCard';
import { useModal } from '../../contexts/ModalContext';
import { useLiffBackButton } from '../../hooks/useLiffBackButton';

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
  const { t } = useTranslation();
  const { alert: showAlert, confirm: showConfirm } = useModal();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Enable back button navigation - always goes back to home
  useLiffBackButton('query');

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
      setError(t('query.errors.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelAppointment = async (appointmentId: number) => {
    const confirmed = await showConfirm(t('appointment.cancelConfirm'), t('appointment.cancelConfirmTitle'));

    if (!confirmed) return;

    try {
      await liffApiService.cancelAppointment(appointmentId);
      // Refresh the list
      loadAppointments();
    } catch (err: unknown) {
      logger.error('Failed to cancel appointment:', err);
      
      // Check for structured error response
      const errorDetail = (err as any)?.response?.data?.detail;
      if (errorDetail && typeof errorDetail === 'object' && errorDetail.error === 'cancellation_too_soon') {
        // Use structured error response
        const hours = errorDetail.minimum_hours || 24;
        await showAlert(t('appointment.errors.cancelTooSoon', { hours }), t('appointment.cancelFailedTitle'));
      } else {
        // Fallback: try to extract from error message (for backward compatibility)
        const errorMessage = typeof errorDetail === 'string' ? errorDetail : (err as any)?.response?.data?.detail || (err as any)?.message || '';
        // Check for numeric pattern that works across languages
        const hoursMatch = errorMessage.match(/(\d+)/);
        if (hoursMatch && (
          errorMessage.includes('取消') || 
          errorMessage.includes('cancel') || 
          errorMessage.includes('キャンセル')
        )) {
          const hours = hoursMatch[1];
          await showAlert(t('appointment.errors.cancelTooSoon', { hours }), t('appointment.cancelFailedTitle'));
        } else {
          await showAlert(t('appointment.errors.cancelFailed'), t('appointment.cancelFailedTitle'));
        }
      }
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
            {t('query.title')}
          </h1>
        </div>

        {appointments.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-400 text-6xl mb-4">📅</div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {t('query.noAppointments')}
            </h3>
            <p className="text-gray-600 mb-6">
              {t('query.noAppointmentsDesc')}
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

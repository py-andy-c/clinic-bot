import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseModal } from './shared/BaseModal';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../types/api';
import AlternativeSlotsDisplay from './AlternativeSlotsDisplay';
import { LoadingSpinner } from './shared';

interface TimeConfirmationModalProps {
  appointment: {
    appointment_id: number;
    calendar_event_id: number;
    patient_name: string;
    appointment_type_name: string;
    start_time: string;
    alternative_time_slots?: string[] | null;
  };
  onClose: () => void;
  onConfirm: () => void;
}

const TimeConfirmationModal: React.FC<TimeConfirmationModalProps> = ({
  appointment,
  onClose,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const [selectedSlot, setSelectedSlot] = useState<string>(appointment.start_time);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!selectedSlot) return;

    try {
      setIsSubmitting(true);
      setError(null);

      // Call the API to confirm time
      await apiService.editClinicAppointment(appointment.appointment_id, {
        start_time: selectedSlot,
        confirm_time_selection: true,
      });

      // Call onConfirm callback
      onConfirm();
    } catch (err) {
      logger.error('Failed to confirm appointment time:', err);
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const alternativeSlots = appointment.alternative_time_slots || [];

  return (
    <BaseModal
      onClose={onClose}
      aria-label={t('clinic.timeConfirmation.modalTitle', '確認預約時段')}
    >
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <svg className="h-6 w-6 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0 1 1 0 012 0zm-1 3a1 1 0 00-1 1v4a1 1 0 102 0V9a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {t('clinic.timeConfirmation.modalTitle', '確認預約時段')}
          </h3>

          <div className="mb-4 p-3 bg-gray-50 rounded-md">
            <div className="text-sm text-gray-600">
              <div className="font-medium">{appointment.patient_name}</div>
              <div>{appointment.appointment_type_name}</div>
            </div>
          </div>

          <AlternativeSlotsDisplay
            currentSlot={appointment.start_time}
            alternativeSlots={alternativeSlots}
            onSlotSelect={setSelectedSlot}
            selectedSlot={selectedSlot}
          />

          {error && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-md p-3">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">
                    {t('common.error', '發生錯誤')}
                  </h3>
                  <div className="mt-2 text-sm text-red-700">
                    <p>{error}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
            >
              {t('common.cancel', '取消')}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isSubmitting || !selectedSlot}
              className="px-4 py-2 bg-primary-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 flex items-center"
            >
              {isSubmitting ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  {t('clinic.timeConfirmation.confirming', '確認中...')}
                </>
              ) : (
                t('clinic.timeConfirmation.confirm', '確認時段')
              )}
            </button>
          </div>
        </div>
      </div>
    </BaseModal>
  );
};

export default TimeConfirmationModal;
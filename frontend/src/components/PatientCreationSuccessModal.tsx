import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BaseModal } from './shared/BaseModal';
import { Button } from './shared/Button';
import { logger } from '../utils/logger';

export interface PatientCreationSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientId: number;
  patientName: string;
  phoneNumber: string | null;
  birthday: string | null;
  /**
   * Optional callback for when "新增預約" is clicked.
   * If provided, this will be called instead of navigating to the calendar page.
   * Used when creating patient from appointment modal.
   */
  onCreateAppointment?: () => void;
}

export const PatientCreationSuccessModal: React.FC<PatientCreationSuccessModalProps> = ({
  isOpen,
  onClose,
  patientId,
  patientName,
  phoneNumber,
  birthday,
  onCreateAppointment,
}) => {
  const navigate = useNavigate();

  const handleCreateAppointment = () => {
    if (onCreateAppointment) {
      // Use callback if provided (for appointment modal flow)
      // Call callback FIRST - it will handle closing the success modal internally
      // This ensures the appointment modal can update state before the success modal closes
      onCreateAppointment();
      // Don't call onClose() here - the callback will handle closing the success modal
    } else {
      // Default behavior: navigate to calendar (for patients page flow)
      onClose();
      // Store patient data in sessionStorage so it can be used in the appointment modal
      try {
        sessionStorage.setItem('preSelectedPatientData', JSON.stringify({
          id: patientId,
          full_name: patientName,
          phone_number: phoneNumber,
          birthday: birthday,
        }));
      } catch (err) {
        // Ignore sessionStorage errors (e.g., in private browsing)
        logger.warn('Failed to store patient data in sessionStorage:', err);
      }
      // Navigate to calendar with patient pre-selected
      navigate(`/admin/calendar?createAppointment=${patientId}`);
    }
  };

  if (!isOpen) return null;

  return (
    <BaseModal onClose={onClose} aria-label="病患已成功建立" className="max-w-md">
      <div className="flex justify-end items-center mb-6">
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="關閉"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="text-center space-y-6 py-4">
        {/* Success Icon */}
        <div className="flex justify-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
            <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>

        {/* Success Message */}
        <div className="space-y-2">
          <p className="text-lg font-medium text-gray-900 mb-3">病患已成功建立</p>
          <div className="text-left bg-gray-50 rounded-md p-4 space-y-2">
            <div>
              <span className="text-sm font-medium text-gray-700">姓名：</span>
              <span className="text-sm text-gray-900">{patientName}</span>
            </div>
            {phoneNumber && (
              <div>
                <span className="text-sm font-medium text-gray-700">手機號碼：</span>
                <span className="text-sm text-gray-900">{phoneNumber}</span>
              </div>
            )}
            {birthday && (
              <div>
                <span className="text-sm font-medium text-gray-700">生日：</span>
                <span className="text-sm text-gray-900">{birthday}</span>
              </div>
            )}
          </div>
        </div>

        {/* Action Button */}
        <div className="pt-4">
          <Button
            variant="primary"
            onClick={handleCreateAppointment}
            className="w-full"
          >
            新增預約
          </Button>
        </div>
      </div>
    </BaseModal>
  );
};


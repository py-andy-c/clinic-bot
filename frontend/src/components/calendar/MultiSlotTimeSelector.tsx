import React from 'react';
import { BaseModal } from './BaseModal';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { useTranslation } from 'react-i18next';
import { AppointmentType } from '../../types';
import Step3SelectDateTime from '../../liff/appointment/Step3SelectDateTime';

interface MultiSlotTimeSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (selectedSlots: Array<{date: string, time: string}>) => void;
  appointmentTypeId: number;
  appointmentTypes: AppointmentType[];
}

export const MultiSlotTimeSelector: React.FC<MultiSlotTimeSelectorProps> = ({
  isOpen,
  onClose,
  onConfirm,
  appointmentTypeId,
  appointmentTypes,
}) => {
  const { t } = useTranslation();
  const { selectedTimeSlots, setDateTime, setMultipleSlotMode, setAppointmentType } = useAppointmentStore();

  // Ensure we're in multiple slot mode and have the correct appointment type when this component opens
  React.useEffect(() => {
    if (isOpen) {
      setMultipleSlotMode(true);
      // Find the appointment type and set it in the store
      const appointmentType = appointmentTypes.find((at: AppointmentType) => at.id === appointmentTypeId);
      if (appointmentType) {
        setAppointmentType(appointmentTypeId, appointmentType);
      }
    }
  }, [isOpen, setMultipleSlotMode, setAppointmentType, appointmentTypeId, appointmentTypes]);

  const handleConfirm = () => {
    if (selectedTimeSlots.length > 0) {
      onConfirm(selectedTimeSlots);
      onClose();
    }
  };

  const handleClose = () => {
    // Clear selections when closing without confirming
    setDateTime('', '');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <BaseModal
      onClose={handleClose}
      className="!p-0"
      fullScreen={false}
    >
      <div className="flex flex-col h-full max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0">
          <h3 className="text-lg font-semibold text-gray-900">
            {t('appointment.edit.selectNewSlots', '重新選擇時段')}
          </h3>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
            aria-label={t('common.close', '關閉')}
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4 text-sm text-gray-600">
            {t('appointment.edit.multiSlotHelp', '請重新選擇您方便的時段。之前的選擇將被清除。')}
          </div>
          <Step3SelectDateTime />
        </div>

        {/* Footer */}
        <div className="flex justify-end space-x-3 p-4 border-t border-gray-200 flex-shrink-0">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
          >
            {t('common.cancel', '取消')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={selectedTimeSlots.length === 0}
            className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {t('appointment.edit.confirmSlots', '確認選擇')}
          </button>
        </div>
      </div>
    </BaseModal>
  );
};
import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatAppointmentDateTime } from '../../utils/calendarUtils';
import { getStatusBadgeColor } from '../../utils/appointmentStatus';

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
  has_active_receipt?: boolean; // Whether appointment has an active (non-voided) receipt
  has_any_receipt?: boolean; // Whether appointment has any receipt (active or voided)
  receipt_id?: number | null; // ID of active receipt (null if no active receipt)
  receipt_ids?: number[]; // List of all receipt IDs (always included, empty if none)
}

interface AppointmentCardProps {
  appointment: Appointment;
  onCancel: () => void;
  onReschedule?: () => void;
  allowPatientDeletion?: boolean;
  onViewReceipt?: (() => void) | undefined; // Callback to view receipt
}

const AppointmentCard: React.FC<AppointmentCardProps> = ({ appointment, onCancel, onReschedule, allowPatientDeletion = true, onViewReceipt }) => {
  const { t } = useTranslation();

  const getStatusColor = (status: string): string | null => {
    return getStatusBadgeColor(status);
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'confirmed':
        return t('appointmentCard.status.confirmed');
      case 'canceled_by_patient':
        return t('appointmentCard.status.canceledByPatient');
      case 'canceled_by_clinic':
        return t('appointmentCard.status.canceledByClinic');
      default:
        return status;
    }
  };

  const formattedDateTime = appointment.start_time 
    ? formatAppointmentDateTime(appointment.start_time)
    : '';
  const canCancel = appointment.status === 'confirmed';
  const canModify = !appointment.has_any_receipt; // Constraint 1: Cannot modify if has any receipt
  const showReceiptButton = appointment.has_active_receipt && onViewReceipt;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <div className="flex justify-between items-start mb-3 gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900">{appointment.patient_name}</h3>
          <p className="text-sm text-gray-600">{appointment.appointment_type_name}</p>
        </div>
        {getStatusColor(appointment.status) && (
          <span className={`px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap flex-shrink-0 ${getStatusColor(appointment.status)}`}>
            {getStatusText(appointment.status)}
          </span>
        )}
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex items-center text-sm text-gray-600">
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          {appointment.practitioner_name}
        </div>

        <div className="flex items-center text-sm text-gray-600">
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {formattedDateTime}
        </div>

        {appointment.notes && (
          <div className="text-sm text-gray-600">
            <span className="font-medium">{t('appointmentCard.notes')}</span>
            {appointment.notes}
          </div>
        )}
      </div>

      {showReceiptButton && (
        <button
          onClick={onViewReceipt}
          className="w-full bg-green-50 text-green-600 border border-green-200 rounded-md py-2 px-4 hover:bg-green-100 transition-colors text-sm font-medium mb-2"
        >
          {t('appointmentCard.viewReceiptButton', '查看收據')}
        </button>
      )}
      
      {canCancel && canModify && (
        <div className="flex space-x-2">
          {onReschedule && (
            <button
              onClick={onReschedule}
              className="flex-1 bg-blue-50 text-blue-600 border border-blue-200 rounded-md py-2 px-4 hover:bg-blue-100 transition-colors text-sm font-medium"
            >
              {t('appointmentCard.rescheduleButton')}
            </button>
          )}
          {allowPatientDeletion && (
            <button
              onClick={onCancel}
              className="flex-1 bg-red-50 text-red-600 border border-red-200 rounded-md py-2 px-4 hover:bg-red-100 transition-colors text-sm font-medium"
            >
              {t('appointmentCard.cancelButton')}
            </button>
          )}
        </div>
      )}
      
    </div>
  );
};

export default AppointmentCard;

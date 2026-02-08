/**
 * ConflictWarningModal Component
 *
 * Modal for displaying conflicting appointments when creating an availability exception.
 * Allows user to proceed with creation or cancel.
 */

import React from 'react';
import { BaseModal } from './BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from '../shared/ModalParts';
import { Button } from '../shared/Button';

export interface ConflictAppointment {
  calendar_event_id: number;
  date: string;
  start_time: string;
  end_time: string;
  patient: string;
  appointment_type: string | null;
}

export interface ConflictWarningModalProps {
  conflictingAppointments: ConflictAppointment[];
  onConfirm: () => void;
  onCancel: () => void;
  formatTimeString: (timeStr: string) => string;
  formatAppointmentDateOnly: (date: string | Date) => string;
  isLoading?: boolean;
}

export const ConflictWarningModal: React.FC<ConflictWarningModalProps> = React.memo(({
  conflictingAppointments,
  onConfirm,
  onCancel,
  formatTimeString,
  formatAppointmentDateOnly,
  isLoading = false,
}) => {
  return (
    <BaseModal
      onClose={onCancel}
      aria-label="建立休診時段將與現有預約衝突"

    >
      <ModalHeader title="建立休診時段將與現有預約衝突" showClose onClose={onCancel} />
      <ModalBody>
        <div className="space-y-2">
          {conflictingAppointments.map((appointment, index) => (
            <div key={appointment.calendar_event_id || index} className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <p className="font-medium text-gray-900">
                    {appointment.patient}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    {formatAppointmentDateOnly(appointment.date)} {formatTimeString(appointment.start_time)} - {formatTimeString(appointment.end_time)}
                  </p>
                  {appointment.appointment_type && (
                    <p className="text-sm text-gray-500 mt-1">預約類型：{appointment.appointment_type}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </ModalBody>
      <ModalFooter loading={isLoading}>
        <Button
          onClick={onCancel}
          variant="secondary"
        >
          取消
        </Button>
        <Button
          onClick={onConfirm}
          variant="primary"
          style={{ backgroundColor: '#eab308', color: '#000' }} // Custom yellow as per existing btn-primary-yellow
          loading={isLoading}
        >
          {isLoading ? '建立中...' : '仍要建立'}
        </Button>
      </ModalFooter>
    </BaseModal>
  );
});
/**
 * ConflictModal Component
 * 
 * Modal for displaying conflicting appointments when creating an availability exception.
 */

import React from 'react';
import { BaseModal } from './BaseModal';
import { ModalHeader, ModalBody } from '../shared/ModalParts';

export interface ConflictAppointment {
  title?: string;
  patient_name?: string;
  start_time: string;
  end_time: string;
  notes?: string;
}

export interface ConflictModalProps {
  conflictingAppointments: ConflictAppointment[];
  onClose: () => void;
  formatTimeString: (timeStr: string) => string;
}

export const ConflictModal: React.FC<ConflictModalProps> = React.memo(({
  conflictingAppointments,
  onClose,
  formatTimeString,
}) => {
  return (
    <BaseModal
      onClose={onClose}
      aria-label="無法建立休診時段"
      showCloseButton={false}
    >
      <ModalHeader title="無法建立休診時段" showClose onClose={onClose} />
      <ModalBody>
        <p className="text-gray-700 mb-4">
          此休診時段與現有預約衝突，請先刪除以下衝突的預約後再建立休診時段：
        </p>
        <div className="space-y-2">
          {conflictingAppointments.map((appointment, index) => (
            <div key={index} className="bg-red-50 border border-red-200 rounded-md p-3">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <p className="font-medium text-gray-900">
                    {appointment.title || appointment.patient_name || '預約'}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    {formatTimeString(appointment.start_time)} - {formatTimeString(appointment.end_time)}
                  </p>
                  {appointment.notes && (
                    <p className="text-sm text-gray-500 mt-1">備註：{appointment.notes}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </ModalBody>
    </BaseModal>
  );
});


/**
 * ConflictWarningModal Component
 *
 * Modal for displaying conflicting appointments when creating an availability exception.
 * Allows user to proceed with creation or cancel.
 */

import React from 'react';
import { BaseModal } from './BaseModal';

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
}

export const ConflictWarningModal: React.FC<ConflictWarningModalProps> = React.memo(({
  conflictingAppointments,
  onConfirm,
  onCancel,
  formatTimeString,
  formatAppointmentDateOnly,
}) => {
  return (
    <BaseModal
      onClose={onCancel}
      className="max-h-[80vh] overflow-y-auto"
      aria-label="建立休診時段將與現有預約衝突"
    >
        <div className="flex items-center mb-4">
          <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center mr-3">
            <svg className="w-5 h-5 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-yellow-800">建立休診時段將與現有預約衝突</h3>
        </div>
        <div className="space-y-2 mb-6 max-h-64 overflow-y-auto">
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
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-white bg-yellow-600 hover:bg-yellow-700 rounded-md transition-colors"
          >
            仍要建立
          </button>
        </div>
    </BaseModal>
  );
});
/**
 * ConflictModal Component
 * 
 * Modal for displaying conflicting appointments when creating an availability exception.
 */

import React from 'react';
import { BaseModal } from './BaseModal';

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
      className="max-h-[80vh] overflow-y-auto"
      aria-label="無法建立休診時段"
    >
        <div className="flex items-center mb-4">
          <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center mr-3">
            <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-red-800">無法建立休診時段</h3>
        </div>
        <p className="text-gray-700 mb-4">
          此休診時段與現有預約衝突，請先刪除以下衝突的預約後再建立休診時段：
        </p>
        <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
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
    </BaseModal>
  );
});


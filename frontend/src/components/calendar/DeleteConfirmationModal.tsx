/**
 * DeleteConfirmationModal Component
 * 
 * Modal for confirming deletion of appointments or availability exceptions.
 */

import React from 'react';
import { BaseModal } from './BaseModal';
import { CalendarEvent } from '../../utils/calendarDataAdapter';

export interface DeleteConfirmationModalProps {
  event: CalendarEvent;
  onCancel: () => void;
  onConfirm: () => void;
}

export const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  event,
  onCancel,
  onConfirm,
}) => {
  const isAppointment = event.resource.type === 'appointment';

  return (
    <BaseModal
      onClose={onCancel}
      aria-label={isAppointment ? '確認取消預約' : '確認刪除休診時段'}
    >
        <div className="flex items-center mb-4">
          <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center mr-3">
            <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-red-800">
            {isAppointment ? '確認取消預約' : '確認刪除休診時段'}
          </h3>
        </div>
        <div className="space-y-3 mb-4">
          <p className="text-gray-700">
            {isAppointment 
              ? '您確定要取消此預約嗎？'
              : '您確定要刪除此休診時段嗎？'}
          </p>
          {isAppointment && (
            <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
              <p className="text-sm text-blue-800">
                <strong>提醒：</strong>取消預約後，系統將會自動通知患者此預約已被取消。
              </p>
            </div>
          )}
        </div>
        <div className="flex justify-end space-x-2">
          <button 
            onClick={onCancel}
            className="btn-secondary"
          >
            取消
          </button>
          <button 
            onClick={onConfirm}
            className="btn-primary bg-red-600 hover:bg-red-700"
          >
            {isAppointment ? '確認取消' : '確認刪除'}
          </button>
        </div>
    </BaseModal>
  );
};


/**
 * DeleteConfirmationModal Component
 * 
 * Modal for confirming deletion of appointments or availability exceptions.
 */

import React from 'react';
import { BaseModal } from './BaseModal';
import { CalendarEvent } from '../../utils/calendarDataAdapter';
import { logger } from '../../utils/logger';

export interface DeleteConfirmationModalProps {
  event: CalendarEvent;
  onCancel: () => void;
  onConfirm: () => Promise<any>;
  onClose: (preview?: any) => void;
}

export const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = React.memo(({
  event,
  onCancel,
  onConfirm,
  onClose,
}) => {
  const isAppointment = event.resource.type === 'appointment';
  const [step, setStep] = React.useState<'confirm' | 'success'>('confirm');
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [notificationPreview, setNotificationPreview] = React.useState<any | null>(null);

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      const result = await onConfirm();
      if (isAppointment) {
        setNotificationPreview(result?.notification_preview || null);
        setStep('success');
      } else {
        onClose();
      }
    } catch (err) {
      logger.error('Failed to delete:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  if (step === 'success') {
    return (
      <BaseModal
        onClose={() => onClose(notificationPreview)}
        aria-label="成功"
      >
        <div className="flex flex-col items-center justify-center py-8 space-y-4">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
            <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-xl font-medium text-gray-900">預約已成功取消！</h3>
        </div>
      </BaseModal>
    );
  }

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
        </div>
        <div className="flex justify-end space-x-2">
          <button 
            onClick={onCancel}
            className="btn-secondary"
            disabled={isDeleting}
          >
            返回
          </button>
          <button 
            onClick={handleConfirm}
            className="btn-primary bg-red-600 hover:bg-red-700"
            disabled={isDeleting}
          >
            {isDeleting ? '處理中...' : (isAppointment ? '確認取消' : '確認刪除')}
          </button>
        </div>
    </BaseModal>
  );
});


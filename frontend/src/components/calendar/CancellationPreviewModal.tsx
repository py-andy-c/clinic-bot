/**
 * CancellationPreviewModal Component
 * 
 * Modal for previewing the cancellation message before confirming appointment deletion.
 */

import React from 'react';
import { BaseModal } from './BaseModal';

export interface CancellationPreviewModalProps {
  previewMessage: string;
  onBack: () => void;
  onConfirm: () => void;
}

export const CancellationPreviewModal: React.FC<CancellationPreviewModalProps> = ({
  previewMessage,
  onBack,
  onConfirm,
}) => {
  return (
    <BaseModal
      onClose={onBack}
      aria-label="LINE訊息預覽"
    >
        <div className="flex items-center mb-4">
          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-3">
            <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-blue-800">
            LINE訊息預覽
          </h3>
        </div>
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              病患將收到此LINE訊息
            </label>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div className="text-sm text-gray-700 whitespace-pre-line">
                {previewMessage}
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-end space-x-2">
          <button
            onClick={onBack}
            className="btn-secondary"
          >
            返回修改
          </button>
          <button
            onClick={onConfirm}
            className="btn-primary bg-red-600 hover:bg-red-700"
          >
            確認取消預約
          </button>
        </div>
    </BaseModal>
  );
};


/**
 * CancellationPreviewModal Component
 * 
 * Modal for previewing the cancellation message before confirming appointment deletion.
 */

import React from 'react';
import { BaseModal } from './BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from '../shared/ModalParts';

export interface CancellationPreviewModalProps {
  previewMessage: string;
  onBack: () => void;
  onConfirm: () => void;
}

export const CancellationPreviewModal: React.FC<CancellationPreviewModalProps> = React.memo(({
  previewMessage,
  onBack,
  onConfirm,
}) => {
  return (
    <BaseModal
      onClose={onBack}
      aria-label="LINE訊息預覽"
     
    >
      <ModalHeader title="LINE訊息預覽" showClose onClose={onBack} />
      <ModalBody>
        <div className="space-y-4">
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
      </ModalBody>
      <ModalFooter>
        <button
          onClick={onBack}
          className="btn-secondary"
        >
          返回修改
        </button>
        <button
          onClick={onConfirm}
          className="btn-primary-red"
        >
          確認取消預約
        </button>
      </ModalFooter>
    </BaseModal>
  );
});


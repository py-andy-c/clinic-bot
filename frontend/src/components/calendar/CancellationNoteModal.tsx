/**
 * CancellationNoteModal Component
 * 
 * Modal for entering cancellation note when deleting an appointment.
 */

import React from 'react';
import { BaseModal } from './BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from '../shared/ModalParts';

export interface CancellationNoteModalProps {
  cancellationNote: string;
  isLoading: boolean;
  onNoteChange: (note: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}

export const CancellationNoteModal: React.FC<CancellationNoteModalProps> = React.memo(({
  cancellationNote,
  isLoading,
  onNoteChange,
  onBack,
  onSubmit,
}) => {
  return (
    <BaseModal
      onClose={onBack}
      aria-label="取消預約備註"
     
    >
      <ModalHeader title="取消預約備註(選填)" showClose onClose={onBack} />
      <ModalBody>
        <div className="space-y-4">
          <textarea
            id="cancellation-note"
            value={cancellationNote}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="例如：臨時休診"
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={3}
            maxLength={200}
          />
          <p className="text-sm text-gray-500">
            {cancellationNote.length}/200 字元
          </p>
        </div>
      </ModalBody>
      <ModalFooter>
        <button
          onClick={onBack}
          className="btn-secondary"
        >
          返回
        </button>
        <button
          onClick={onSubmit}
          disabled={isLoading}
          className="btn-primary"
        >
          {isLoading ? '產生預覽中...' : '下一步'}
        </button>
      </ModalFooter>
    </BaseModal>
  );
});


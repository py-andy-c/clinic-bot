/**
 * CancellationNoteModal Component
 * 
 * Modal for entering cancellation note when deleting an appointment.
 */

import React from 'react';
import { BaseModal } from './BaseModal';

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
        <div className="flex items-center mb-4">
          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-3">
            <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-blue-800">
            取消預約備註(選填)
          </h3>
        </div>
        <div className="space-y-4 mb-6">
          <textarea
            id="cancellation-note"
            value={cancellationNote}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="例如：臨時休診"
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={3}
            maxLength={200}
          />
          <p className="text-sm text-gray-500 mt-1">
            {cancellationNote.length}/200 字元
          </p>
        </div>
        <div className="flex justify-end space-x-2">
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
        </div>
    </BaseModal>
  );
});


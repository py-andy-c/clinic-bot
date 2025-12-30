import React from 'react';
import { BaseModal } from './shared/BaseModal';

interface PractitionerAssignmentPromptModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  practitionerName?: string;
}

export const PractitionerAssignmentPromptModal: React.FC<PractitionerAssignmentPromptModalProps> = ({
  isOpen,
  onConfirm,
  onCancel,
  practitionerName,
}) => {
  if (!isOpen) return null;

  // Handle ESC key
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onCancel]);

  return (
    <BaseModal
      onClose={onCancel}
      aria-label="指定治療師確認"
      closeOnOverlayClick={false}
      showCloseButton={false}
    >
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">
          指定治療師確認
        </h2>
        <p className="text-sm text-gray-700">
          {practitionerName ? (
            <>此治療師（{practitionerName}）並非此病患的指定治療師。是否要將此治療師設為指定治療師？</>
          ) : (
            <>此治療師並非此病患的指定治療師。是否要將此治療師設為指定治療師？</>
          )}
        </p>
        <div className="flex gap-3 justify-end pt-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            type="button"
          >
            否
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-primary-600 text-white rounded-md text-sm font-medium hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            type="button"
          >
            是
          </button>
        </div>
      </div>
    </BaseModal>
  );
};


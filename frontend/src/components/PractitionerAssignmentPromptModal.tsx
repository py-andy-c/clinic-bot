import React from 'react';
import { BaseModal } from './shared/BaseModal';
import { useModalQueue } from '../contexts/ModalQueueContext';

interface PractitionerAssignmentPromptModalProps {
  isOpen?: boolean; // Optional for backward compatibility during migration
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  practitionerName?: string;
  currentAssignedPractitioners?: Array<{ id: number; full_name: string }>; // Current assigned practitioners to display
}

export const PractitionerAssignmentPromptModal: React.FC<PractitionerAssignmentPromptModalProps> = ({
  isOpen,
  onConfirm,
  onCancel,
  practitionerName,
  currentAssignedPractitioners = [],
}) => {
  // All hooks must be called before any conditional returns
  // Use queue if isOpen is undefined (queue-managed mode)
  // In legacy mode (isOpen provided), we'll handle closing via onCancel/onConfirm
  const isQueueManaged = isOpen === undefined;
  const queueMethods = useModalQueue();

  const handleCancel = React.useCallback(async () => {
    if (onCancel) {
      onCancel();
    }
    if (isQueueManaged && queueMethods) {
      // Cancel the queue and close this modal
      queueMethods.cancelQueue();
      await queueMethods.closeCurrent();
    }
  }, [onCancel, isQueueManaged, queueMethods]);

  const handleConfirm = React.useCallback(async () => {
    await onConfirm();
    // Close this modal after confirmation (next modal will be shown if queued)
    if (isQueueManaged && queueMethods) {
      await queueMethods.closeCurrent();
    }
  }, [onConfirm, isQueueManaged, queueMethods]);

  // Handle ESC key
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [handleCancel]);

  // Backward compatibility: if isOpen is provided and false, don't render
  if (isOpen !== undefined && !isOpen) {
    return null;
  }

  return (
    <BaseModal
      onClose={handleCancel}
      aria-label="負責人員確認"
      closeOnOverlayClick={false}
      showCloseButton={false}
    >
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">
          負責人員確認
        </h2>
        <p className="text-sm text-gray-700">
          {practitionerName ? (
            <>此治療師（{practitionerName}）並非此病患的負責人員。是否要將此治療師加為負責人員？</>
          ) : (
            <>此治療師並非此病患的負責人員。是否要將此治療師加為負責人員？</>
          )}
        </p>
        {currentAssignedPractitioners.length > 0 && (
          <div className="bg-gray-50 rounded-md p-3">
            <p className="text-sm font-medium text-gray-700 mb-2">目前的負責人員列表：</p>
            <ul className="list-disc list-inside space-y-1">
              {currentAssignedPractitioners.map((p) => (
                <li key={p.id} className="text-sm text-gray-900">
                  {p.full_name}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-3 justify-end pt-4">
          <button
            onClick={handleCancel}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            type="button"
          >
            否
          </button>
          <button
            onClick={handleConfirm}
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


import React from 'react';
import { BaseModal } from './shared/BaseModal';
import { useModalQueue } from '../contexts/ModalQueueContext';

interface PractitionerAssignmentConfirmationModalProps {
  isOpen?: boolean; // Optional for backward compatibility during migration
  onClose?: () => void;
  assignedPractitioners: Array<{ id: number; full_name: string }>;
  excludePractitionerId?: number; // Practitioner ID to exclude from the list (the one just added)
}

export const PractitionerAssignmentConfirmationModal: React.FC<PractitionerAssignmentConfirmationModalProps> = ({
  isOpen,
  onClose,
  assignedPractitioners,
  excludePractitionerId,
}) => {
  // Backward compatibility: if isOpen is provided and false, don't render
  if (isOpen !== undefined && !isOpen) {
    return null;
  }

  // Use queue if isOpen is undefined (queue-managed mode)
  // In legacy mode (isOpen provided), we'll handle closing via onClose
  const isQueueManaged = isOpen === undefined;
  const queueMethods = isQueueManaged ? useModalQueue() : null;

  const handleClose = React.useCallback(async () => {
    if (onClose) {
      onClose();
    }
    // Close this modal (queue will show next if available)
    if (isQueueManaged && queueMethods) {
      await queueMethods.closeCurrent();
    }
  }, [onClose, isQueueManaged, queueMethods]);

  // Filter out the newly added practitioner if specified
  const displayedPractitioners = excludePractitionerId
    ? assignedPractitioners.filter((p) => p.id !== excludePractitionerId)
    : assignedPractitioners;

  return (
    <BaseModal
      onClose={handleClose}
      aria-label="負責人員確認"
      closeOnOverlayClick={false}
      showCloseButton={true}
    >
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">
          負責人員已更新
        </h2>
        {displayedPractitioners.length > 0 ? (
          <div>
            <p className="text-sm text-gray-700 mb-2">此病患的負責人員：</p>
            <ul className="list-disc list-inside space-y-1">
              {displayedPractitioners.map((p) => (
                <li key={p.id} className="text-sm text-gray-900">
                  {p.full_name}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-gray-700">
            已將此治療師設為負責人員。
          </p>
        )}
        <div className="flex justify-end pt-4">
          <button
            onClick={handleClose}
            className="px-4 py-2 bg-primary-600 text-white rounded-md text-sm font-medium hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            type="button"
          >
            確定
          </button>
        </div>
      </div>
    </BaseModal>
  );
};


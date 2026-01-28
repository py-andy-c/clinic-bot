import React from 'react';
import { BaseModal } from './shared/BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from './shared/ModalParts';
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
      showCloseButton={false}
    >
      <ModalHeader title="負責人員已更新" showClose onClose={handleClose} />
      <ModalBody>
        <div className="space-y-4">
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
        </div>
      </ModalBody>
      <ModalFooter>
        <button
          onClick={handleClose}
          className="btn-primary"
          type="button"
        >
          確定
        </button>
      </ModalFooter>
    </BaseModal>
  );
};


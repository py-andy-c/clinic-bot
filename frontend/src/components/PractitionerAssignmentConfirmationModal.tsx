import React from 'react';
import { BaseModal } from './shared/BaseModal';

interface PractitionerAssignmentConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  assignedPractitioners: Array<{ id: number; full_name: string }>;
}

export const PractitionerAssignmentConfirmationModal: React.FC<PractitionerAssignmentConfirmationModalProps> = ({
  isOpen,
  onClose,
  assignedPractitioners,
}) => {
  if (!isOpen) return null;

  return (
    <BaseModal
      onClose={onClose}
      aria-label="負責人員確認"
      closeOnOverlayClick={true}
    >
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">
          負責人員已更新
        </h2>
        <div>
          <p className="text-sm text-gray-700 mb-2">此病患的負責人員：</p>
          <ul className="list-disc list-inside space-y-1">
            {assignedPractitioners.map((p) => (
              <li key={p.id} className="text-sm text-gray-900">
                {p.full_name}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-end pt-4">
          <button
            onClick={onClose}
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


import React from 'react';
import { BaseModal } from './BaseModal';
import { ModalHeader, ModalBody } from './ModalParts';

interface InfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  ariaLabel?: string;
}

export const InfoModal: React.FC<InfoModalProps> = ({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  ariaLabel 
}) => {
  if (!isOpen) return null;

  return (
    <BaseModal
      onClose={onClose}
      aria-label={ariaLabel || title}
      closeOnOverlayClick={false}
     
    >
      <ModalHeader title={title} showClose onClose={onClose} />
      <ModalBody>
        <div className="text-sm text-gray-700">
          {children}
        </div>
      </ModalBody>
    </BaseModal>
  );
};

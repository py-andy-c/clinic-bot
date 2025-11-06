/**
 * BaseModal Component
 * 
 * Base modal component providing shared structure for all calendar modals.
 * Handles portal rendering, overlay, and common styling.
 */

import React from 'react';
import { createPortal } from 'react-dom';

export interface BaseModalProps {
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

export const BaseModal: React.FC<BaseModalProps> = ({
  children,
  onClose,
  className = '',
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}) => {
  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if clicking the overlay itself, not the modal content
    if (e.target === e.currentTarget && onClose) {
      onClose();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]"
      style={{ width: '100vw', height: '100vh' }}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      <div
        className={`bg-white rounded-lg p-6 max-w-md w-full mx-4 ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
};


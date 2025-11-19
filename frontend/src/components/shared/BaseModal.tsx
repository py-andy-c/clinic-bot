/**
 * BaseModal Component
 * 
 * Shared base modal component providing common structure for all modals.
 * Handles portal rendering, overlay, and common styling.
 * This is the unified base that both ModalContext and calendar modals use.
 */

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Z_INDEX } from '../../constants/app';

export interface BaseModalProps {
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  zIndex?: number;
}

export const BaseModal: React.FC<BaseModalProps> = React.memo(({
  children,
  onClose,
  className = '',
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  zIndex = Z_INDEX.MODAL,
}) => {
  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if clicking the overlay itself, not the modal content
    if (e.target === e.currentTarget && onClose) {
      onClose();
    }
  };

  // Handle Escape key at document level (overlay div is not focusable)
  useEffect(() => {
    if (!onClose) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center"
      style={{ 
        width: '100vw', 
        height: '100vh',
        zIndex: zIndex,
      }}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      <div
        className={`bg-white rounded-lg p-6 max-w-md w-full mx-4 mb-4 max-h-[90vh] overflow-y-auto ${className}`}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body
  );
});

BaseModal.displayName = 'BaseModal';


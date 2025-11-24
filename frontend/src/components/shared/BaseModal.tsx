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
  fullScreen?: boolean;
}

export const BaseModal: React.FC<BaseModalProps> = React.memo(({
  children,
  onClose,
  className = '',
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  zIndex = Z_INDEX.MODAL,
  fullScreen = false,
}) => {
  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if clicking the overlay itself, not the modal content
    if (e.target === e.currentTarget && onClose) {
      onClose();
    }
  };

  // Prevent body scroll when modal is open (especially important for fullScreen)
  // For iOS Safari, we need to use position: fixed instead of overflow: hidden
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    const originalPosition = document.body.style.position;
    const originalTop = document.body.style.top;
    const originalWidth = document.body.style.width;
    const scrollY = window.scrollY;

    // Fix body position to prevent scrolling (iOS Safari solution)
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';

    return () => {
      // Restore original styles
      document.body.style.position = originalPosition;
      document.body.style.top = originalTop;
      document.body.style.width = originalWidth;
      document.body.style.overflow = originalOverflow;

      // Restore scroll position
      window.scrollTo(0, scrollY);
    };
  }, []);

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
      className={fullScreen
        ? "fixed inset-0 bg-white"
        : "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center"
      }
      style={{
        width: '100vw',
        height: '100vh',
        minHeight: '100vh',
        zIndex: zIndex,
        overflow: 'hidden',
      }}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      <div
        className={fullScreen
          ? `w-screen h-[100dvh] min-h-[100dvh] overflow-hidden ${className}`
          : `bg-white rounded-lg p-6 max-w-md w-full mx-4 mb-4 max-h-[90vh] overflow-y-auto ${className}`
        }
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


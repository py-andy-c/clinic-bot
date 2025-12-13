/**
 * BaseModal Component
 * 
 * Shared base modal component providing common structure for all modals.
 * Handles portal rendering, overlay, and common styling.
 * This is the unified base that both ModalContext and calendar modals use.
 */

import React, { useEffect, useRef } from 'react';
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
  showCloseButton?: boolean; // Show X button in top-right corner (default: true)
  closeOnOverlayClick?: boolean; // Close when clicking outside modal (default: false)
}

export const BaseModal: React.FC<BaseModalProps> = React.memo(({
  children,
  onClose,
  className = '',
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  zIndex = Z_INDEX.MODAL,
  fullScreen = false,
  showCloseButton = true,
  closeOnOverlayClick = false,
}) => {
  const historyPushedRef = useRef(false);
  const isHandlingBackRef = useRef(false);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if clicking the overlay itself, not the modal content, and if enabled
    if (closeOnOverlayClick && e.target === e.currentTarget && onClose) {
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

  // Handle browser back button for full-screen modals
  // Push history entry when modal opens and listen for popstate to close modal
  useEffect(() => {
    // Only handle back button for full-screen modals with onClose
    if (!fullScreen || !onClose) {
      return;
    }

    // Check if current history state is already a full-screen modal state
    // This handles the case where modal was closed and reopened (ref resets but history remains)
    const currentState = window.history.state as { fullScreenModal?: boolean } | null;
    const alreadyHasHistoryEntry = currentState?.fullScreenModal === true;

    // Edge case: We tracked pushing a state, but current state doesn't have it
    // This means user went back while component was unmounted - close the modal
    if (historyPushedRef.current && !alreadyHasHistoryEntry) {
      historyPushedRef.current = false;
      onClose();
      return;
    }

    // Push a history entry when full-screen modal opens (only if we haven't already)
    if (!historyPushedRef.current) {
      if (alreadyHasHistoryEntry) {
        // History entry already exists from previous mount - just track it
        historyPushedRef.current = true;
      } else {
        // Push new history entry
        const state = { fullScreenModal: true };
        window.history.pushState(state, '');
        historyPushedRef.current = true;
      }
    }

    // Handle popstate event (browser back button)
    const handlePopState = (_event: PopStateEvent) => {
      // Prevent race conditions
      if (isHandlingBackRef.current) {
        return;
      }

      // Check if we're going back from our modal state
      // If we tracked pushing a state and we're no longer on it, we went back
      const currentHistoryState = window.history.state as { fullScreenModal?: boolean } | null;
      const weTrackedPushingState = historyPushedRef.current;
      const isCurrentlyOnModalState = currentHistoryState?.fullScreenModal === true;
      
      // Close if we tracked pushing a state and we're no longer on the modal state
      if (weTrackedPushingState && !isCurrentlyOnModalState) {
        isHandlingBackRef.current = true;
        historyPushedRef.current = false;
        onClose();
        // Reset flag after a delay to allow onClose to complete and prevent race conditions
        // This delay is necessary because onClose may trigger component unmount/remount
        setTimeout(() => {
          isHandlingBackRef.current = false;
        }, 100);
      }
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      // Note: We intentionally don't clean up the history entry on normal close.
      // Reasons:
      // 1. History entries are harmless and naturally replaced by subsequent navigation
      // 2. Cleaning up would require calling history.back() which could interfere with user navigation
      // 3. The entry helps detect if user went back while component was unmounted (see edge case above)
      // Don't reset historyPushedRef here - let it persist across remounts to track history state
    };
  }, [fullScreen, onClose]);

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
          ? `w-screen h-[100dvh] min-h-[100dvh] overflow-hidden relative ${className}`
          : `bg-white rounded-lg p-6 max-w-md w-full mx-4 mb-4 max-h-[90vh] overflow-y-auto relative ${className}`
        }
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        {/* Close button (X) in top-right corner */}
        {showCloseButton && onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-20 bg-white rounded-full p-1.5 shadow-md text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            aria-label="關閉"
            type="button"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
});

BaseModal.displayName = 'BaseModal';


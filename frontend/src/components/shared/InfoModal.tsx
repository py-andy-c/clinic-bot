import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface InfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
  children: React.ReactNode;
  title?: string;
}

/**
 * Shared InfoModal component that renders outside parent containers using portal.
 * Positions itself relative to a button element and handles click-outside-to-close.
 */
export const InfoModal: React.FC<InfoModalProps> = ({
  isOpen,
  onClose,
  buttonRef,
  children,
  title,
}) => {
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0 });

  // Calculate popup position based on button position
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const popupWidth = 384; // w-96 = 24rem = 384px
      const popupMaxHeight = window.innerHeight * 0.8; // max-h-[80vh]
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const padding = 16;
      const gap = 8; // gap between button and popup

      let left = rect.left;
      // Adjust if popup would go off-screen on the right
      if (left + popupWidth > viewportWidth - padding) {
        left = viewportWidth - popupWidth - padding;
      }
      // Ensure it doesn't go off-screen on the left
      if (left < padding) {
        left = padding;
      }

      let top = rect.bottom + gap;
      // Check if popup would go off-screen at the bottom
      const spaceBelow = viewportHeight - rect.bottom - gap;
      const spaceAbove = rect.top - gap;
      
      // If not enough space below but more space above, position above the button
      if (spaceBelow < popupMaxHeight && spaceAbove > spaceBelow) {
        top = rect.top - popupMaxHeight - gap;
        // Ensure it doesn't go off-screen at the top
        if (top < padding) {
          top = padding;
        }
      } else {
        // Ensure it doesn't go off-screen at the bottom
        const maxTop = viewportHeight - popupMaxHeight - padding;
        if (top > maxTop) {
          top = maxTop;
        }
      }

      setPopupPosition({
        top: top,
        left: left,
      });
    }
  }, [isOpen, buttonRef]);

  // Handle click outside and Escape key to close popup
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose, buttonRef]);

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div
      ref={popupRef}
      className="fixed z-50 w-96 max-w-[calc(100vw-2rem)] sm:max-w-md bg-white border border-gray-200 rounded-lg shadow-lg p-4 max-h-[80vh] overflow-y-auto"
      style={{
        top: `${popupPosition.top}px`,
        left: `${popupPosition.left}px`,
      }}
    >
      <div className="relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-0 right-0 text-gray-400 hover:text-gray-600 focus:outline-none"
          aria-label="關閉"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
        {title && (
          <h3 className="text-sm font-semibold text-gray-900 mb-2 pr-6">
            {title}
          </h3>
        )}
        <div className="text-sm text-gray-700 space-y-2">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
};


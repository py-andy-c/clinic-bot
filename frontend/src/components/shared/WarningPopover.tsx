import React from 'react';
import { createPortal } from 'react-dom';
import { usePopover } from '../../hooks/usePopover';

interface WarningPopoverProps {
  message: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * WarningPopover Component
 * 
 * Displays a popover with a warning message when clicking the trigger element.
 * Uses a portal to render outside modal boundaries and positions itself
 * to avoid screen borders.
 */
export const WarningPopover: React.FC<WarningPopoverProps> = ({
  message,
  children,
  className = '',
}) => {
  const { isOpen, setIsOpen, position, popoverRef, triggerRef } = usePopover({
    popoverWidth: 280, // Fixed width for warning popover
  });

  return (
    <>
      <div
        ref={triggerRef as React.RefObject<HTMLDivElement>}
        onClick={() => setIsOpen(!isOpen)}
        className={`cursor-pointer ${className}`}
      >
        {children}
      </div>
      
      {isOpen && createPortal(
        <div
          ref={popoverRef}
          className="fixed bg-white rounded-lg shadow-lg border border-gray-200 p-4 z-[10000]"
          style={{
            top: `${position.top}px`,
            left: `${position.left}px`,
            width: '280px',
          }}
        >
          <div className="flex items-start gap-2">
            <span className="text-lg">⚠️</span>
            <p className="text-sm text-gray-700">{message}</p>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};


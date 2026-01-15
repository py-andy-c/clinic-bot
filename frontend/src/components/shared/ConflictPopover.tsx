import React from 'react';
import { createPortal } from 'react-dom';
import { ConflictDisplay } from './ConflictDisplay';
import { SchedulingConflictResponse } from '../../types';
import { usePopover } from '../../hooks/usePopover';

interface ConflictPopoverProps {
  conflictInfo: SchedulingConflictResponse | null;
  children: React.ReactNode;
  className?: string;
  filterTypes?: string[] | undefined;
}

/**
 * ConflictPopover Component
 * 
 * Displays a popover with conflict details when clicking the trigger element.
 * Uses a portal to render outside modal boundaries and positions itself
 * to avoid screen borders.
 */
export const ConflictPopover: React.FC<ConflictPopoverProps> = ({
  conflictInfo,
  children,
  className = '',
  filterTypes,
}) => {
  const { isOpen, setIsOpen, position, popoverRef, triggerRef } = usePopover({
    popoverWidth: 320, // w-80 = 320px
  });

  if (!conflictInfo || !conflictInfo.has_conflict) {
    return <>{children}</>;
  }

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
          className="fixed w-80 bg-white rounded-lg shadow-lg border border-gray-200 p-4"
          style={{
            top: `${position.top}px`,
            left: `${position.left}px`,
            zIndex: 10000, // Above all layers including modals
          }}
        >
          <ConflictDisplay conflictInfo={conflictInfo} filterTypes={filterTypes} />
        </div>,
        document.body
      )}
    </>
  );
};


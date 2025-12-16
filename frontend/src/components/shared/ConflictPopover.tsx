import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ConflictDisplay } from './ConflictDisplay';
import { SchedulingConflictResponse } from '../../types';

interface ConflictPopoverProps {
  conflictInfo: SchedulingConflictResponse | null;
  children: React.ReactNode;
  className?: string;
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
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  // Calculate popover position when opened
  useEffect(() => {
    if (!isOpen || !triggerRef.current) {
      return;
    }
    
    const updatePosition = () => {
      if (!triggerRef.current || !popoverRef.current) return;
      
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const popoverWidth = 320; // w-80 = 320px
      const popoverHeight = popoverRef.current.offsetHeight || 200;
      const padding = 16; // Padding from screen border
      const gap = 8; // Gap between trigger and popover
      
      // Calculate preferred position (below trigger, centered)
      let left = triggerRect.left + triggerRect.width / 2 - popoverWidth / 2;
      let top = triggerRect.bottom + gap;
      
      // Keep popover within viewport bounds
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      // Adjust horizontal position if it would go off-screen
      if (left < padding) {
        left = padding;
      } else if (left + popoverWidth > viewportWidth - padding) {
        left = viewportWidth - popoverWidth - padding;
      }
      
      // Adjust vertical position if it would go off-screen (prefer above if below doesn't fit)
      if (top + popoverHeight > viewportHeight - padding) {
        // Try above the trigger
        const topAbove = triggerRect.top - popoverHeight - gap;
        if (topAbove >= padding) {
          top = topAbove;
        } else {
          // If neither above nor below fits, position at bottom of viewport with padding
          top = Math.max(padding, viewportHeight - popoverHeight - padding);
        }
      }
      
      setPosition({ top, left });
    };
    
    // Initial position calculation
    updatePosition();
    
    // Recalculate after popover is rendered (in case height changes)
    const timeoutId = setTimeout(updatePosition, 0);
    
    // Also recalculate on window resize
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        popoverRef.current &&
        triggerRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  if (!conflictInfo || !conflictInfo.has_conflict) {
    return <>{children}</>;
  }

  return (
    <>
      <div
        ref={triggerRef}
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
          <ConflictDisplay conflictInfo={conflictInfo} />
        </div>,
        document.body
      )}
    </>
  );
};


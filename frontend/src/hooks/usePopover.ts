import { useState, useRef, useEffect } from 'react';

interface UsePopoverOptions {
  popoverWidth?: number;
  padding?: number;
  gap?: number;
}

interface UsePopoverReturn {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  position: { top: number; left: number };
  popoverRef: React.RefObject<HTMLDivElement>;
  triggerRef: React.RefObject<HTMLElement>;
}

/**
 * Custom hook for popover behavior
 * 
 * Handles:
 * - Opening/closing state
 * - Position calculation (keeps popover within viewport)
 * - Click-outside detection to close popover
 * - Window resize/scroll handling
 */
export const usePopover = (options: UsePopoverOptions = {}): UsePopoverReturn => {
  const {
    popoverWidth = 320,
    padding = 16,
    gap = 8,
  } = options;

  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement>(null);

  // Calculate popover position when opened
  useEffect(() => {
    if (!isOpen || !triggerRef.current) {
      return;
    }
    
    const updatePosition = () => {
      if (!triggerRef.current || !popoverRef.current) return;
      
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const popoverHeight = popoverRef.current.offsetHeight || 200;
      
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
  }, [isOpen, popoverWidth, padding, gap]);

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      // Use event.composedPath() for more robust click-outside detection, especially with shadow DOM
      const path = event.composedPath();
      if (
        isOpen &&
        popoverRef.current &&
        triggerRef.current &&
        !path.includes(popoverRef.current) &&
        !path.includes(triggerRef.current)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      // Use capture phase to catch events before they bubble
      document.addEventListener('mousedown', handleClickOutside, true);
      document.addEventListener('touchstart', handleClickOutside, true);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('touchstart', handleClickOutside, true);
    };
  }, [isOpen]);

  return {
    isOpen,
    setIsOpen,
    position,
    popoverRef,
    triggerRef,
  };
};


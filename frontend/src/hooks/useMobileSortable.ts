import { useState, useRef, useEffect } from 'react';

interface UseMobileSortableProps {
  onDragStart?: ((e: React.DragEvent | React.TouchEvent, id: number) => void) | undefined;
  onMove?: ((draggedId: number, targetId: number) => void) | undefined;
  onDragEnd?: (() => void) | undefined;
  dataAttribute: string; // e.g., 'data-group-id' or 'data-item-id'
  isDragEnabled: boolean;
  delay?: number; // debounce delay, default 150ms
}

export const useMobileSortable = ({
  onDragStart,
  onMove,
  onDragEnd,
  dataAttribute,
  isDragEnabled,
  delay = 150
}: UseMobileSortableProps) => {
  const touchStartYRef = useRef<number | null>(null);
  const touchStartIdRef = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState<{ y: number } | null>(null);
  const lastSwapTimeRef = useRef<number>(0);

  // Keep refs in sync with callbacks to avoid stale closures in event handlers
  const onMoveRef = useRef(onMove);
  const onDragEndRef = useRef(onDragEnd);

  useEffect(() => {
    onMoveRef.current = onMove;
    onDragEndRef.current = onDragEnd;
  }, [onMove, onDragEnd]);

  useEffect(() => {
    return () => {
      touchStartYRef.current = null;
      touchStartIdRef.current = null;
      setDragOffset(null);
    };
  }, []);

  const handleTouchStart = (e: React.TouchEvent, id: number) => {
    if (!isDragEnabled || !onDragStart) return;

    e.stopPropagation();
    const touch = e.touches[0];
    if (!touch) return;

    touchStartYRef.current = touch.clientY;
    touchStartIdRef.current = id;
    setDragOffset({ y: 0 });

    // Create synthetic drag event
    const syntheticEvent = {
      ...e,
      dataTransfer: {
        effectAllowed: 'move',
        setDragImage: () => { },
        setData: () => { }, // Mock setData to prevent crash
      },
    } as unknown as React.DragEvent;

    onDragStart(syntheticEvent, id);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartIdRef.current || !onMoveRef.current) return;

    const touch = e.touches[0];
    if (!touch) return;

    if (e.cancelable) {
      e.preventDefault();
    }

    const currentY = touch.clientY;
    const startY = touchStartYRef.current || 0;
    const deltaY = currentY - startY;

    setDragOffset({ y: deltaY });

    const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    const itemElement = elementBelow?.closest(`[${dataAttribute}]`) as HTMLElement;

    if (itemElement) {
      const targetId = parseInt(itemElement.getAttribute(dataAttribute) || '0', 10);

      const now = Date.now();
      if (now - lastSwapTimeRef.current < delay) {
        return;
      }

      if (targetId && targetId !== touchStartIdRef.current) {
        onMoveRef.current(touchStartIdRef.current, targetId);
        // Update start position for next movement to avoid jumping
        touchStartYRef.current = currentY;
        lastSwapTimeRef.current = now;
      }
    }
  };

  const handleTouchEnd = (_e: React.TouchEvent) => {
    if (!touchStartIdRef.current) return;

    // Clean up
    touchStartYRef.current = null;
    touchStartIdRef.current = null;
    setDragOffset(null);

    if (onDragEndRef.current) {
      onDragEndRef.current();
    }
  };

  return {
    dragOffset,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd
  };
};

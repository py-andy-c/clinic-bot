import React, { useRef, useState, useEffect, useMemo } from 'react';
import { AppointmentType, ServiceTypeGroup } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';

// Constants
const DRAG_OPACITY = 0.6;
const DRAG_BORDER_WIDTH = 4;
const ICON_SIZE = 5;
const GAP_SIZE = 3;
const BUTTON_SIZE = 5;
const DROP_INDICATOR_COLOR = 'blue-400';

interface ServiceItemsTableProps {
  appointmentTypes: AppointmentType[];
  groups: ServiceTypeGroup[];
  practitionerAssignments: Record<number, number[]>;
  onEdit: (item: AppointmentType) => void;
  onDelete: (item: AppointmentType) => void;
  isClinicAdmin: boolean;
  resultCountText?: string;
  draggedItemId?: number | null;
  onDragStart?: (e: React.DragEvent, itemId: number) => void;
  onMove?: (draggedId: number, targetId: number) => void;
  onDragEnd?: () => void;
  disabled?: boolean;
}

export const ServiceItemsTable: React.FC<ServiceItemsTableProps> = ({
  appointmentTypes,
  groups,
  practitionerAssignments,
  onEdit,
  onDelete,
  isClinicAdmin,
  resultCountText,
  draggedItemId = null,
  onDragStart,
  onMove,
  onDragEnd,
  disabled = false,
}) => {
  const isMobile = useIsMobile();
  const touchStartYRef = useRef<number | null>(null);
  const touchStartItemIdRef = useRef<number | null>(null);
  const touchStartElementRef = useRef<HTMLElement | null>(null);
  const [dragOffset, setDragOffset] = useState<{ y: number } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [dropPosition, setDropPosition] = useState<'above' | 'below' | null>(null);
  const onMoveRef = useRef(onMove);
  const onDragEndRef = useRef(onDragEnd);

  // Keep refs in sync with props
  useEffect(() => {
    onMoveRef.current = onMove;
    onDragEndRef.current = onDragEnd;
  }, [onMove, onDragEnd]);

  // Cleanup on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      // Clean up all touch-related state
      touchStartYRef.current = null;
      touchStartItemIdRef.current = null;
      touchStartElementRef.current = null;
      setDragOffset(null);
    };
  }, []);

  // Memoized group ID-to-name mapping for O(1) lookup performance
  const groupIdToNameMap = useMemo(() => {
    const map = new Map<number, string>();
    groups.forEach((group) => {
      if (group.id) map.set(group.id, group.name);
    });
    return map;
  }, [groups]);

  const getGroupName = (groupId: number | null | undefined): string => {
    if (!groupId) return '未分類';
    // Use memoized map for O(1) lookup instead of O(n) find
    return groupIdToNameMap.get(groupId) || '未分類';
  };

  const formatDuration = (duration: number, buffer?: number): string => {
    if (buffer && buffer > 0) {
      return `${duration} (+${buffer}) 分`;
    }
    return `${duration} 分`;
  };

  const handleDragOver = (e: React.DragEvent, targetItemId: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (!draggedItemId || !onMove || draggedItemId === targetItemId) return;

    const dragIndex = appointmentTypes.findIndex((i: AppointmentType) => i.id === draggedItemId);
    const hoverIndex = appointmentTypes.findIndex((i: AppointmentType) => i.id === targetItemId);

    if (dragIndex === -1 || hoverIndex === -1) return;
    if (dragIndex === hoverIndex) return;

    const hoverBoundingRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
    const clientOffset = e.clientY - hoverBoundingRect.top;

    // Set visual drop indicators
    setDropTargetId(targetItemId);
    setDropPosition(clientOffset < hoverMiddleY ? 'above' : 'below');

    // Dragging downwards
    if (dragIndex < hoverIndex && clientOffset < hoverMiddleY) return;

    // Dragging upwards
    if (dragIndex > hoverIndex && clientOffset > hoverMiddleY) return;

    onMove(draggedItemId, targetItemId);
  };

  const handleDragLeave = () => {
    // Clear drop indicators when leaving a drop target
    setDropTargetId(null);
    setDropPosition(null);
  };

  // Touch event handler for starting drag on mobile
  const handleTouchStart = (e: React.TouchEvent, itemId: number) => {
    if (!isClinicAdmin || !onDragStart) return;

    e.stopPropagation();

    const touch = e.touches[0];
    if (!touch) return;

    touchStartYRef.current = touch.clientY;
    touchStartItemIdRef.current = itemId;

    // Store the element being dragged for visual feedback
    const target = e.currentTarget.closest('[data-item-id]') as HTMLElement;
    if (target) {
      touchStartElementRef.current = target;
    }

    setDragOffset({ y: 0 });

    // Create a synthetic drag event to trigger drag start
    const syntheticEvent = {
      ...e,
      dataTransfer: {
        effectAllowed: 'move',
      },
    } as unknown as React.DragEvent;

    onDragStart(syntheticEvent, itemId);
  };

  // Touch event handler for moving drag on mobile
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartItemIdRef.current || !onMoveRef.current) return;

    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;

    const currentY = touch.clientY;
    const startY = touchStartYRef.current || 0;
    const deltaY = currentY - startY;

    setDragOffset({ y: deltaY });

    // Find the element under the touch point
    const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    const itemElement = elementBelow?.closest('[data-item-id]') as HTMLElement;
    
    if (itemElement) {
      const targetItemId = parseInt(itemElement.getAttribute('data-item-id') || '0', 10);
      if (targetItemId && targetItemId !== touchStartItemIdRef.current) {
        onMoveRef.current(touchStartItemIdRef.current, targetItemId);
        // Update start position for next movement
        touchStartYRef.current = currentY;
      }
    }
  };

  // Touch event handler for ending drag on mobile
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartItemIdRef.current) return;

    e.preventDefault();

    // Clean up all touch-related state
    touchStartYRef.current = null;
    touchStartItemIdRef.current = null;
    touchStartElementRef.current = null;
    setDragOffset(null);

    if (onDragEndRef.current) {
      onDragEndRef.current();
    }
  };

  if (isMobile) {
    // Mobile: Card list view
    return (
      <div className="space-y-3">
        {appointmentTypes.map((appointmentType: AppointmentType) => {
          const groupName = getGroupName(appointmentType.service_type_group_id);
          const practitionerCount = practitionerAssignments[appointmentType.id]?.length || 0;

          return (
            <div
              key={appointmentType.id}
              data-item-id={appointmentType.id}
              draggable={isClinicAdmin && !isMobile && !disabled}
              onDragStart={isClinicAdmin && !isMobile && onDragStart ? (e) => {
                // Hide the default drag ghost
                const img = new Image();
                img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                e.dataTransfer.setDragImage(img, 0, 0);

                onDragStart(e, appointmentType.id);
              } : undefined}
              onDragOver={isClinicAdmin && !isMobile ? (e) => handleDragOver(e, appointmentType.id) : undefined}
              onDragLeave={isClinicAdmin && !isMobile ? handleDragLeave : undefined}
              onDragEnd={isClinicAdmin && !isMobile ? () => {
                // Clear drop indicators
                setDropTargetId(null);
                setDropPosition(null);
                if (onDragEnd) onDragEnd();
              } : undefined}
              onClick={isClinicAdmin ? () => onEdit(appointmentType) : undefined}
              onTouchMove={isMobile && isClinicAdmin && !disabled ? handleTouchMove : undefined}
              onTouchEnd={isMobile && isClinicAdmin && !disabled ? handleTouchEnd : undefined}
              className={`bg-white border border-gray-200 rounded-lg p-4 shadow-sm transition-all duration-200 ${draggedItemId === appointmentType.id
                ? `bg-blue-50 border-2 border-dashed border-blue-300 shadow-inner`
                : dropTargetId === appointmentType.id
                  ? dropPosition === 'above'
                    ? `border-t-${DRAG_BORDER_WIDTH} border-t-${DROP_INDICATOR_COLOR}`
                    : `border-b-${DRAG_BORDER_WIDTH} border-b-${DROP_INDICATOR_COLOR}`
                  : 'hover:shadow-md'
                }`}
              style={{
                ...(isMobile && draggedItemId === appointmentType.id && dragOffset
                  ? { transform: `translateY(${dragOffset.y}px)`, zIndex: 1000, position: 'relative' as const }
                  : {}),
                ...(draggedItemId === appointmentType.id ? { opacity: DRAG_OPACITY } : {})
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {isClinicAdmin && (
                      <div
                        className="text-gray-400 touch-none select-none flex items-center"
                        onTouchStart={isMobile && !disabled ? (e) => handleTouchStart(e, appointmentType.id) : undefined}
                        style={{ touchAction: 'none' }}
                      >
                        <svg className={`w-${ICON_SIZE} h-${ICON_SIZE}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                        </svg>
                      </div>
                    )}
                    <h3 className="font-medium text-gray-900 text-sm">
                      {appointmentType.name || '未命名服務項目'}
                    </h3>
                    {appointmentType.service_type_group_id && (
                      <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                        {groupName}
                      </span>
                    )}
                  </div>
                  <div className={`flex flex-wrap gap-${GAP_SIZE} text-xs text-gray-500`}>
                    <span>時長: {formatDuration(appointmentType.duration_minutes, appointmentType.scheduling_buffer_minutes)}</span>
                    <span>•</span>
                    <span>{practitionerCount} 位治療師</span>
                  </div>
                </div>
                {isClinicAdmin && (
                  <button
                    disabled={disabled}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(appointmentType);
                    }}
                    className="p-2 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                  >
                    <svg className={`w-${BUTTON_SIZE} h-${BUTTON_SIZE}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Desktop: Table view
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              {resultCountText || '服務項目'}
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              群組
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              時長 (緩衝)
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              治療師
            </th>
            {isClinicAdmin && (
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                操作
              </th>
            )}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {appointmentTypes.map((appointmentType) => {
            const groupName = getGroupName(appointmentType.service_type_group_id);
            const practitionerCount = practitionerAssignments[appointmentType.id]?.length || 0;

            return (
              <tr
                key={appointmentType.id}
                data-item-id={appointmentType.id}
                draggable={isClinicAdmin && !isMobile && !disabled}
                onDragStart={isClinicAdmin && !isMobile && onDragStart ? (e) => {
                  // Hide the default drag ghost
                  const img = new Image();
                  img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                  e.dataTransfer.setDragImage(img, 0, 0);

                  onDragStart(e, appointmentType.id);
                } : undefined}
                onDragOver={isClinicAdmin && !isMobile ? (e) => handleDragOver(e, appointmentType.id) : undefined}
                onDragLeave={isClinicAdmin && !isMobile ? handleDragLeave : undefined}
                onDragEnd={isClinicAdmin && !isMobile ? () => {
                  // Clear drop indicators
                  setDropTargetId(null);
                  setDropPosition(null);
                  if (onDragEnd) onDragEnd();
                } : undefined}
                onClick={isClinicAdmin && !disabled ? () => onEdit(appointmentType) : undefined}
                className={`transition-all duration-200 ${draggedItemId === appointmentType.id
                  ? 'opacity-60 bg-blue-50 ring-2 ring-blue-300 ring-inset'
                  : dropTargetId === appointmentType.id
                    ? dropPosition === 'above'
                      ? 'border-t-4 border-t-blue-400'
                      : 'border-b-4 border-b-blue-400'
                    : 'hover:bg-gray-50'
                  } ${isClinicAdmin && !isMobile ? 'cursor-move' : ''}`}
              >
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    {isClinicAdmin && (
                      <div className="w-6 flex-shrink-0 flex items-center">
                        <div
                          className="text-gray-400 touch-none select-none"
                          onTouchStart={isMobile && !disabled ? (e) => handleTouchStart(e, appointmentType.id) : undefined}
                          style={{ touchAction: 'none' }}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                          </svg>
                        </div>
                      </div>
                    )}
                    <span className="text-sm font-medium text-gray-900">
                      {appointmentType.name || '未命名服務項目'}
                    </span>
                    {appointmentType.allow_patient_booking === false && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                        不開放預約
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {appointmentType.service_type_group_id ? (
                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                      {groupName}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-500">未分類</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {formatDuration(appointmentType.duration_minutes, appointmentType.scheduling_buffer_minutes)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {practitionerCount} 位
                </td>
                {isClinicAdmin && (
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      disabled={disabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onDelete) onDelete(appointmentType);
                      }}
                      className="text-red-600 hover:text-red-900 px-3 py-1 rounded-md hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      刪除
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};


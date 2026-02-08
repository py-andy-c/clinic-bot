import React, { useState, useMemo } from 'react';
import { AppointmentType, ServiceTypeGroup } from '../types';
import { ActionableCard } from './shared';
import { useIsMobile } from '../hooks/useIsMobile';
import { useMobileSortable } from '../hooks/useMobileSortable';

// Constants
const DRAG_OPACITY = 0.6;
const DRAG_BORDER_WIDTH = 4;
const ICON_SIZE = 5;
const DROP_INDICATOR_COLOR = 'blue-400';

// Preload empty image for drag ghost
const EMPTY_DRAG_IMAGE = new Image();
EMPTY_DRAG_IMAGE.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

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
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [dropPosition, setDropPosition] = useState<'above' | 'below' | null>(null);

  const {
    dragOffset,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd
  } = useMobileSortable({
    onDragStart: onDragStart as ((e: React.DragEvent | React.TouchEvent, id: number) => void) | undefined,
    onMove,
    onDragEnd,
    dataAttribute: 'data-item-id',
    isDragEnabled: isClinicAdmin && !disabled
  });

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
  // Delegated to useMobileSortable hook


  if (isMobile) {
    // Mobile: Card list view
    return (
      <div className="space-y-3">
        {appointmentTypes.map((appointmentType: AppointmentType) => {
          const groupName = getGroupName(appointmentType.service_type_group_id);
          const practitionerCount = practitionerAssignments[appointmentType.id]?.length || 0;

          return (
            <ActionableCard
              key={appointmentType.id}
              title={appointmentType.name || '未命名服務項目'}
              badge={appointmentType.service_type_group_id ? (
                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded ml-1">
                  {groupName}
                </span>
              ) : null}
              leading={isClinicAdmin && (
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
              actions={isClinicAdmin ? [
                {
                  label: '編輯',
                  onClick: (e: React.MouseEvent) => {
                    e.stopPropagation();
                    onEdit(appointmentType);
                  },
                  variant: 'secondary'
                },
                {
                  label: '刪除',
                  onClick: (e: React.MouseEvent) => {
                    e.stopPropagation();
                    onDelete(appointmentType);
                  },
                  variant: 'danger',
                  disabled: disabled
                }
              ] : []}
              metadata={[
                {
                  icon: (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ),
                  label: `時長: ${formatDuration(appointmentType.duration_minutes, appointmentType.scheduling_buffer_minutes)}`
                },
                {
                  icon: (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  ),
                  label: `${practitionerCount} 位治療師`
                }
              ]}
              className={`${draggedItemId === appointmentType.id
                ? `bg-blue-50 border-2 border-dashed border-blue-300 shadow-inner`
                : dropTargetId === appointmentType.id
                  ? dropPosition === 'above'
                    ? `border-t-${DRAG_BORDER_WIDTH} border-t-${DROP_INDICATOR_COLOR}`
                    : `border-b-${DRAG_BORDER_WIDTH} border-b-${DROP_INDICATOR_COLOR}`
                  : ''
                }`}
              style={{
                ...(isMobile && draggedItemId === appointmentType.id && dragOffset
                  ? { transform: `translateY(${dragOffset.y}px)`, zIndex: 1000, position: 'relative' as const, touchAction: 'none' }
                  : {}),
                ...(draggedItemId === appointmentType.id ? { opacity: DRAG_OPACITY } : {})
              }}
              data-item-id={appointmentType.id}
              draggable={isClinicAdmin && !isMobile && !disabled}
              onDragStart={isClinicAdmin && !isMobile && onDragStart ? (e) => {
                // Hide the default drag ghost
                e.dataTransfer.setDragImage(EMPTY_DRAG_IMAGE, 0, 0);

                // Set custom data type to prevent browser from showing default "globe" or "link" icons
                e.dataTransfer.setData('application/x-clinic-dnd', appointmentType.id.toString());
                e.dataTransfer.effectAllowed = 'move';

                onDragStart(e, appointmentType.id);
              } : undefined}
              onDragOver={isClinicAdmin && !isMobile ? (e) => handleDragOver(e, appointmentType.id) : undefined}
              onDragLeave={isClinicAdmin && !isMobile ? handleDragLeave : undefined}
              onDragEnd={isClinicAdmin && !isMobile ? () => {
                setDropTargetId(null);
                setDropPosition(null);
                if (onDragEnd) onDragEnd();
              } : undefined}
              {...(isMobile && isClinicAdmin && !disabled ? {
                onTouchMove: handleTouchMove,
                onTouchEnd: handleTouchEnd
              } : {})}
            />
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
          {appointmentTypes.map((appointmentType: AppointmentType) => {
            const groupName = getGroupName(appointmentType.service_type_group_id);
            const practitionerCount = practitionerAssignments[appointmentType.id]?.length || 0;

            return (
              <tr
                key={appointmentType.id}
                data-item-id={appointmentType.id}
                draggable={isClinicAdmin && !isMobile && !disabled}
                onDragStart={isClinicAdmin && !isMobile && onDragStart ? (e) => {
                  // Hide the default drag ghost
                  e.dataTransfer.setDragImage(EMPTY_DRAG_IMAGE, 0, 0);

                  // Set custom data type to prevent browser from showing default "globe" or "link" icons
                  // We use a custom MIME type that is not text/plain or text/uri-list
                  e.dataTransfer.setData('application/x-clinic-dnd', appointmentType.id.toString());
                  e.dataTransfer.effectAllowed = 'move';

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


import React, { useState, useRef, useEffect } from 'react';
import { AppointmentType, ServiceTypeGroup } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';

interface ServiceItemsTableProps {
  appointmentTypes: AppointmentType[];
  groups: ServiceTypeGroup[];
  practitionerAssignments: Record<number, number[]>; // appointmentTypeId -> practitionerIds[]
  onEdit: (appointmentType: AppointmentType) => void;
  isClinicAdmin: boolean;
  resultCountText?: string; // Optional text to display in first column header
  draggedItemId?: number | null;
  onDragStart?: (e: React.DragEvent, itemId: number) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, targetItemId: number, position?: 'above' | 'below') => void;
  onDragEnd?: () => void;
}

export const ServiceItemsTable: React.FC<ServiceItemsTableProps> = ({
  appointmentTypes,
  groups,
  practitionerAssignments,
  onEdit,
  isClinicAdmin,
  resultCountText,
  draggedItemId = null,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}) => {
  const isMobile = useIsMobile();
  const [dropIndicator, setDropIndicator] = useState<{ itemId: number; position: 'above' | 'below' } | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const touchStartItemIdRef = useRef<number | null>(null);
  const touchStartElementRef = useRef<HTMLElement | null>(null);
  const [dragOffset, setDragOffset] = useState<{ y: number } | null>(null);
  const onDropRef = useRef(onDrop);
  const onDragEndRef = useRef(onDragEnd);

  // Keep refs in sync with props
  useEffect(() => {
    onDropRef.current = onDrop;
    onDragEndRef.current = onDragEnd;
  }, [onDrop, onDragEnd]);

  // Global touch move handler for mobile drag-and-drop
  useEffect(() => {
    if (!isMobile || !isClinicAdmin) return;

    const handleGlobalTouchMove = (e: TouchEvent) => {
      if (!touchStartItemIdRef.current || !touchStartYRef.current) return;

      const touch = e.touches[0];
      if (!touch) return;

      // Calculate drag offset for visual feedback
      const offsetY = touch.clientY - touchStartYRef.current;
      setDragOffset({ y: offsetY });

      // Find the element under the touch point
      const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
      if (!elementBelow) {
        setDropIndicator(null);
        return;
      }

      // Find the closest row/card element
      const rowElement = elementBelow.closest('[data-item-id]') as HTMLElement;
      if (!rowElement) {
        setDropIndicator(null);
        return;
      }

      const targetItemId = parseInt(rowElement.dataset.itemId || '0', 10);
      if (!targetItemId || targetItemId === touchStartItemIdRef.current) {
        setDropIndicator(null);
        return;
      }

      // Get the row's bounding rect
      const rect = rowElement.getBoundingClientRect();
      const touchY = touch.clientY;
      const rowCenter = rect.top + rect.height / 2;
      
      // Determine if drop should be above or below based on touch position
      const position = touchY < rowCenter ? 'above' : 'below';
      setDropIndicator({ itemId: targetItemId, position });
    };

    const handleGlobalTouchEnd = (e: TouchEvent) => {
      if (!touchStartItemIdRef.current || !onDropRef.current || !isClinicAdmin) {
        touchStartYRef.current = null;
        touchStartItemIdRef.current = null;
        touchStartElementRef.current = null;
        setDragOffset(null);
        return;
      }

      const touch = e.changedTouches[0];
      if (!touch) {
        touchStartYRef.current = null;
        touchStartItemIdRef.current = null;
        touchStartElementRef.current = null;
        setDropIndicator(null);
        setDragOffset(null);
        if (onDragEndRef.current) onDragEndRef.current();
        return;
      }

      // Find the element under the touch point
      const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
      if (!elementBelow) {
        touchStartYRef.current = null;
        touchStartItemIdRef.current = null;
        touchStartElementRef.current = null;
        setDropIndicator(null);
        setDragOffset(null);
        if (onDragEndRef.current) onDragEndRef.current();
        return;
      }

      // Find the closest row/card element
      const rowElement = elementBelow.closest('[data-item-id]') as HTMLElement;
      if (!rowElement) {
        touchStartYRef.current = null;
        touchStartItemIdRef.current = null;
        touchStartElementRef.current = null;
        setDropIndicator(null);
        setDragOffset(null);
        if (onDragEndRef.current) onDragEndRef.current();
        return;
      }

      const targetItemId = parseInt(rowElement.dataset.itemId || '0', 10);
      if (targetItemId && targetItemId !== touchStartItemIdRef.current) {
        // Get current drop indicator state - read from state directly
        setDropIndicator((currentIndicator) => {
          const position = currentIndicator?.itemId === targetItemId ? currentIndicator.position : undefined;
          
          // Create a synthetic drop event
          const syntheticEvent = {
            preventDefault: () => {},
          } as unknown as React.DragEvent;
          
          if (onDropRef.current) {
            onDropRef.current(syntheticEvent, targetItemId, position);
          }
          
          return null; // Clear indicator
        });
        
        touchStartYRef.current = null;
        touchStartItemIdRef.current = null;
        touchStartElementRef.current = null;
        setDragOffset(null);
        if (onDragEndRef.current) onDragEndRef.current();
        return;
      }
      
      // No valid drop target
      setDropIndicator(null);
      setDragOffset(null);
      touchStartYRef.current = null;
      touchStartItemIdRef.current = null;
      touchStartElementRef.current = null;
      if (onDragEndRef.current) onDragEndRef.current();
    };

    document.addEventListener('touchmove', handleGlobalTouchMove, { passive: false });
    document.addEventListener('touchend', handleGlobalTouchEnd);

    return () => {
      document.removeEventListener('touchmove', handleGlobalTouchMove);
      document.removeEventListener('touchend', handleGlobalTouchEnd);
    };
  }, [isMobile, isClinicAdmin]);

  const getGroupName = (groupId: number | null | undefined): string => {
    if (!groupId) return '未分類';
    const group = groups.find(g => g.id === groupId);
    return group?.name || '未分類';
  };

  const formatDuration = (duration: number, buffer?: number): string => {
    if (buffer && buffer > 0) {
      return `${duration} (+${buffer}) 分`;
    }
    return `${duration} 分`;
  };

  const handleDragOver = (e: React.DragEvent, itemId: number) => {
    // Call parent's onDragOver if provided
    if (onDragOver) {
      onDragOver(e);
    }
    
    // Update drop indicator based on current mouse position
    if (!draggedItemId || draggedItemId === itemId) {
      setDropIndicator(null);
      return;
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mouseY = e.clientY;
    const rowCenter = rect.top + rect.height / 2;
    
    // Determine if drop should be above or below based on mouse position
    const position = mouseY < rowCenter ? 'above' : 'below';
    setDropIndicator({ itemId, position });
  };

  // Touch event handler for starting drag on mobile
  const handleTouchStart = (e: React.TouchEvent, itemId: number) => {
    if (!isClinicAdmin || !onDragStart) return;
    
    e.preventDefault();
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

  if (isMobile) {
    // Mobile: Card list view
    return (
      <div className="space-y-3">
        {appointmentTypes.map((appointmentType) => {
          const groupName = getGroupName(appointmentType.service_type_group_id);
          const practitionerCount = practitionerAssignments[appointmentType.id]?.length || 0;

          return (
            <React.Fragment key={appointmentType.id}>
              {/* Drop indicator line above */}
              {dropIndicator?.itemId === appointmentType.id && dropIndicator.position === 'above' && (
                <div className="h-1.5 bg-blue-600 shadow-md shadow-blue-500/30 mx-2 my-1 rounded-full" />
              )}
              
              <div
                data-item-id={appointmentType.id}
                draggable={isClinicAdmin && !isMobile}
                onDragStart={isClinicAdmin && !isMobile && onDragStart ? (e) => onDragStart(e, appointmentType.id) : undefined}
                onDragOver={isClinicAdmin && !isMobile ? (e) => handleDragOver(e, appointmentType.id) : undefined}
                onDrop={isClinicAdmin && !isMobile && onDrop ? (e) => {
                  const position = dropIndicator?.itemId === appointmentType.id ? dropIndicator.position : undefined;
                  setDropIndicator(null);
                  onDrop(e, appointmentType.id, position);
                } : undefined}
                onDragEnd={isClinicAdmin && !isMobile ? () => {
                  setDropIndicator(null);
                  if (onDragEnd) onDragEnd();
                } : undefined}
                onClick={isClinicAdmin ? () => onEdit(appointmentType) : undefined}
                className={`bg-white border border-gray-200 rounded-lg p-4 shadow-sm transition-transform ${
                  draggedItemId === appointmentType.id ? 'opacity-30' : ''
                } ${isClinicAdmin ? 'hover:shadow-md transition-shadow' : ''}`}
                style={
                  isMobile && draggedItemId === appointmentType.id && dragOffset
                    ? { transform: `translateY(${dragOffset.y}px)`, zIndex: 1000, position: 'relative' as const }
                    : undefined
                }
              >
              <div className="flex items-center justify-between mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {isClinicAdmin && (
                      <div
                        className="text-gray-400 touch-none select-none flex items-center"
                        onTouchStart={isMobile ? (e) => handleTouchStart(e, appointmentType.id) : undefined}
                        style={{ touchAction: 'none' }}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                    {appointmentType.allow_patient_booking === false && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                        不開放預約
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                    <span>時長: {formatDuration(appointmentType.duration_minutes, appointmentType.scheduling_buffer_minutes)}</span>
                    <span>•</span>
                    <span>{practitionerCount} 位治療師</span>
                  </div>
                </div>
              </div>
              </div>
              
              {/* Drop indicator line below */}
              {dropIndicator?.itemId === appointmentType.id && dropIndicator.position === 'below' && (
                <div className="h-1.5 bg-blue-600 shadow-md shadow-blue-500/30 mx-2 my-1 rounded-full" />
              )}
            </React.Fragment>
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
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {appointmentTypes.map((appointmentType) => {
            const groupName = getGroupName(appointmentType.service_type_group_id);
            const practitionerCount = practitionerAssignments[appointmentType.id]?.length || 0;

            return (
              <React.Fragment key={appointmentType.id}>
                {/* Drop indicator line above */}
                {dropIndicator?.itemId === appointmentType.id && dropIndicator.position === 'above' && (
                  <tr>
                    <td colSpan={4} className="px-0 py-0">
                      <div className="h-1.5 bg-blue-600 shadow-md shadow-blue-500/30 w-full" />
                    </td>
                  </tr>
                )}
                
                <tr
                  data-item-id={appointmentType.id}
                  draggable={isClinicAdmin && !isMobile}
                  onDragStart={isClinicAdmin && !isMobile && onDragStart ? (e) => onDragStart(e, appointmentType.id) : undefined}
                  onDragOver={isClinicAdmin && !isMobile ? (e) => handleDragOver(e, appointmentType.id) : undefined}
                  onDrop={isClinicAdmin && !isMobile && onDrop ? (e) => {
                    const position = dropIndicator?.itemId === appointmentType.id ? dropIndicator.position : undefined;
                    setDropIndicator(null);
                    onDrop(e, appointmentType.id, position);
                  } : undefined}
                  onDragEnd={isClinicAdmin && !isMobile ? () => {
                    setDropIndicator(null);
                    if (onDragEnd) onDragEnd();
                  } : undefined}
                  onClick={isClinicAdmin ? () => onEdit(appointmentType) : undefined}
                  className={`hover:bg-gray-50 transition-colors transition-transform ${
                    draggedItemId === appointmentType.id ? 'opacity-30' : ''
                  } ${isClinicAdmin && !isMobile ? 'cursor-move' : ''}`}
                  style={
                    isMobile && draggedItemId === appointmentType.id && dragOffset
                      ? { transform: `translateY(${dragOffset.y}px)`, zIndex: 1000, position: 'relative' as const }
                      : undefined
                  }
                >
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    {isClinicAdmin && (
                      <div className="w-6 flex-shrink-0 flex items-center">
                        <div
                          className="text-gray-400 touch-none select-none"
                          onTouchStart={isMobile ? (e) => handleTouchStart(e, appointmentType.id) : undefined}
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
              </tr>
              
              {/* Drop indicator line below */}
              {dropIndicator?.itemId === appointmentType.id && dropIndicator.position === 'below' && (
                <tr>
                  <td colSpan={4} className="px-0 py-0">
                    <div className="h-1.5 bg-blue-600 shadow-md shadow-blue-500/30 w-full" />
                  </td>
                </tr>
              )}
            </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};


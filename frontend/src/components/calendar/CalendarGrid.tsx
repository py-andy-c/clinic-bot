import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import moment from 'moment-timezone';
import { CalendarEvent } from '../../utils/calendarDataAdapter';
import { CalendarView, CalendarViews } from '../../types/calendar';
import { getPractitionerColor } from '../../utils/practitionerColors';
import { getResourceColorById } from '../../utils/resourceColorUtils';
import {
  generateTimeSlots,
  calculateCurrentTimeIndicatorPosition,
  createTimeSlotDate,
  calculateEventPosition,
  calculateEventHeight,
  calculateOverlappingEvents,
  calculateEventInGroupPosition,
  getCurrentTaiwanTime,
  CALENDAR_GRID_CONFIG,
  OverlappingEventGroup,
} from '../../utils/calendarGridUtils';
import { CalendarPractitionerAvailability, isTimeSlotAvailable } from '../../utils/practitionerAvailability';
import { formatAppointmentTimeRange } from '../../utils/calendarUtils';
import { calculateEventDisplayText, buildEventTooltipText } from '../../utils/calendarEventDisplay';
import { EMPTY_ARRAY, EMPTY_OBJECT, CALENDAR_GRID_TIME_COLUMN_WIDTH } from '../../utils/constants';
import styles from './CalendarGrid.module.css';

interface DragPreview {
  start: Date;
  end: Date;
  practitionerId?: number | undefined;
  resourceId?: number | undefined;
  date?: string | undefined;
  isAvailable?: boolean | undefined;
}

interface CalendarGridProps {
  view: CalendarView;
  currentDate: Date;
  events: CalendarEvent[];
  selectedPractitioners: number[];
  selectedResources: number[];
  practitioners?: Array<{ id: number; full_name: string }>;
  resources?: Array<{ id: number; name: string }>;
  practitionerAvailability?: CalendarPractitionerAvailability;
  currentUserId?: number | null | undefined;
  onEventClick?: (event: CalendarEvent) => void;
  onSlotClick?: (slotInfo: { start: Date; end: Date; practitionerId?: number | undefined }) => void;
  onSlotExceptionClick?: (slotInfo: { start: Date; end: Date; practitionerId?: number | undefined }) => void;
  onHeaderClick?: (date: Date) => void;
  showHeaderRow?: boolean;
  canEditEvent?: (event: CalendarEvent) => boolean;
  onEventReschedule?: (event: CalendarEvent, newInfo: { start: Date; end: Date; practitionerId?: number | undefined }) => void;
  onExceptionMove?: (event: CalendarEvent, newInfo: { start: Date; end: Date; practitionerId?: number | undefined }) => void;
}


// Utility to convert hex to rgba for backgrounds

const CalendarGrid: React.FC<CalendarGridProps> = ({
  view,
  currentDate,
  events,
  selectedPractitioners,
  selectedResources,
  practitioners = EMPTY_ARRAY,
  resources = EMPTY_ARRAY,
  practitionerAvailability = EMPTY_OBJECT,
  currentUserId,
  onEventClick,
  onSlotClick,
  onSlotExceptionClick,
  onHeaderClick,
  canEditEvent,
  onEventReschedule,
  onExceptionMove,
}) => {
  const handleEventClick = useCallback((event: CalendarEvent) => {
    if (wasDraggingRef.current) {
      wasDraggingRef.current = false;
      return;
    }
    onEventClick?.(event);
  }, [onEventClick]);

  const [slotMenu, setSlotMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    anchorX: number;
    anchorY: number;
    anchorTop: number;
    slotInfo: { start: Date; end: Date; practitionerId?: number } | null;
  }>({ visible: false, x: 0, y: 0, anchorX: 0, anchorY: 0, anchorTop: 0, slotInfo: null });

  const slotMenuRef = useRef<HTMLDivElement | null>(null);
  const [viewportEl, setViewportEl] = useState<HTMLElement | null>(null);

  const [dragState, setDragState] = useState<{
    event: CalendarEvent | null;
    isDragging: boolean;
    x: number;
    y: number;
    preview: DragPreview | null | undefined;
    isTouch: boolean;
    dragOffset: { x: number; y: number };
    dragInitialSize: { width: number; height: number };
    columnWidth?: number;
  }>({
    event: null,
    isDragging: false,
    x: 0,
    y: 0,
    preview: null,
    isTouch: false,
    dragOffset: { x: 0, y: 0 },
    dragInitialSize: { width: 0, height: 0 },
  });

  const gridRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const resourceGridRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<any>(null);
  const isLongPressActiveRef = useRef(false);
  const touchStartPosRef = useRef<{ x: number, y: number } | null>(null);
  const scrollVelocityRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const scrollRafRef = useRef<number | null>(null);
  const wasDraggingRef = useRef(false);

  const timeSlots = useMemo(() => generateTimeSlots(), []);
  const hasScrolledRef = useRef(false);

  const scrollToCurrentTimePosition = useCallback(() => {
    const viewportElement = document.querySelector('[data-testid="calendar-viewport"]') as HTMLElement;
    if (!viewportElement) return;

    const now = getCurrentTaiwanTime();
    const today = moment(currentDate).tz('Asia/Taipei').startOf('day');
    const isViewingToday = now.isSame(today, 'day');

    let targetHours: number;
    let targetMinutes: number;

    if (isViewingToday) {
      targetHours = now.hour();
      targetMinutes = now.minute();
    } else {
      targetHours = 8;
      targetMinutes = 0;
    }

    const minutesFromMidnight = (targetHours * 60) + targetMinutes;
    const pixelsFromTop = (minutesFromMidnight / CALENDAR_GRID_CONFIG.SLOT_DURATION_MINUTES) * CALENDAR_GRID_CONFIG.SLOT_HEIGHT_PX;

    const scrollPosition = isViewingToday
      ? Math.max(0, pixelsFromTop - CALENDAR_GRID_CONFIG.SCROLL_BUFFER_PX)
      : pixelsFromTop;

    if (typeof viewportElement.scrollTo === 'function') {
      viewportElement.scrollTo({
        top: scrollPosition,
        behavior: 'instant'
      });
    }
  }, [currentDate]);

  useEffect(() => {
    if (!hasScrolledRef.current && (view === CalendarViews.DAY || view === CalendarViews.WEEK)) {
      const timeoutId = setTimeout(() => {
        hasScrolledRef.current = true;
        scrollToCurrentTimePosition();
      }, 100);
      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [scrollToCurrentTimePosition, view]);

  useEffect(() => {
    const el = document.querySelector('[data-testid="calendar-viewport"]') as HTMLElement | null;
    if (el) setViewportEl(el);
  }, []);

  const currentTimeIndicatorStyle = useMemo(
    () => calculateCurrentTimeIndicatorPosition(currentDate, view),
    [currentDate, view]
  );

  const activeDragEventId = dragState.isDragging ? dragState.event?.id : undefined;

  const practitionerGroups = useMemo(() => {
    const sortedPractitioners = [...selectedPractitioners].sort((a, b) => {
      if (a === currentUserId) return -1;
      if (b === currentUserId) return 1;
      return 0;
    });

    return sortedPractitioners.map(practitionerId => {
      const practitionerEvents = events.filter(event =>
        event.resource.practitioner_id === practitionerId
      );
      return {
        practitionerId,
        events: practitionerEvents,
        groups: calculateOverlappingEvents(practitionerEvents)
      };
    });
  }, [selectedPractitioners, events, currentUserId]);

  const resourceGroups = useMemo(() =>
    selectedResources.map(resourceId => {
      const resourceEvents = events.filter(event =>
        event.resource.resource_id === resourceId
      );
      return {
        resourceId,
        events: resourceEvents,
        groups: calculateOverlappingEvents(resourceEvents)
      };
    }), [selectedResources, events]);

  const weekDaysData = useMemo(() => {
    if (view !== CalendarViews.WEEK) return [];
    const startOfWeek = moment(currentDate).tz('Asia/Taipei').startOf('week');

    return Array.from({ length: 7 }, (_, i) => {
      const dateMoment = startOfWeek.clone().add(i, 'days');
      const date = dateMoment.toDate();
      const dayEvents = events.filter(event =>
        moment(event.start).tz('Asia/Taipei').isSame(dateMoment, 'day')
      );
      return {
        date,
        dateMoment,
        events: dayEvents,
        groups: calculateOverlappingEvents(dayEvents)
      };
    });
  }, [view, currentDate, events]);

  const handleSlotClick = (
    baseDate: Date,
    hour: number,
    minute: number,
    practitionerId: number | undefined,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    const slotDate = createTimeSlotDate(baseDate, hour, minute);
    const slotInfo: { start: Date; end: Date; practitionerId?: number } = {
      start: slotDate,
      end: new Date(slotDate.getTime() + 15 * 60 * 1000),
    };
    if (practitionerId != null) slotInfo.practitionerId = practitionerId;

    const viewportElement = document.querySelector('[data-testid="calendar-viewport"]') as HTMLElement | null;
    if (viewportElement) {
      const viewportRect = viewportElement.getBoundingClientRect();
      const slotEl = event.currentTarget as HTMLElement;
      const slotRect = slotEl.getBoundingClientRect();
      setSlotMenu({
        visible: true,
        anchorX: (slotRect.right - viewportRect.left) + viewportElement.scrollLeft,
        anchorY: (slotRect.top - viewportRect.top) + viewportElement.scrollTop + (slotRect.height / 2),
        anchorTop: (slotRect.top - viewportRect.top) + viewportElement.scrollTop,
        x: (slotRect.right - viewportRect.left) + viewportElement.scrollLeft + 8,
        y: (slotRect.top - viewportRect.top) + viewportElement.scrollTop,
        slotInfo,
      });
    } else {
      setSlotMenu({
        visible: true,
        x: event.clientX + 8,
        y: event.clientY,
        anchorX: event.clientX,
        anchorY: event.clientY,
        anchorTop: event.clientY,
        slotInfo,
      });
    }
  };

  useEffect(() => {
    if (!slotMenu.visible) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-testid="slot-action-menu"]')) {
        setSlotMenu(menu => ({ ...menu, visible: false }));
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [slotMenu.visible]);

  useEffect(() => {
    if (!slotMenu.visible || !slotMenuRef.current) return;
    const menuRect = slotMenuRef.current.getBoundingClientRect();
    const margin = 8;
    let x = slotMenu.anchorX + 8;
    let y = slotMenu.anchorTop;

    const viewportElement = document.querySelector('[data-testid="calendar-viewport"]') as HTMLElement | null;
    if (viewportElement) {
      const maxX = viewportElement.scrollLeft + viewportElement.clientWidth - margin - menuRect.width;
      const maxY = viewportElement.scrollTop + viewportElement.clientHeight - margin - menuRect.height;
      x = Math.min(Math.max(viewportElement.scrollLeft + margin, x), Math.max(viewportElement.scrollLeft + margin, maxX));
      if (y > maxY) {
        y = Math.max(viewportElement.scrollTop + margin, slotMenu.anchorTop - menuRect.height - 8);
      }
      y = Math.max(viewportElement.scrollTop + margin, y);
    }

    if (x !== slotMenu.x || y !== slotMenu.y) {
      setSlotMenu(menu => ({ ...menu, x, y }));
    }
  }, [slotMenu.visible, slotMenu.x, slotMenu.y, slotMenu.anchorX, slotMenu.anchorTop]);

  const handleKeyboardNavigation = (key: string, target: HTMLElement, event: React.KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(key)) {
      event.preventDefault();
      const currentSlot = target.closest('[role="button"][aria-label*="Time slot"]') as HTMLElement;
      if (!currentSlot) return;

      const allSlots = Array.from(document.querySelectorAll('[role="button"][aria-label*="Time slot"]')) as HTMLElement[];
      const currentIndex = allSlots.indexOf(currentSlot);
      if (currentIndex === -1) return;

      let newIndex = currentIndex;
      switch (key) {
        case 'ArrowUp': newIndex = Math.max(0, currentIndex - 1); break;
        case 'ArrowDown': newIndex = Math.min(allSlots.length - 1, currentIndex + 1); break;
        case 'ArrowLeft':
          if (view === CalendarViews.DAY || view === CalendarViews.WEEK) {
            const slotsPerColumn = timeSlots.length;
            const col = Math.floor(currentIndex / slotsPerColumn);
            if (col > 0) newIndex = (col - 1) * slotsPerColumn + (currentIndex % slotsPerColumn);
          }
          break;
        case 'ArrowRight':
          if (view === CalendarViews.DAY) {
            const slotsPerColumn = timeSlots.length;
            const col = Math.floor(currentIndex / slotsPerColumn);
            const totalCols = selectedPractitioners.length + selectedResources.length;
            if (col < totalCols - 1) newIndex = (col + 1) * slotsPerColumn + (currentIndex % slotsPerColumn);
          } else if (view === CalendarViews.WEEK) {
            const slotsPerColumn = timeSlots.length;
            const col = Math.floor(currentIndex / slotsPerColumn);
            if (col < 6) newIndex = (col + 1) * slotsPerColumn + (currentIndex % slotsPerColumn);
          }
          break;
        case 'Enter':
        case ' ': {
          const ariaLabel = currentSlot.getAttribute('aria-label');
          if (ariaLabel) {
            const timeMatch = ariaLabel.match(/Time slot (\d{1,2}):(\d{2})/);
            if (timeMatch && timeMatch[1] && timeMatch[2]) {
              const hour = parseInt(timeMatch[1], 10);
              const minute = parseInt(timeMatch[2], 10);
              const practitionerMatch = ariaLabel.match(/for practitioner (\d+)/);
              const pId = practitionerMatch && practitionerMatch[1] ? parseInt(practitionerMatch[1], 10) : undefined;
              if (onSlotClick) {
                const sDate = createTimeSlotDate(currentDate, hour, minute);
                onSlotClick({ start: sDate, end: new Date(sDate.getTime() + 15 * 60 * 1000), practitionerId: pId });
              }
            }
          }
          break;
        }
      }
      if (newIndex !== currentIndex && allSlots[newIndex]) (allSlots[newIndex] as HTMLElement).focus();
    }
  };

  const calculatePreview = useCallback((clientX: number, clientY: number) => {
    if (!gridRef.current || !dragState.event) return undefined;
    const rect = gridRef.current.getBoundingClientRect();
    const y = (clientY - dragState.dragOffset.y) - rect.top;

    // Use raw cursor X + scroll offset for horizontal snapping
    const cursorX = (clientX - rect.left) + gridRef.current.scrollLeft;

    const slotHeight = CALENDAR_GRID_CONFIG.SLOT_HEIGHT_PX;
    const totalMinutes = Math.floor(y / slotHeight) * CALENDAR_GRID_CONFIG.SLOT_DURATION_MINUTES;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const clampedHours = Math.max(0, Math.min(23, hours));
    const clampedMinutes = Math.max(0, Math.min(45, minutes));

    const duration = dragState.event.end.getTime() - dragState.event.start.getTime();

    let result: DragPreview | undefined;
    const currentDateMoment = moment(currentDate).tz('Asia/Taipei');

    if (view === CalendarViews.DAY) {
      const totalColumns = selectedPractitioners.length + selectedResources.length || 1;
      const columnWidth = dragState.columnWidth || (gridRef.current.scrollWidth / totalColumns);

      // Restrict appointments and exceptions to practitioner columns only. 
      // This prevents dragging into the "illegal zone" (resource columns like beds/rooms).
      const maxAllowedIndex = selectedPractitioners.length - 1;
      const colIndex = Math.max(0, Math.min(maxAllowedIndex, Math.floor(cursorX / columnWidth)));

      let targetPractitionerId: number | undefined;
      let targetResourceId: number | undefined;
      if (colIndex < selectedPractitioners.length) {
        targetPractitionerId = selectedPractitioners[colIndex];
      } else {
        targetResourceId = selectedResources[colIndex - selectedPractitioners.length];
      }

      if (dragState.event.resource.type === 'availability_exception') {
        targetPractitionerId = dragState.event.resource.practitioner_id ?? undefined;
      }

      result = {
        start: new Date(currentDateMoment.hour(clampedHours).minute(clampedMinutes).second(0).millisecond(0).valueOf()),
        end: new Date(currentDateMoment.hour(clampedHours).minute(clampedMinutes).second(0).millisecond(0).valueOf() + duration),
        practitionerId: targetPractitionerId,
        resourceId: targetResourceId,
        date: moment(currentDate).format('YYYY-MM-DD'),
        isAvailable: targetPractitionerId ? isTimeSlotAvailable(targetPractitionerId, currentDate, clampedHours, clampedMinutes, practitionerAvailability, false) : true
      };
    } else if (view === CalendarViews.WEEK) {
      const columnWidth = dragState.columnWidth || (gridRef.current.scrollWidth / 7);
      const dayIndex = Math.max(0, Math.min(6, Math.floor(cursorX / columnWidth)));
      const targetDate = moment(currentDate).startOf('week').add(dayIndex, 'days').toDate();
      const newStart = createTimeSlotDate(targetDate, clampedHours, clampedMinutes);
      const newEnd = new Date(newStart.getTime() + duration);

      result = {
        start: newStart,
        end: newEnd,
        practitionerId: dragState.event?.resource.practitioner_id ?? undefined,
        date: moment(targetDate).format('YYYY-MM-DD'),
        isAvailable: dragState.event?.resource.practitioner_id ? isTimeSlotAvailable(dragState.event.resource.practitioner_id, targetDate, clampedHours, clampedMinutes, practitionerAvailability, false) : true
      };
    }

    setDragState(prev => ({
      ...prev,
      x: clientX,
      y: clientY,
      preview: result,
    }));

    if (viewportEl) {
      const vRect = viewportEl.getBoundingClientRect();
      const zone = 60;
      let vx = 0;
      let vy = 0;
      if (clientY < vRect.top + zone) vy = -12;
      else if (clientY > vRect.bottom - zone) vy = 12;
      if (clientX < vRect.left + zone) vx = -12;
      else if (clientX > vRect.right - zone) vx = 12;
      scrollVelocityRef.current = { x: vx, y: vy };
    }
    return undefined;
  }, [dragState.event, dragState.columnWidth, view, selectedPractitioners, selectedResources, currentDate, currentUserId, practitionerAvailability]);

  useEffect(() => {
    if (!dragState.isDragging) {
      scrollVelocityRef.current = { x: 0, y: 0 };
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      return undefined;
    }

    const scrollLoop = () => {
      const { x, y } = scrollVelocityRef.current;
      if (x !== 0 || y !== 0) {
        if (viewportEl) {
          viewportEl.scrollTop += y;
          viewportEl.scrollLeft += x;
        }
      }
      scrollRafRef.current = requestAnimationFrame(scrollLoop);
    };

    scrollRafRef.current = requestAnimationFrame(scrollLoop);
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    };
  }, [dragState.isDragging]);

  const handleDragStart = useCallback((
    event: CalendarEvent,
    clientX: number,
    clientY: number,
    isTouch: boolean = false,
    dragOffset: { x: number; y: number } = { x: 0, y: 0 },
    dragInitialSize: { width: number; height: number } = { width: 120, height: 40 }
  ) => {
    wasDraggingRef.current = false;
    // Interaction with an event should close any open slot menus (FABs)
    setSlotMenu(prev => ({ ...prev, visible: false }));

    if (event.resource.is_resource_event) return;
    if (canEditEvent && !canEditEvent(event)) return;

    if (isTouch) {
      touchStartPosRef.current = { x: clientX, y: clientY };
      longPressTimerRef.current = setTimeout(() => {
        isLongPressActiveRef.current = true;
        if (navigator.vibrate) navigator.vibrate(50);
        setDragState({
          event, isDragging: true, x: clientX, y: clientY,
          preview: {
            start: event.start, end: event.end,
            practitionerId: event.resource.practitioner_id ?? undefined,
            resourceId: event.resource.resource_id ?? undefined,
          },
          isTouch: true,
          dragOffset,
          dragInitialSize,
        });
      }, 400);
    } else {
      setDragState({
        event, isDragging: false, // Don't start visually until threshold met
        x: clientX, y: clientY,
        preview: {
          start: event.start, end: event.end,
          practitionerId: event.resource.practitioner_id ?? undefined,
          resourceId: event.resource.resource_id ?? undefined,
        },
        isTouch: false,
        dragOffset,
        dragInitialSize,
      });
    }
  }, [canEditEvent]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState.event) return;
    if (!dragState.isDragging && !dragState.isTouch) {
      const dist = Math.sqrt(Math.pow(e.clientX - dragState.x, 2) + Math.pow(e.clientY - dragState.y, 2));
      if (dist > 5) {
        setDragState(prev => ({ ...prev, isDragging: true }));
      }
      return;
    }
    if (dragState.isDragging) {
      calculatePreview(e.clientX, e.clientY);
    }
  }, [dragState.event, dragState.isDragging, dragState.isTouch, dragState.x, dragState.y, calculatePreview]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (longPressTimerRef.current && touch && touchStartPosRef.current) {
      const dist = Math.sqrt(Math.pow(touch.clientX - touchStartPosRef.current.x, 2) + Math.pow(touch.clientY - touchStartPosRef.current.y, 2));
      if (dist > 10) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
    if (!dragState.event) return;
    if (dragState.isDragging) {
      if (touch) calculatePreview(touch.clientX, touch.clientY);
    }
  }, [dragState.event, dragState.isDragging, calculatePreview]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Use { passive: false } to confirm intention to call preventDefault()
    const activeTouchHandler = (e: TouchEvent) => {
      if (dragState.isDragging && dragState.event) {
        e.preventDefault();
      }
      handleTouchMove(e as unknown as React.TouchEvent);
    };

    container.addEventListener('touchmove', activeTouchHandler, { passive: false });
    return () => container.removeEventListener('touchmove', activeTouchHandler);
  }, [dragState.isDragging, dragState.event, handleTouchMove]);

  const handleDragEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    isLongPressActiveRef.current = false;
    if (dragState.isDragging && dragState.preview && dragState.event) {
      const { event, preview } = dragState;

      const hasMoved =
        moment(event.start).unix() !== moment(preview.start).unix() ||
        moment(event.end).unix() !== moment(preview.end).unix() ||
        (preview.practitionerId !== undefined && preview.practitionerId !== event.resource.practitioner_id);

      if (hasMoved) {
        if (event.resource.type !== 'availability_exception') {
          onEventReschedule?.(event, {
            start: preview.start,
            end: preview.end,
            practitionerId: preview.practitionerId ?? undefined,
          });
        } else {
          onExceptionMove?.(event, {
            start: preview.start,
            end: preview.end,
            practitionerId: preview.practitionerId ?? undefined,
          });
        }
      }
    }
    wasDraggingRef.current = dragState.isDragging;
    touchStartPosRef.current = null;
    scrollVelocityRef.current = { x: 0, y: 0 };
    setDragState({
      event: null, isDragging: false, x: 0, y: 0, preview: null, isTouch: false,
      dragOffset: { x: 0, y: 0 }, dragInitialSize: { width: 0, height: 0 }
    });
  }, [dragState, onEventReschedule, onExceptionMove]);

  useEffect(() => {
    if (dragState.isDragging) {
      document.body.classList.add('no-selection');

      const resourceGrid = resourceGridRef.current;
      if (resourceGrid) {
        const firstCol = resourceGrid.querySelector('[role="gridcell"]');
        if (firstCol) {
          const colWidth = firstCol.getBoundingClientRect().width;
          setDragState(prev => {
            if (prev.columnWidth === colWidth) return prev;
            return { ...prev, columnWidth: colWidth };
          });
        }
      }
    } else {
      document.body.classList.remove('no-selection');
    }
    return () => document.body.classList.remove('no-selection');
  }, [dragState.isDragging]);

  useEffect(() => {
    if (dragState.event) {
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchend', handleDragEnd);
      return () => {
        window.removeEventListener('mouseup', handleDragEnd);
        window.removeEventListener('touchend', handleDragEnd);
      };
    }
    return undefined;
  }, [dragState.event, handleDragEnd]);

  const previewColor = useMemo(() => {
    if (!dragState.event || !dragState.preview) return '#3b82f6';

    if (dragState.event.resource.type === 'availability_exception') {
      return '#6b7280'; // Grey for exceptions
    }

    if (dragState.preview.practitionerId) {
      return getPractitionerColor(dragState.preview.practitionerId, currentUserId ?? -1, selectedPractitioners) || '#3b82f6';
    }

    if (dragState.preview.resourceId) {
      return getResourceColorById(dragState.preview.resourceId, selectedResources) || '#6b7280';
    }

    return '#3b82f6';
  }, [dragState.event, dragState.preview, currentUserId, selectedPractitioners, selectedResources]);


  return (
    <div
      ref={containerRef}
      className={`${styles.calendarGridContainer} ${view === CalendarViews.MONTH ? styles.monthView : ''}`}
      data-testid="calendar-grid-container"
      style={{ position: 'relative' }}
      onMouseMove={handleMouseMove}
    >
      <PractitionerRow
        view={view} currentDate={currentDate} events={events}
        selectedPractitioners={selectedPractitioners} selectedResources={selectedResources}
        practitioners={practitioners} resources={resources}
        practitionerAvailability={practitionerAvailability} currentUserId={currentUserId}
        onEventClick={onEventClick || (() => { })} onSlotClick={onSlotClick || (() => { })}
        onHeaderClick={onHeaderClick || (() => { })}
      />

      <div className={styles.gridLayer}>
        {view !== CalendarViews.MONTH && (
          <div id="time-labels" className={styles.timeColumn} style={{ width: `${CALENDAR_GRID_TIME_COLUMN_WIDTH}px` }}>
            {timeSlots.filter((_, i) => i % 4 === 0).map((slot, i) => (
              <div key={i} className={styles.timeLabel}>
                {slot.hour === 0 ? <span /> : <span>{slot.hour}</span>}
              </div>
            ))}
          </div>
        )}
        <div ref={gridRef} className={styles.calendarGrid} role="grid" tabIndex={0}>
          <div className={styles.timeIndicator} style={currentTimeIndicatorStyle} data-testid="current-time-indicator" />
          <div className="grid-container" role="presentation">
            {view === CalendarViews.MONTH ? (
              <MonthlyBody
                currentDate={currentDate} events={events}
                selectedPractitioners={selectedPractitioners} selectedResources={selectedResources}
                currentUserId={currentUserId} onEventClick={handleEventClick} onHeaderClick={onHeaderClick}
              />
            ) : (
              <div ref={resourceGridRef} className={styles.resourceGrid}>
                {dragState.isDragging && dragState.preview && (
                  <div
                    data-testid="drop-preview"
                    style={{
                      position: 'absolute',
                      top: calculateEventPosition(dragState.preview.start).top,
                      left: view === CalendarViews.DAY
                        ? (() => {
                          const total = selectedPractitioners.length + selectedResources.length || 1;
                          const pIdx = selectedPractitioners.findIndex(id => id === dragState.preview?.practitionerId);
                          const rIdx = pIdx === -1 ? selectedResources.findIndex(id => id === dragState.preview?.resourceId) : -1;
                          const colIdx = pIdx !== -1 ? pIdx : (rIdx !== -1 ? selectedPractitioners.length + rIdx : 0);

                          if (dragState.columnWidth) {
                            return `${colIdx * dragState.columnWidth}px`;
                          }
                          return `${(colIdx / total) * 100}%`;
                        })()
                        : view === CalendarViews.WEEK
                          ? (dragState.columnWidth
                            ? `${moment(dragState.preview.start).tz('Asia/Taipei').day() * dragState.columnWidth}px`
                            : `${(moment(dragState.preview.start).tz('Asia/Taipei').day() / 7) * 100}%`)
                          : '0',
                      width: dragState.columnWidth
                        ? `${dragState.columnWidth}px`
                        : (view === CalendarViews.DAY ? `calc(100% / ${selectedPractitioners.length + selectedResources.length || 1})` : view === CalendarViews.WEEK ? 'calc(100% / 7)' : '100%'),
                      height: calculateEventHeight(dragState.preview.start, dragState.preview.end).height,
                      backgroundColor: previewColor,
                      opacity: 0.7,
                      border: `2px solid ${previewColor}`,
                      borderRadius: '8px',
                      zIndex: 40,
                      pointerEvents: 'none',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      justifyContent: 'flex-start',
                      padding: '4px 6px',
                      color: 'white',
                      fontSize: '11px',
                      fontWeight: 500
                    }}
                  >
                    <div className="flex flex-col items-start w-full overflow-hidden">
                      <div className="text-[12px] font-bold leading-tight flex items-center gap-1">
                        <span>{moment(dragState.preview.start).tz('Asia/Taipei').format('HH:mm')}</span>
                        <span className="opacity-70">-</span>
                        <span>{moment(dragState.preview.end).tz('Asia/Taipei').format('HH:mm')}</span>
                      </div>
                      <div className="text-[10px] font-medium opacity-90 break-words self-stretch leading-tight">
                        {dragState.event ? calculateEventDisplayText(dragState.event) : ''}
                      </div>
                    </div>
                  </div>
                )}
                {view === CalendarViews.DAY && practitionerGroups.length === 0 && resourceGroups.length === 0 && (
                  <div className={styles.practitionerColumn} role="gridcell">
                    {timeSlots.map((slot, i) => (
                      <div
                        key={i} className={styles.timeSlot}
                        onClick={(e) => handleSlotClick(currentDate, slot.hour, slot.minute, undefined, e)}
                        onKeyDown={(e) => handleKeyboardNavigation(e.key, e.currentTarget, e)}
                        role="button" aria-label={`Time slot ${slot.time}`}
                        data-testid="time-slot" tabIndex={-1}
                      />
                    ))}
                  </div>
                )}
                {view === CalendarViews.DAY && practitionerGroups.map(({ practitionerId, groups }) => (
                  <div
                    key={practitionerId}
                    className={`${styles.practitionerColumn} ${dragState.isDragging &&
                      dragState.event?.resource.type === 'availability_exception' &&
                      dragState.event.resource.practitioner_id !== practitionerId
                      ? styles.restrictedZone : ''
                      }`}
                    role="gridcell"
                    aria-label={`Column for practitioner ${practitionerId}`}
                  >
                    {timeSlots.map((slot, i) => (
                      <div
                        key={i} className={`${styles.timeSlot} ${!isTimeSlotAvailable(practitionerId, currentDate, slot.hour, slot.minute, practitionerAvailability, false) ? styles.unavailable : ''}`}
                        onClick={(e) => handleSlotClick(currentDate, slot.hour, slot.minute, practitionerId, e)}
                        onKeyDown={(e) => handleKeyboardNavigation(e.key, e.currentTarget, e)}
                        role="button" aria-label={`Time slot ${slot.time} for practitioner ${practitionerId}`}
                        data-testid="time-slot" tabIndex={-1}
                      />
                    ))}
                    {groups.map((group, groupIndex) => (
                      <OverlappingEventGroupComponent
                        key={groupIndex} group={group} groupIndex={groupIndex}
                        selectedPractitioners={selectedPractitioners} selectedResources={selectedResources}
                        currentUserId={currentUserId} onEventClick={handleEventClick}
                        onDragStart={handleDragStart} activeDragEventId={activeDragEventId}
                      />
                    ))}
                  </div>
                ))}
                {view === CalendarViews.DAY && resourceGroups.map(({ resourceId, groups }) => (
                  <div key={resourceId} className={`${styles.practitionerColumn} ${dragState.isDragging ? styles.restrictedZone : ''}`} role="gridcell">
                    {timeSlots.map((slot, i) => (
                      <div
                        key={i} className={styles.timeSlot}
                        onClick={(e) => handleSlotClick(currentDate, slot.hour, slot.minute, undefined, e)}
                        onKeyDown={(e) => handleKeyboardNavigation(e.key, e.currentTarget, e)}
                        role="button" aria-label={`Time slot ${slot.time} for resource ${resourceId}`}
                        data-testid="time-slot" tabIndex={-1}
                      />
                    ))}
                    {groups.map((group, groupIndex) => (
                      <OverlappingEventGroupComponent
                        key={groupIndex} group={group} groupIndex={groupIndex}
                        selectedPractitioners={selectedPractitioners} selectedResources={selectedResources}
                        currentUserId={currentUserId} onEventClick={handleEventClick}
                        onDragStart={handleDragStart} activeDragEventId={activeDragEventId}
                      />
                    ))}
                  </div>
                ))}
                {view === CalendarViews.WEEK && weekDaysData.map((day, i) => (
                  <div key={i} className={styles.practitionerColumn} role="gridcell">
                    {timeSlots.map((slot, si) => (
                      <div
                        key={si} className={`${styles.timeSlot} ${currentUserId && !isTimeSlotAvailable(currentUserId, day.date, slot.hour, slot.minute, practitionerAvailability, false) ? styles.unavailable : ''}`}
                        onClick={(e) => handleSlotClick(day.date, slot.hour, slot.minute, currentUserId ?? undefined, e)}
                        onKeyDown={(e) => handleKeyboardNavigation(e.key, e.currentTarget, e)}
                        role="button" aria-label={`Time slot ${slot.time} on ${day.dateMoment.format('dddd')}`}
                        data-testid="time-slot" tabIndex={-1}
                      />
                    ))}
                    {day.groups.map((group, groupIndex) => (
                      <OverlappingEventGroupComponent
                        key={groupIndex} group={group} groupIndex={groupIndex}
                        selectedPractitioners={selectedPractitioners} selectedResources={selectedResources}
                        currentUserId={currentUserId} onEventClick={handleEventClick}
                        onDragStart={handleDragStart} activeDragEventId={activeDragEventId}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {slotMenu.visible && slotMenu.slotInfo && (
        (() => {
          const menu = (
            <div data-testid="slot-action-menu" ref={slotMenuRef} style={{ position: 'absolute', left: slotMenu.x, top: slotMenu.y, zIndex: 90 }}>
              <div className="flex flex-col gap-2">
                <button
                  data-testid="fab-create-appointment"
                  className="btn-secondary px-3 py-1 text-sm rounded-full shadow"
                  onClick={() => { onSlotClick?.(slotMenu.slotInfo!); setSlotMenu(m => ({ ...m, visible: false })); }}
                >+ 預約</button>
                <button
                  data-testid="fab-create-exception"
                  className="btn-secondary px-3 py-1 text-sm rounded-full shadow"
                  onClick={() => { onSlotExceptionClick?.(slotMenu.slotInfo!); setSlotMenu(m => ({ ...m, visible: false })); }}
                >+ 休診</button>
              </div>
            </div>
          );
          return viewportEl ? createPortal(menu, viewportEl) : menu;
        })()
      )}
    </div>
  );
};

interface CalendarEventComponentProps {
  event: CalendarEvent;
  selectedPractitioners: number[];
  selectedResources: number[];
  currentUserId?: number | null | undefined;
  onClick: () => void;
  group?: OverlappingEventGroup;
  groupIndex?: number;
  eventIndex?: number;
  onDragStart: (
    event: CalendarEvent,
    clientX: number,
    clientY: number,
    isTouch?: boolean,
    dragOffset?: { x: number; y: number },
    dragInitialSize?: { width: number; height: number }
  ) => void;
  isDragging?: boolean;
}

const CalendarEventComponent: React.FC<CalendarEventComponentProps> = ({
  event, selectedPractitioners, selectedResources, currentUserId, onClick, group, eventIndex = 0, onDragStart, isDragging = false
}) => {
  const eventStyle = useMemo(() => {
    const base = group ? calculateEventInGroupPosition(event, group, eventIndex) : { ...calculateEventPosition(event.start), ...calculateEventHeight(event.start, event.end), left: 0, width: '100%' };
    let bg = '#6b7280';
    let border = 'none';
    let br = '8px';
    if (event.resource.practitioner_id) bg = getPractitionerColor(event.resource.practitioner_id, currentUserId ?? -1, selectedPractitioners) || '#3b82f6';
    else if (event.resource.resource_id) { bg = getResourceColorById(event.resource.resource_id, selectedResources) || '#6b7280'; border = '1px dashed rgba(255, 255, 255, 0.5)'; }

    const isException = event.resource.type === 'availability_exception';
    if (isDragging) {
      if (isException) { bg = '#9ca3af'; border = `2px solid ${event.resource.practitioner_id ? getPractitionerColor(event.resource.practitioner_id, currentUserId ?? -1, selectedPractitioners) || '#3b82f6' : '#3b82f6'}`; br = '4px'; }
      return {
        ...base,
        left: 0,
        width: '100%',
        backgroundColor: 'rgba(255, 255, 255, 0.6)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        border: `2px dashed ${bg}`,
        borderRadius: br,
        zIndex: 30,
        boxShadow: 'none'
      };
    }

    if (isException) { bg = '#9ca3af'; border = `2px solid ${event.resource.practitioner_id ? getPractitionerColor(event.resource.practitioner_id, currentUserId ?? -1, selectedPractitioners) || '#3b82f6' : '#3b82f6'}`; br = '4px'; }

    // High-Density Professional Visuals
    // 1. Reduced Padding: 2px standard, 1px if narrow
    const isNarrow = base.width && typeof base.width === 'string' && parseFloat(base.width) < 50;
    const padding = isNarrow ? '1px 2px' : '2px 4px';
    const fontSize = isNarrow ? '10px' : '11px';

    // 2. Corner Radius: 4px default (sharper than 8px)
    br = isException ? '4px' : '4px';

    // Respect calculated zIndex from utility if it exists (for column stacking), otherwise fallback
    const finalZIndex = base.zIndex !== undefined ? base.zIndex : (isException ? 3 : 5);

    // 3. Subtle Shadow for depth
    const boxShadow = '0 1px 2px 0 rgba(0, 0, 0, 0.15)';

    return {
      ...base,
      backgroundColor: bg,
      border,
      borderRadius: br,
      zIndex: finalZIndex,
      padding,
      fontSize,
      boxShadow
    };
  }, [event, group, eventIndex, selectedPractitioners, selectedResources, isDragging, currentUserId]);

  const isCheckedOut = event.resource.has_active_receipt;

  // Use duration to determine line clamping strategy
  const isShortDuration = (event.end.getTime() - event.start.getTime()) < 30 * 60 * 1000;
  const isTinyDuration = (event.end.getTime() - event.start.getTime()) <= 15 * 60 * 1000;

  return (
    <div
      className={`${styles.calendarEvent} ${isCheckedOut ? styles.checkedOut : ''}`} style={eventStyle} onClick={onClick}
      title={buildEventTooltipText(event, formatAppointmentTimeRange(event.start, event.end))}
      role="button" aria-label={`Appointment: ${calculateEventDisplayText(event)}`} tabIndex={-1}
      onMouseDown={e => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        onDragStart(event, e.clientX, e.clientY, false, { x: e.clientX - rect.left, y: e.clientY - rect.top }, { width: rect.width, height: rect.height });
      }}
      onTouchStart={e => {
        e.stopPropagation();
        if (e.touches[0]) {
          const rect = e.currentTarget.getBoundingClientRect();
          onDragStart(event, e.touches[0].clientX, e.touches[0].clientY, true, { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top }, { width: rect.width, height: rect.height });
        }
      }}
    >
      {isDragging ? (
        <div className="flex flex-col items-start justify-start h-full p-1 w-full overflow-hidden">
          <div className="text-[12px] font-bold text-gray-700 leading-tight">
            {moment(event.start).tz('Asia/Taipei').format('HH:mm')} - {moment(event.end).tz('Asia/Taipei').format('HH:mm')}
          </div>
          <div className="text-[10px] font-medium text-gray-700 break-words self-stretch mt-0.5 leading-tight">
            {calculateEventDisplayText(event)}
          </div>
        </div>
      ) : (
        <div className={`flex flex-col h-full w-full overflow-hidden ${isShortDuration ? 'justify-center' : ''}`} style={{ lineHeight: '1.1' }}>
          {/* Smart Layout: High Density. 
               - Bold Text
               - No Time
               - Dynamic Clamping: 1 line if tiny (<15m), else let it flow (unset) to show full name
           */}
          <div className="font-bold text-white text-[inherit] leading-tight break-words whitespace-normal overflow-hidden" style={{
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: isTinyDuration ? 1 : 'unset',
            maxHeight: '100%',
            wordBreak: 'break-word'
          }}>
            {calculateEventDisplayText(event)}
          </div>
        </div>
      )}
    </div>
  );
};

interface MonthlyBodyProps {
  currentDate: Date;
  events: CalendarEvent[];
  selectedPractitioners: number[];
  selectedResources: number[];
  currentUserId?: number | null | undefined;
  onEventClick?: ((event: CalendarEvent) => void) | undefined;
  onHeaderClick?: ((date: Date) => void) | undefined;
}

const MonthlyBody: React.FC<MonthlyBodyProps> = ({ currentDate, events, selectedPractitioners, selectedResources, currentUserId, onEventClick, onHeaderClick }) => {
  const month = moment(currentDate).tz('Asia/Taipei');
  const start = month.clone().startOf('month').startOf('week');
  const end = month.clone().endOf('month').endOf('week');
  const days = useMemo(() => {
    const ds = [];
    let curr = start.clone();
    while (curr.isSameOrBefore(end)) {
      ds.push({ date: curr.clone(), events: events.filter(e => moment(e.start).tz('Asia/Taipei').isSame(curr, 'day')), isCurrentMonth: curr.month() === month.month(), isToday: curr.isSame(moment().tz('Asia/Taipei'), 'day') });
      curr.add(1, 'day');
    }
    return ds;
  }, [start, end, events, month]);

  return (
    <div className={styles.monthlyGrid}>
      <div className={styles.monthlyCalendar}>
        {days.map((day, i) => (
          <div key={i} className={`${styles.dayCell} ${!day.isCurrentMonth ? styles.otherMonth : ''} ${day.isToday ? styles.today : ''}`}>
            <div className={styles.dayNumber} style={{ cursor: 'pointer' }} onClick={() => onHeaderClick?.(day.date.toDate())}>{day.date.date()}</div>
            <div className={styles.dayEvents}>
              {day.events.slice(0, 6).map((e, ei) => {
                const isCheckedOut = e.resource.has_active_receipt;
                return (
                  <div
                    key={ei} className={`${styles.monthEvent} ${isCheckedOut ? styles.checkedOut : ''}`}
                    style={{
                      backgroundColor: e.resource.type === 'availability_exception' ? '#9ca3af' : (e.resource.practitioner_id ? getPractitionerColor(e.resource.practitioner_id, currentUserId ?? -1, selectedPractitioners) || '#3b82f6' : (e.resource.resource_id ? getResourceColorById(e.resource.resource_id, selectedResources) || '#6b7280' : '#6b7280')),
                      border: e.resource.type === 'availability_exception' ? `2px solid ${e.resource.practitioner_id ? getPractitionerColor(e.resource.practitioner_id, currentUserId ?? -1, selectedPractitioners) || '#3b82f6' : '#3b82f6'}` : (e.resource.resource_id ? '1px dashed rgba(255, 255, 255, 0.5)' : 'none')
                    }}
                    onClick={() => onEventClick?.(e)} title={buildEventTooltipText(e, formatAppointmentTimeRange(e.start, e.end))}
                  >
                    <div className="text-xs">{calculateEventDisplayText(e)}</div>
                  </div>
                );
              })}
              {day.events.length > 6 && <div className={styles.monthEvent} style={{ backgroundColor: 'transparent', color: '#4b5563', fontSize: '11px', textAlign: 'center' }}>+{day.events.length - 6}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

interface OverlappingEventGroupProps {
  group: OverlappingEventGroup;
  groupIndex: number;
  selectedPractitioners: number[];
  selectedResources: number[];
  currentUserId?: number | null | undefined;
  onEventClick: (event: CalendarEvent) => void;
  onDragStart: (
    event: CalendarEvent,
    clientX: number,
    clientY: number,
    isTouch?: boolean,
    dragOffset?: { x: number; y: number },
    dragInitialSize?: { width: number; height: number }
  ) => void;
  activeDragEventId?: number | string | undefined;
}

const OverlappingEventGroupComponent: React.FC<OverlappingEventGroupProps> = ({
  group, groupIndex, selectedPractitioners, selectedResources, currentUserId, onEventClick, onDragStart, activeDragEventId
}) => (
  <>
    {group.events.map((event, eventIndex) => (
      <CalendarEventComponent
        key={event.id} event={event} selectedPractitioners={selectedPractitioners} selectedResources={selectedResources}
        group={group} groupIndex={groupIndex} eventIndex={eventIndex} currentUserId={currentUserId}
        onClick={() => onEventClick?.(event)} onDragStart={onDragStart}
        isDragging={event.id === activeDragEventId}
      />
    ))}
  </>
);

export const PractitionerRow: React.FC<Omit<CalendarGridProps, 'showHeaderRow'>> = ({ view, currentDate, selectedPractitioners, selectedResources, practitioners = EMPTY_ARRAY, resources = EMPTY_ARRAY, onHeaderClick }) => (
  <div className={styles.headerRow} data-testid="calendar-header-row">
    {view !== CalendarViews.MONTH && <div className={styles.timeCorner} data-testid="calendar-time-corner" style={{ width: `${CALENDAR_GRID_TIME_COLUMN_WIDTH}px` }} />}
    <div className={styles.resourceHeaders}>
      {view === CalendarViews.DAY && (
        <>
          {selectedPractitioners.map(id => <div key={id} className={styles.resourceHeader}>{practitioners.find(p => p.id === id)?.full_name || `P ${id}`}</div>)}
          {selectedResources.map(id => <div key={id} className={styles.resourceHeader}>{resources.find(r => r.id === id)?.name || `R ${id}`}</div>)}
        </>
      )}
      {view === CalendarViews.WEEK && Array.from({ length: 7 }, (_, i) => {
        const d = moment(currentDate).startOf('week').add(i, 'days');
        return (
          <div key={i} className={styles.resourceHeader} style={{ cursor: 'pointer' }} onClick={() => onHeaderClick?.(d.toDate())}>
            <span className="text-sm font-bold text-gray-800">{d.format('D')}</span>
            <span className="text-xs text-gray-500">({['日', '一', '二', '三', '四', '五', '六'][i]})</span>
          </div>
        );
      })}
      {view === CalendarViews.MONTH && Array.from({ length: 7 }, (_, i) => <div key={i} className={styles.resourceHeader}>{['日', '一', '二', '三', '四', '五', '六'][i]}</div>)}
    </div>
  </div>
);

export default CalendarGrid;
import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import moment from 'moment-timezone';
import { CalendarEvent } from '../../utils/calendarDataAdapter';
import { CalendarView, CalendarViews } from '../../types/calendar';
import { getPractitionerColor } from '../../utils/practitionerColors';
import { getResourceColorById } from '../../utils/resourceColorUtils';
// logger removed after debug cleanup
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
import { EMPTY_ARRAY, EMPTY_OBJECT } from '../../utils/constants';
import styles from './CalendarGrid.module.css';

interface CalendarGridProps {
  view: CalendarView;
  currentDate: Date;
  events: CalendarEvent[];
  selectedPractitioners: number[];
  selectedResources: number[];
  practitioners?: Array<{ id: number; full_name: string }>; // Practitioner data
  resources?: Array<{ id: number; name: string }>; // Resource data
  practitionerAvailability?: CalendarPractitionerAvailability; // Practitioner availability data
  currentUserId?: number | null; // Current user ID for ordering
  onEventClick?: (event: CalendarEvent) => void;
  onSlotClick?: (slotInfo: { start: Date; end: Date; practitionerId?: number | undefined }) => void;
  onSlotExceptionClick?: (slotInfo: { start: Date; end: Date; practitionerId?: number | undefined }) => void;
  showHeaderRow?: boolean; // Whether to show the practitioner/resource header row
}



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
}) => {
  // Local menu state for slot action FABs
  const [slotMenu, setSlotMenu] = useState<{
    visible: boolean;
    x: number; // computed left for menu
    y: number; // computed top for menu
    anchorX: number; // anchor near slot's right edge in scroll space
    anchorY: number; // anchor at slot vertical center in scroll space
    anchorTop: number; // anchor at slot top in scroll space
    slotInfo: { start: Date; end: Date; practitionerId?: number } | null;
  }>({ visible: false, x: 0, y: 0, anchorX: 0, anchorY: 0, anchorTop: 0, slotInfo: null });
  const slotMenuRef = useRef<HTMLDivElement | null>(null);
  const [viewportEl, setViewportEl] = useState<HTMLElement | null>(null);
  // Generate time slots for the grid
  const timeSlots = useMemo(() => generateTimeSlots(), []);

  // Track if we've done initial auto-scroll for this component instance
  const hasScrolledRef = useRef(false);

  // Scroll to current time functionality
  const scrollToCurrentTimePosition = useCallback(() => {
    // Find the scrollable container (calendarViewport) inside CalendarLayout
    const viewportElement = document.querySelector('[data-testid="calendar-viewport"]') as HTMLElement;
    if (!viewportElement) return;

    const now = getCurrentTaiwanTime();
    const today = moment(currentDate).tz('Asia/Taipei').startOf('day');
    const isViewingToday = now.isSame(today, 'day');

    let targetHours: number;
    let targetMinutes: number;

    if (isViewingToday) {
      // Scroll to current time when viewing today
      targetHours = now.hour();
      targetMinutes = now.minute();
    } else {
      // Scroll to 8 AM when viewing other days
      targetHours = 8;
      targetMinutes = 0;
    }

    // Calculate position: (hours from 0 AM * 60 + minutes) / slot_duration * slot_height
    const minutesFromMidnight = (targetHours * 60) + targetMinutes;
    const pixelsFromTop = (minutesFromMidnight / CALENDAR_GRID_CONFIG.SLOT_DURATION_MINUTES) * CALENDAR_GRID_CONFIG.SLOT_HEIGHT_PX;

    // For today, add buffer to show context above current time
    // For other days, scroll directly to 8 AM (no buffer needed)
    const scrollPosition = isViewingToday
      ? Math.max(0, pixelsFromTop - CALENDAR_GRID_CONFIG.SCROLL_BUFFER_PX)
      : pixelsFromTop;

    // Check if scrollTo is available
    if (typeof viewportElement.scrollTo === 'function') {
      viewportElement.scrollTo({
        top: scrollPosition,
        behavior: 'instant'
      });
    }
  }, [currentDate]);

  // Auto-scroll only once on initial component mount for day/week views
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

  // Cache the scrollable viewport element for portals
  useEffect(() => {
    const el = document.querySelector('[data-testid="calendar-viewport"]') as HTMLElement | null;
    if (el) setViewportEl(el);
  }, []);

  // Calculate current time indicator position
  const currentTimeIndicatorStyle = useMemo(
    () => calculateCurrentTimeIndicatorPosition(currentDate, view),
    [currentDate, view]
  );

  // Memoize overlapping groups calculation for performance
  const practitionerGroups = useMemo(() => {
    const sortedPractitioners = [...selectedPractitioners].sort((a, b) => {
      // Current user appears first (leftmost)
      if (a === currentUserId) return -1;
      if (b === currentUserId) return 1;
      return 0;
    });

    return sortedPractitioners.map(practitionerId => {
      const practitionerEvents = events.filter(event => event.resource.practitioner_id === practitionerId);

      return {
        practitionerId,
        events: practitionerEvents,
        groups: calculateOverlappingEvents(practitionerEvents)
      };
    });
  }, [selectedPractitioners, events, currentUserId]);

  const resourceGroups = useMemo(() =>
    selectedResources.map(resourceId => {
      const resourceEvents = events.filter(event => event.resource.resource_id === resourceId);

      return {
        resourceId,
        events: resourceEvents,
        groups: calculateOverlappingEvents(resourceEvents)
      };
    }), [selectedResources, events]);


  // Note: DOM element caching removed for simplicity and test compatibility
  // Live queries are used for keyboard navigation

  const handleSlotClick = (
    hour: number,
    minute: number,
    practitionerId: number | undefined,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    // Open FABs near the click position, do not immediately trigger appointment flow
    const slotDate = createTimeSlotDate(currentDate, hour, minute);
    const slotInfo: { start: Date; end: Date; practitionerId?: number } = {
      start: slotDate,
      end: new Date(slotDate.getTime() + 15 * 60 * 1000),
    };
    if (practitionerId != null) slotInfo.practitionerId = practitionerId;

    // Position relative to the scrollable viewport so FABs move with the grid when scrolling
    const viewportElement = document.querySelector('[data-testid="calendar-viewport"]') as HTMLElement | null;
    if (viewportElement) {
      const viewportRect = viewportElement.getBoundingClientRect();
      const slotEl = event.currentTarget as HTMLElement;
      const slotRect = slotEl.getBoundingClientRect();
      // Debug logs removed
      setSlotMenu({
        visible: true,
        // Compute anchors in scroll space relative to viewport
        anchorX: (slotRect.right - viewportRect.left) + viewportElement.scrollLeft,
        anchorY: (slotRect.top - viewportRect.top) + viewportElement.scrollTop + (slotRect.height / 2),
        anchorTop: (slotRect.top - viewportRect.top) + viewportElement.scrollTop,
        // Seed x/y close to the anchor
        x: (slotRect.right - viewportRect.left) + viewportElement.scrollLeft + 8,
        y: (slotRect.top - viewportRect.top) + viewportElement.scrollTop,
        slotInfo,
      });
    } else {
      // Fallback to viewport coordinates
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

  // Dismiss menu on outside click
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

  // Clamp FAB menu within the scrollable viewport and flip vertically if needed
  useEffect(() => {
    if (!slotMenu.visible || !slotMenuRef.current) return;
    const menuRect = slotMenuRef.current.getBoundingClientRect();
    const margin = 8;
    // Desired positions from anchors: place to the right and align top to slot top for tight proximity
    let x = slotMenu.anchorX + 8; // 8px gap to the right of the slot
    let y = slotMenu.anchorTop;

    const viewportElement = document.querySelector('[data-testid="calendar-viewport"]') as HTMLElement | null;
    if (viewportElement) {
      const maxX = viewportElement.scrollLeft + viewportElement.clientWidth - margin - menuRect.width;
      const maxY = viewportElement.scrollTop + viewportElement.clientHeight - margin - menuRect.height;

      // Horizontal clamp
      x = Math.min(Math.max(viewportElement.scrollLeft + margin, x), Math.max(viewportElement.scrollLeft + margin, maxX));

      // Vertical clamp or flip above if needed
      if (y > maxY) {
        // Flip above the slot if needed
        y = Math.max(viewportElement.scrollTop + margin, slotMenu.anchorTop - menuRect.height - 8);
      }
      // Ensure within top bound
      y = Math.max(viewportElement.scrollTop + margin, y);
      // Debug logs removed
    } else {
      // Fallback to window bounds (rare)
      const maxX = window.innerWidth - margin - menuRect.width;
      const maxY = window.innerHeight - margin - menuRect.height;
      x = Math.min(Math.max(margin, x), Math.max(margin, maxX));
      if (y > maxY) y = Math.max(margin, slotMenu.anchorTop - menuRect.height - 8);
      y = Math.max(margin, y);
      // Debug logs removed
    }

    if (x !== slotMenu.x || y !== slotMenu.y) {
      setSlotMenu(menu => ({ ...menu, x, y }));
    }
  }, [slotMenu.visible, slotMenu.x, slotMenu.y, slotMenu.anchorX, slotMenu.anchorTop]);

  // Keyboard navigation support
  const handleKeyDown = (event: React.KeyboardEvent) => {
    const { key } = event;
    const target = event.target as HTMLElement;

    // Only handle keyboard navigation if we're in the calendar grid
    if (!target.closest('[data-testid="calendar-grid-container"]')) return;

    handleKeyboardNavigation(key, target, event);
  };

  // Separate function for keyboard navigation logic
  const handleKeyboardNavigation = (key: string, target: HTMLElement, event: React.KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(key)) {
      event.preventDefault();

      const currentSlot = target.closest('[role="button"][aria-label*="Time slot"]') as HTMLElement;
      if (!currentSlot) return;

      // Use live DOM query for keyboard navigation (more reliable in tests)
      const allSlots = Array.from(document.querySelectorAll('[role="button"][aria-label*="Time slot"]')) as HTMLElement[];
      const currentIndex = allSlots.indexOf(currentSlot);

      if (currentIndex === -1) return;

      let newIndex = currentIndex;

      switch (key) {
        case 'ArrowUp':
          newIndex = Math.max(0, currentIndex - 1);
          break;
        case 'ArrowDown':
          newIndex = Math.min(allSlots.length - 1, currentIndex + 1);
          break;
        case 'ArrowLeft':
          // Navigate to previous column (practitioner/resource)
          if (view === CalendarViews.DAY) {
            const slotsPerColumn = timeSlots.length;
            const columnIndex = Math.floor(currentIndex / slotsPerColumn);
            const slotInColumn = currentIndex % slotsPerColumn;
            if (columnIndex > 0) {
              newIndex = (columnIndex - 1) * slotsPerColumn + slotInColumn;
            }
          }
          break;
        case 'ArrowRight':
          // Navigate to next column (practitioner/resource)
          if (view === CalendarViews.DAY) {
            const slotsPerColumn = timeSlots.length;
            const columnIndex = Math.floor(currentIndex / slotsPerColumn);
            const slotInColumn = currentIndex % slotsPerColumn;
            const totalColumns = selectedPractitioners.length + selectedResources.length;
            if (columnIndex < totalColumns - 1) {
              newIndex = (columnIndex + 1) * slotsPerColumn + slotInColumn;
            }
          }
          break;
        case 'Enter':
        case ' ': {
          // For keyboard activation, directly initiate appointment flow for accessibility
          const ariaLabel = currentSlot.getAttribute('aria-label');
          if (ariaLabel) {
            const timeMatch = ariaLabel.match(/Time slot (\d{1,2}):(\d{2})/);
            if (timeMatch && timeMatch[1] && timeMatch[2]) {
              const hour = parseInt(timeMatch[1], 10);
              const minute = parseInt(timeMatch[2], 10);

              // Extract practitioner ID from aria-label if present
              const practitionerMatch = ariaLabel.match(/for practitioner (\d+)/);
              const practitionerId = practitionerMatch && practitionerMatch[1]
                ? parseInt(practitionerMatch[1], 10)
                : undefined;

              if (onSlotClick) {
                const slotDate = createTimeSlotDate(currentDate, hour, minute);
                const slotInfo: { start: Date; end: Date; practitionerId?: number } = {
                  start: slotDate,
                  end: new Date(slotDate.getTime() + 15 * 60 * 1000),
                };
                if (practitionerId != null) slotInfo.practitionerId = practitionerId;
                onSlotClick(slotInfo);
              }
            }
          }
          break;
        }
      }

      if (newIndex !== currentIndex && newIndex >= 0 && newIndex < allSlots.length) {
        const targetSlot = allSlots[newIndex];
        if (targetSlot) {
          targetSlot.focus();
        }
      }
    }

    // Tab navigation for events
    if (key === 'Tab') {
      const events = Array.from(document.querySelectorAll('.calendar-event, .exception-layer')) as HTMLElement[];
      if (events.length > 0) {
        const currentEvent = target.closest('.calendar-event, .exception-layer') as HTMLElement;
        if (currentEvent && event.shiftKey) {
          // Shift+Tab: move to previous event
          const currentIndex = events.indexOf(currentEvent);
          if (currentIndex > 0) {
            const prevEvent = events[currentIndex - 1];
            if (prevEvent) {
              event.preventDefault();
              prevEvent.focus();
            }
          }
        } else if (currentEvent && !event.shiftKey) {
          // Tab: move to next event
          const currentIndex = events.indexOf(currentEvent);
          if (currentIndex >= 0 && currentIndex < events.length - 1) {
            const nextEvent = events[currentIndex + 1];
            if (nextEvent) {
              event.preventDefault();
              nextEvent.focus();
            }
          }
        }
      }
    }
  };

  if (view === 'month') {
    return (
      <MonthlyCalendarGrid
        currentDate={currentDate}
        events={events}
        selectedPractitioners={selectedPractitioners}
        selectedResources={selectedResources}
        onEventClick={onEventClick || (() => { })}
      />
    );
  }

  return (
    <div className={styles.calendarGridContainer} data-testid="calendar-grid-container" style={{ position: 'relative' }}>
      {/* Header Row: Sticky Top */}
      <PractitionerRow
        view={view}
        currentDate={currentDate}
        events={events}
        selectedPractitioners={selectedPractitioners}
        selectedResources={selectedResources}
        practitioners={practitioners}
        resources={resources}
        practitionerAvailability={practitionerAvailability}
        currentUserId={currentUserId ?? null}
        onEventClick={onEventClick || (() => { })}
        onSlotClick={onSlotClick || (() => { })}
      />

      {/* Body Area: Time Column (Sticky Left) + Grid */}
      <div className={styles.gridLayer}>
        <div className={styles.timeColumn} id="time-labels">
          {(view === CalendarViews.DAY || view === CalendarViews.WEEK) &&
            timeSlots
              .filter((_, index) => index % 4 === 0) // Show label every 4 slots (every hour)
              .map((slot, index) => (
                <div key={index} className={styles.timeLabel}>
                  {slot.hour === 0 ? (
                    <span></span> // Empty span for hour 0, matching mock UI
                  ) : (
                    <span>{slot.hour}</span> // Just the hour number, no ":00"
                  )}
                </div>
              ))}
        </div>
        <div
          className={styles.calendarGrid}
          role="grid"
          aria-label="Calendar grid showing appointments and time slots"
          aria-rowcount={timeSlots.length + 1} // +1 for header
          aria-colcount={
            selectedPractitioners.length + selectedResources.length > 0
              ? selectedPractitioners.length + selectedResources.length + 1 // +1 for time column
              : (view === CalendarViews.DAY ? 2 : 8) // +1 for time column, +1 for empty day column or +7 for empty week columns
          }
          tabIndex={0}
        >
          {/* Current time indicator */}
          <div
            className={styles.timeIndicator}
            style={currentTimeIndicatorStyle}
            aria-label="Current time indicator"
            data-testid="current-time-indicator"
          />

          <div className="grid-container" role="presentation">
            {/* Resource columns */}
            <div className={styles.resourceGrid}>
              {practitionerGroups.map(({ practitionerId, groups }) => (
                <div
                  key={`practitioner-${practitionerId}`}
                  className={styles.practitionerColumn}
                  role="gridcell"
                  aria-label={`Column for practitioner ${practitionerId}`}
                >
                  {timeSlots.map((slot, index) => {
                    const isAvailable = isTimeSlotAvailable(
                      practitionerId,
                      currentDate,
                      slot.hour,
                      slot.minute,
                      practitionerAvailability,
                      false // Always check practitioner schedules, not business hours
                    );

                    return (
                      <div
                        key={index}
                        className={`${styles.timeSlot} ${!isAvailable ? styles.unavailable : ''}`}
                        onClick={(e) => handleSlotClick(slot.hour, slot.minute, practitionerId, e)}
                        onKeyDown={handleKeyDown}
                        role="button"
                        aria-label={`Time slot ${slot.time} for practitioner ${practitionerId} - Click to create appointment`}
                        data-testid="time-slot"
                        tabIndex={-1}
                      />
                    );
                  })}
                  {/* Render single events (full width) */}
                  {groups
                    .filter(group => group.events.length === 1)
                    .map((group, groupIndex) => (
                      <OverlappingEventGroupComponent
                        key={`single-${practitionerId}-${groupIndex}`}
                        group={group}
                        groupIndex={groupIndex}
                        selectedPractitioners={selectedPractitioners}
                        selectedResources={selectedResources}
                        onEventClick={onEventClick || (() => { })}
                      />
                    ))}

                  {/* Render overlapping event groups (multiple events) */}
                  {groups
                    .filter(group => group.events.length > 1)
                    .map((group, groupIndex) => (
                      <OverlappingEventGroupComponent
                        key={`group-${practitionerId}-${groupIndex}`}
                        group={group}
                        groupIndex={groupIndex}
                        selectedPractitioners={selectedPractitioners}
                        selectedResources={selectedResources}
                        onEventClick={onEventClick || (() => { })}
                      />
                    ))}
                </div>
              ))}

              {resourceGroups.map(({ resourceId, groups }) => (
                <div
                  key={`resource-${resourceId}`}
                  className={styles.practitionerColumn}
                  role="gridcell"
                  aria-label={`Column for resource ${resourceId}`}
                >
                  {timeSlots.map((slot, index) => {
                    // Resources should follow practitioner availability to prevent double bookings
                    // Check if any selected practitioner is available at this time slot
                    const isAnyPractitionerAvailable = selectedPractitioners.some(practitionerId => {
                      return isTimeSlotAvailable(
                        practitionerId,
                        currentDate,
                        slot.hour,
                        slot.minute,
                        practitionerAvailability,
                        false // Always check practitioner availability, never use business hours
                      );
                    });

                    return (
                      <div
                        key={index}
                        className={`${styles.timeSlot} ${!isAnyPractitionerAvailable ? styles.unavailable : ''}`}
                        onClick={(e) => handleSlotClick(slot.hour, slot.minute, undefined, e)}
                        onKeyDown={handleKeyDown}
                        role="button"
                        aria-label={`Time slot ${slot.time} for resource ${resourceId} - Click to create appointment`}
                        data-testid="time-slot"
                        tabIndex={-1}
                      />
                    );
                  })}
                  {/* Render single events (full width) */}
                  {groups
                    .filter(group => group.events.length === 1)
                    .map((group, groupIndex) => (
                      <CalendarEventComponent
                        key={`single-${resourceId}-${groupIndex}`}
                        event={group.events[0]!}
                        selectedPractitioners={selectedPractitioners}
                        selectedResources={selectedResources}
                        onClick={() => onEventClick?.(group.events[0]!)}
                      />
                    ))}

                  {/* Render overlapping event groups (multiple events) */}
                  {groups
                    .filter(group => group.events.length > 1)
                    .map((group, groupIndex) => (
                      <OverlappingEventGroupComponent
                        key={`group-${resourceId}-${groupIndex}`}
                        group={group}
                        groupIndex={groupIndex}
                        selectedPractitioners={selectedPractitioners}
                        selectedResources={selectedResources}
                        onEventClick={onEventClick || (() => { })}
                      />
                    ))}
                </div>
              ))}

              {/* Render empty columns when no practitioners or resources are selected */}
              {practitionerGroups.length === 0 && resourceGroups.length === 0 && (
                view === CalendarViews.DAY ? (
                  // For Day View: render a single empty column
                  <div
                    key="empty-day-column"
                    className={styles.practitionerColumn}
                    role="gridcell"
                    aria-label="Empty calendar column"
                  >
                    {timeSlots.map((slot, index) => (
                      <div
                        key={index}
                        className={styles.timeSlot}
                        onClick={(e) => handleSlotClick(slot.hour, slot.minute, undefined, e)}
                        onKeyDown={handleKeyDown}
                        role="button"
                        aria-label="Time slot - Click to create appointment"
                        data-testid="time-slot"
                        tabIndex={-1}
                      />
                    ))}
                  </div>
                ) : view === CalendarViews.WEEK ? (
                  // For Week View: render 7 empty columns (one for each day)
                  <>
                    {Array.from({ length: 7 }, (_, dayIndex) => {
                      const dayDate = moment(currentDate).startOf('week').add(dayIndex, 'days');
                      return (
                        <div
                          key={`empty-week-column-${dayIndex}`}
                          className={styles.practitionerColumn}
                          role="gridcell"
                          aria-label={`Empty column for ${dayDate.format('dddd')}`}
                        >
                          {timeSlots.map((slot, index) => (
                            <div
                              key={index}
                              className={styles.timeSlot}
                              onClick={(e) => handleSlotClick(slot.hour, slot.minute, undefined, e)}
                              onKeyDown={handleKeyDown}
                              role="button"
                              aria-label={`Time slot ${slot.time} on ${dayDate.format('dddd')} - Click to create appointment`}
                              data-testid="time-slot"
                              tabIndex={-1}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </>
                ) : null
              )}
            </div>
          </div>
        </div>
        {slotMenu.visible && slotMenu.slotInfo && (
          (() => {
            const menu = (
              <div
                data-testid="slot-action-menu"
                ref={slotMenuRef}
                style={{
                  position: 'absolute',
                  left: slotMenu.x,
                  top: slotMenu.y,
                  zIndex: 1000,
                  whiteSpace: 'nowrap',
                }}
              >
                <div className="flex flex-col gap-2">
                  <button
                    data-testid="fab-create-appointment"
                    className="btn-secondary px-3 py-1 text-sm rounded-full shadow whitespace-nowrap"
                    onClick={() => {
                      onSlotClick?.(slotMenu.slotInfo!);
                      setSlotMenu(menu => ({ ...menu, visible: false }));
                    }}
                    aria-label="Create appointment"
                  >
                    + 預約
                  </button>
                  <button
                    data-testid="fab-create-exception"
                    className="btn-secondary px-3 py-1 text-sm rounded-full shadow whitespace-nowrap"
                    onClick={() => {
                      onSlotExceptionClick?.(slotMenu.slotInfo!);
                      setSlotMenu(menu => ({ ...menu, visible: false }));
                    }}
                    aria-label="Create availability exception"
                  >
                    + 休診
                  </button>
                </div>
              </div>
            );
            return viewportEl ? createPortal(menu, viewportEl) : menu;
          })()
        )}
      </div>
    </div>
  );
};

// Event component
interface CalendarEventComponentProps {
  event: CalendarEvent;
  selectedPractitioners: number[];
  selectedResources: number[];
  onClick: () => void;
  group?: OverlappingEventGroup;
  groupIndex?: number;
  eventIndex?: number;
}

const CalendarEventComponent: React.FC<CalendarEventComponentProps> = ({
  event,
  selectedPractitioners,
  selectedResources,
  onClick,
  group,
  groupIndex = 0,
  eventIndex = 0
}) => {
  const eventStyle = useMemo(() => {
    let baseStyle;

    if (group) {
      // Use overlapping positioning
      baseStyle = calculateEventInGroupPosition(event, group, eventIndex);
    } else {
      // Use regular positioning (for monthly view or non-overlapping)
      const position = calculateEventPosition(event.start);
      const size = calculateEventHeight(event.start, event.end);
      baseStyle = {
        ...position,
        ...size,
        left: 0,
        width: '100%'
      };
    }


    // Determine background color and border styling
    let backgroundColor = '#6b7280'; // default gray
    let border = 'none';
    let borderRadius = '8px';

    if (event.resource.practitioner_id) {
      backgroundColor = getPractitionerColor(event.resource.practitioner_id, -1, selectedPractitioners) || '#6b7280';
    } else if (event.resource.resource_id) {
      backgroundColor = getResourceColorById(event.resource.resource_id, selectedResources) || '#6b7280';
      // Resource events get dashed border as per design
      border = '1px dashed rgba(255, 255, 255, 0.5)';
    }

    // Exception events get medium gray background with practitioner-colored solid border
    if (event.resource.type === 'availability_exception') {
      backgroundColor = '#9ca3af';
      const practitionerColor = event.resource.practitioner_id
        ? getPractitionerColor(event.resource.practitioner_id, -1, selectedPractitioners) || '#6b7280'
        : '#6b7280';
      border = `2px solid ${practitionerColor}`;
      borderRadius = '4px';
    }

    // Determine z-index based on event type hierarchy:
    // Current time indicator (15) > Appointments (5) > Availability exceptions (3)
    let zIndex = 5; // Default for appointments
    if (event.resource.type === 'availability_exception') {
      zIndex = 3; // Exceptions get lowest priority
    }

    return {
      ...baseStyle,
      backgroundColor,
      border,
      borderRadius,
      zIndex,
    };
  }, [event, group, groupIndex, eventIndex, selectedPractitioners, selectedResources]);

  // Calculate display text and tooltip
  const finalDisplayText = calculateEventDisplayText(event);
  const tooltipText = buildEventTooltipText(event, formatAppointmentTimeRange(event.start, event.end));

  return (
    <div
      className={styles.calendarEvent}
      style={eventStyle}
      onClick={onClick}
      title={tooltipText}
      role="button"
      aria-label={`Appointment: ${finalDisplayText} - Click to view details`}
      tabIndex={-1}
      data-testid="calendar-event"
    >
      <div className="flex items-start space-x-1 h-full">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-white font-medium" style={{ lineHeight: '1.2' }}>
            {finalDisplayText}
          </div>
        </div>
      </div>
    </div>
  );
};

// Monthly Calendar Grid Component
interface MonthlyCalendarGridProps {
  currentDate: Date;
  events: CalendarEvent[];
  selectedPractitioners: number[];
  selectedResources: number[];
  onEventClick?: (event: CalendarEvent) => void;
}

const MonthlyCalendarGrid: React.FC<MonthlyCalendarGridProps> = ({
  currentDate,
  events,
  selectedPractitioners,
  selectedResources,
  onEventClick,
}) => {
  const month = moment(currentDate).tz('Asia/Taipei');
  const monthStart = month.clone().startOf('month');
  const monthEnd = month.clone().endOf('month');
  const calendarStart = monthStart.clone().startOf('week');
  const calendarEnd = monthEnd.clone().endOf('week');

  // Generate calendar days
  const calendarDays = useMemo(() => {
    const days = [];
    let current = calendarStart.clone();

    while (current.isSameOrBefore(calendarEnd)) {
      const dayEvents = events.filter(event =>
        moment(event.start).tz('Asia/Taipei').isSame(current, 'day')
      );

      days.push({
        date: current.clone(),
        events: dayEvents,
        isCurrentMonth: current.month() === month.month(),
        isToday: current.isSame(moment().tz('Asia/Taipei'), 'day'),
      });

      current = current.clone().add(1, 'day');
    }

    return days;
  }, [calendarStart, calendarEnd, events, month]);

  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

  // Group days into weeks
  const weeks = [];
  for (let i = 0; i < calendarDays.length; i += 7) {
    weeks.push(calendarDays.slice(i, i + 7));
  }

  return (
    <div className={styles.monthlyGrid}>
      {/* Weekday headers */}
      <div className={styles.monthlyHeader}>
        {weekDays.map(day => (
          <div key={day} className={styles.weekdayHeader}>
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className={styles.monthlyCalendar}>
        {calendarDays.map((day, index) => (
          <div
            key={`${day.date.format('YYYY-MM-DD')}-${index}`}
            className={`${styles.dayCell} ${!day.isCurrentMonth ? styles.otherMonth : ''} ${day.isToday ? styles.today : ''}`}
          >
            <div className={styles.dayNumber}>
              {day.date.date()}
            </div>
            <div className={styles.dayEvents}>
              {day.events.slice(0, 3).map((event, eventIndex) => {
                let backgroundColor = '#6b7280';
                if (event.resource.practitioner_id) {
                  backgroundColor = getPractitionerColor(event.resource.practitioner_id, -1, selectedPractitioners) || '#6b7280';
                } else if (event.resource.resource_id) {
                  backgroundColor = getResourceColorById(event.resource.resource_id, selectedResources) || '#6b7280';
                }

                // Calculate display text and tooltip
                const finalDisplayText = calculateEventDisplayText(event);
                const tooltipText = buildEventTooltipText(event, formatAppointmentTimeRange(event.start, event.end));

                return (
                  <div
                    key={`${day.date.format('YYYY-MM-DD')}-${event.id}-${eventIndex}`}
                    className={styles.monthEvent}
                    style={{ backgroundColor }}
                    onClick={() => onEventClick && onEventClick(event)}
                    title={tooltipText}
                    data-testid="calendar-event"
                  >
                    <div className="text-xs truncate">
                      {finalDisplayText}
                    </div>
                  </div>
                );
              })}
              {day.events.length > 3 && (
                <div className={styles.monthEvent} style={{ backgroundColor: '#9ca3af' }}>
                  +{day.events.length - 3} 更多
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Overlapping Event Group Component
interface OverlappingEventGroupProps {
  group: OverlappingEventGroup;
  groupIndex: number;
  selectedPractitioners: number[];
  selectedResources: number[];
  onEventClick: (event: CalendarEvent) => void;
}

const OverlappingEventGroupComponent: React.FC<OverlappingEventGroupProps> = ({
  group,
  groupIndex,
  selectedPractitioners,
  selectedResources,
  onEventClick,
}) => {
  return (
    <>
      {group.events.map((event, eventIndex) => (
        <CalendarEventComponent
          key={event.id}
          event={event}
          selectedPractitioners={selectedPractitioners}
          selectedResources={selectedResources}
          group={group}
          groupIndex={groupIndex}
          eventIndex={eventIndex}
          onClick={() => onEventClick?.(event)}
        />
      ))}
    </>
  );
};

// Separate component for just the practitioner/resource header row
export const PractitionerRow: React.FC<Omit<CalendarGridProps, 'showHeaderRow'>> = (props) => {
  const {
    view,
    currentDate,
    selectedPractitioners,
    selectedResources,
    practitioners = EMPTY_ARRAY,
    resources = EMPTY_ARRAY,
  } = props;

  return (
    <div className={styles.headerRow} data-testid="calendar-header-row">
      <div className={styles.timeCorner} data-testid="calendar-time-corner"></div>
      <div
        className={styles.resourceHeaders}
        id="resource-headers"
      >
        {/* Render practitioner and resource headers */}
        {(() => {
          if (view === CalendarViews.DAY) {
            return (
              <>
                {selectedPractitioners.map(practitionerId => {
                  const practitioner = practitioners.find(p => p.id === practitionerId);
                  return (
                    <div key={`practitioner-${practitionerId}`} className={styles.resourceHeader}>
                      {practitioner?.full_name || `Practitioner ${practitionerId}`}
                    </div>
                  );
                })}
                {selectedResources.map(resourceId => {
                  const resource = resources.find(r => r.id === resourceId);
                  return (
                    <div key={`resource-${resourceId}`} className={styles.resourceHeader}>
                      {resource?.name || `Resource ${resourceId}`}
                    </div>
                  );
                })}
              </>
            );
          }

          if (view === CalendarViews.WEEK) {
            return (
              Array.from({ length: 7 }, (_, i) => {
                const date = moment(currentDate).startOf('week').add(i, 'days');
                return (
                  <div key={`day-${i}`} className={styles.resourceHeader}>
                    {date.format('ddd')}
                    <div className={styles.dayNumber}>{date.format('D')}</div>
                  </div>
                );
              })
            );
          }

          if (view === 'month') {
            return (
              Array.from({ length: 7 }, (_, i) => {
                const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
                return (
                  <div key={`day-${i}`} className={styles.resourceHeader}>
                    {dayNames[i]}
                  </div>
                );
              })
            );
          }

          return null;
        })()}
      </div>
    </div>
  );
};

export default CalendarGrid;
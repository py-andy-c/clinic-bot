import React, { useMemo, useRef, useEffect, useCallback } from 'react';
import moment from 'moment-timezone';
import { CalendarEvent } from '../../utils/calendarDataAdapter';
import { CalendarView, CalendarViews } from '../../types/calendar';
import { getPractitionerColor } from '../../utils/practitionerColors';
import { getResourceColorById } from '../../utils/resourceColorUtils';
import { logger } from '../../utils/logger';
import {
  generateTimeSlots,
  calculateCurrentTimeIndicatorPosition,
  createTimeSlotDate,
  calculateEventPosition,
  calculateEventHeight,
  calculateOverlappingEvents,
  calculateEventInGroupPosition,
  OverlappingEventGroup,
  getCurrentTaiwanTime,
} from '../../utils/calendarGridUtils';
import styles from './CalendarGrid.module.css';

// Calendar configuration constants
const CALENDAR_CONFIG = {
  SLOT_DURATION_MINUTES: 15,
  SLOT_HEIGHT_PX: 20,
  SCROLL_BUFFER_PX: 100,
  BUSINESS_HOURS_START: 8, // 8 AM
  BUSINESS_HOURS_END: 22, // 10 PM
} as const;

interface CalendarGridProps {
  view: CalendarView;
  currentDate: Date;
  events: CalendarEvent[];
  selectedPractitioners: number[];
  selectedResources: number[];
  onEventClick?: (event: CalendarEvent) => void;
  onSlotClick?: (slotInfo: { start: Date; end: Date }) => void;
  scrollToCurrentTime?: boolean; // Trigger to scroll to current time
}

const CalendarGrid: React.FC<CalendarGridProps> = ({
  view,
  currentDate,
  events,
  selectedPractitioners,
  selectedResources,
  onEventClick,
  onSlotClick,
  scrollToCurrentTime = false,
}) => {
  const gridRef = useRef<HTMLDivElement>(null);

  // Generate time slots for the grid
  const timeSlots = useMemo(() => generateTimeSlots(), []);

  // Scroll to current time functionality
  const scrollToCurrentTimePosition = useCallback(() => {
    if (!gridRef.current) return;

    const now = getCurrentTaiwanTime();
    const today = moment(currentDate).tz('Asia/Taipei').startOf('day');

    // Only scroll if we're viewing today
    if (!now.isSame(today, 'day')) return;

    const hours = now.hour();
    const minutes = now.minute();

    // Only scroll between business hours
    if (hours < CALENDAR_CONFIG.BUSINESS_HOURS_START || hours > CALENDAR_CONFIG.BUSINESS_HOURS_END) return;

    // Calculate position: (hours from start * 60 + minutes) / slot_duration * slot_height
    const minutesFromStart = (hours - CALENDAR_CONFIG.BUSINESS_HOURS_START) * 60 + minutes;
    const pixelsFromTop = (minutesFromStart / CALENDAR_CONFIG.SLOT_DURATION_MINUTES) * CALENDAR_CONFIG.SLOT_HEIGHT_PX;

    // Add buffer to show context above current time
    const scrollPosition = Math.max(0, pixelsFromTop - CALENDAR_CONFIG.SCROLL_BUFFER_PX);

    gridRef.current.scrollTo({
      top: scrollPosition,
      behavior: 'smooth'
    });
  }, [currentDate]);

  // Auto-scroll on mount and when currentDate changes to today
  useEffect(() => {
    // Small delay to ensure DOM is rendered
    const timeoutId = setTimeout(() => {
      scrollToCurrentTimePosition();
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [currentDate, scrollToCurrentTimePosition]);

  // Scroll when triggered from outside (e.g., today button)
  useEffect(() => {
    if (scrollToCurrentTime) {
      scrollToCurrentTimePosition();
    }
  }, [scrollToCurrentTime, scrollToCurrentTimePosition]);

  // Calculate current time indicator position
  const currentTimeIndicatorStyle = useMemo(
    () => calculateCurrentTimeIndicatorPosition(currentDate, view),
    [currentDate, view]
  );

  // Memoize overlapping groups calculation for performance
  const practitionerGroups = useMemo(() =>
    selectedPractitioners.map(practitionerId => ({
      practitionerId,
      events: events.filter(event => event.resource.practitioner_id === practitionerId),
      groups: calculateOverlappingEvents(
        events.filter(event => event.resource.practitioner_id === practitionerId)
      )
    })), [selectedPractitioners, events]);

  const resourceGroups = useMemo(() =>
    selectedResources.map(resourceId => ({
      resourceId,
      events: events.filter(event => event.resource.resource_id === resourceId),
      groups: calculateOverlappingEvents(
        events.filter(event => event.resource.resource_id === resourceId)
      )
    })), [selectedResources, events]);

  const handleSlotClick = (hour: number, minute: number) => {
    if (onSlotClick) {
      const slotDate = createTimeSlotDate(currentDate, hour, minute);
      onSlotClick({
        start: slotDate,
        end: new Date(slotDate.getTime() + 15 * 60 * 1000), // 15 minutes later
      });
    }
  };

  // Keyboard navigation support
  const handleKeyDown = (event: React.KeyboardEvent) => {
    const { key } = event;
    const target = event.target as HTMLElement;

    // Only handle keyboard navigation if we're in the calendar grid
    if (!gridRef.current || !gridRef.current.contains(target)) return;

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(key)) {
      event.preventDefault();

      const currentSlot = target.closest('[role="button"][aria-label*="Time slot"]') as HTMLElement;
      if (!currentSlot) return;

      const allSlots = Array.from(gridRef.current.querySelectorAll('[role="button"][aria-label*="Time slot"]')) as HTMLElement[];
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
        case ' ':
          // Trigger slot click by calling handleSlotClick with extracted time
          const ariaLabel = currentSlot.getAttribute('aria-label');
          if (ariaLabel) {
            const timeMatch = ariaLabel.match(/Time slot (\d{1,2}):(\d{2})/);
            if (timeMatch && timeMatch[1] && timeMatch[2]) {
              const hour = parseInt(timeMatch[1], 10);
              const minute = parseInt(timeMatch[2], 10);
              handleSlotClick(hour, minute);
            } else {
              logger.warn('CalendarGrid: Failed to parse time from aria-label:', ariaLabel);
            }
          } else {
            logger.warn('CalendarGrid: No aria-label found on time slot element');
          }
          return;
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
      const events = Array.from(gridRef.current.querySelectorAll('.calendar-event, .exception-layer')) as HTMLElement[];
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

  if (view === CalendarViews.MONTH) {
    return <MonthlyCalendarGrid currentDate={currentDate} events={events} onEventClick={onEventClick || (() => {})} />;
  }

  return (
    <div className={styles.calendarViewport} id="main-viewport" data-testid="calendar-grid">
      <div className={styles.calendarGridContainer}>
        {/* Header Row: Sticky Top */}
        <div className={styles.headerRow}>
          <div className={styles.timeCorner}></div>
          <div className={styles.resourceHeaders} id="resource-headers">
            {/* Headers will be populated by renderHeaders() */}
          </div>
        </div>

        {/* Body Area: Time Column (Sticky Left) + Grid */}
        <div className={styles.gridLayer}>
          <div className={styles.timeColumn} id="time-labels">
            {(view === CalendarViews.DAY || view === CalendarViews.WEEK) &&
              timeSlots.map((slot, index) => (
                <div key={index} className={styles.timeLabel}>
                  {slot.minute === 0 && slot.hour >= 8 && slot.hour <= 22 && (
                    <span>{slot.hour > 12 ? slot.hour - 12 : slot.hour}</span>
                  )}
                </div>
              ))}
          </div>
          <div
            className={styles.calendarGrid}
            ref={gridRef}
            role="grid"
            aria-label="Calendar grid showing appointments and time slots"
            aria-rowcount={timeSlots.length + 1} // +1 for header
            aria-colcount={selectedPractitioners.length + selectedResources.length + 1} // +1 for time column
            tabIndex={0}
            onKeyDown={handleKeyDown}
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
                    {timeSlots.map((slot, index) => (
                      <div
                        key={index}
                        className={styles.timeSlot}
                        onClick={() => handleSlotClick(slot.hour, slot.minute)}
                        role="button"
                        aria-label={`Time slot ${slot.time} for practitioner ${practitionerId} - Click to create appointment`}
                        data-testid="time-slot"
                        tabIndex={-1}
                      />
                    ))}
                    {/* Render overlapping event groups */}
                    {groups.map((group, groupIndex) => (
                      <OverlappingEventGroupComponent
                        key={`group-${practitionerId}-${groupIndex}`}
                        group={group}
                        groupIndex={groupIndex}
                        onEventClick={onEventClick || (() => {})}
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
                    {timeSlots.map((slot, index) => (
                      <div
                        key={index}
                        className={styles.timeSlot}
                        onClick={() => handleSlotClick(slot.hour, slot.minute)}
                        role="button"
                        aria-label={`Time slot ${slot.time} for resource ${resourceId} - Click to create appointment`}
                        data-testid="time-slot"
                        tabIndex={-1}
                      />
                    ))}
                    {/* Render overlapping event groups */}
                    {groups.map((group, groupIndex) => (
                      <OverlappingEventGroupComponent
                        key={`group-${resourceId}-${groupIndex}`}
                        group={group}
                        groupIndex={groupIndex}
                        onEventClick={onEventClick || (() => {})}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Event component
interface CalendarEventComponentProps {
  event: CalendarEvent;
  onClick: () => void;
  group?: OverlappingEventGroup;
  groupIndex?: number;
  eventIndex?: number;
}

const CalendarEventComponent: React.FC<CalendarEventComponentProps> = ({
  event,
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
      baseStyle = { ...position, ...size };
    }

    // Determine background color and border styling
    let backgroundColor = '#6b7280'; // default gray
    let border = 'none';
    let borderRadius = '8px';

    if (event.resource.practitioner_id) {
      backgroundColor = getPractitionerColor(event.resource.practitioner_id, 0, []) || '#6b7280';
    } else if (event.resource.resource_id) {
      backgroundColor = getResourceColorById(event.resource.resource_id, [], [], null) || '#6b7280';
      // Resource events get dashed border as per design
      border = '1px dashed rgba(255, 255, 255, 0.5)';
    }

    // Exception events get gray background and dashed border
    if (event.resource.type === 'availability_exception') {
      backgroundColor = '#6b7280';
      border = '1px dashed #9ca3af';
      borderRadius = '4px';
    }

    return {
      ...baseStyle,
      backgroundColor,
      border,
      borderRadius,
    };
  }, [event, group, groupIndex, eventIndex]);

  return (
    <div
      className={styles.calendarEvent}
      style={eventStyle}
      onClick={onClick}
      title={`${event.title} - ${event.resource.patient_name || 'No patient'}`}
      role="button"
      aria-label={`Appointment: ${event.title} with ${event.resource.patient_name || 'no patient'} - Click to view details`}
      tabIndex={-1}
      data-testid="calendar-event"
    >
      {event.title}
    </div>
  );
};

// Monthly Calendar Grid Component
interface MonthlyCalendarGridProps {
  currentDate: Date;
  events: CalendarEvent[];
  onEventClick?: (event: CalendarEvent) => void;
}

const MonthlyCalendarGrid: React.FC<MonthlyCalendarGridProps> = ({
  currentDate,
  events,
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

  const weekDays = ['一', '二', '三', '四', '五', '六', '日'];

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
            key={index}
            className={`${styles.dayCell} ${!day.isCurrentMonth ? styles.otherMonth : ''} ${day.isToday ? styles.today : ''}`}
          >
            <div className={styles.dayNumber}>
              {day.date.date()}
            </div>
            <div className={styles.dayEvents}>
              {day.events.slice(0, 3).map((event) => {
                let backgroundColor = '#6b7280';
                if (event.resource.practitioner_id) {
                  backgroundColor = getPractitionerColor(event.resource.practitioner_id, 0, []) || '#6b7280';
                } else if (event.resource.resource_id) {
                  backgroundColor = getResourceColorById(event.resource.resource_id, [], [], null) || '#6b7280';
                }

                return (
                  <div
                    key={event.id}
                    className={styles.monthEvent}
                    style={{ backgroundColor }}
                    onClick={() => onEventClick && onEventClick(event)}
                    title={event.title}
                    data-testid="calendar-event"
                  >
                    {event.title}
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
  onEventClick: (event: CalendarEvent) => void;
}

const OverlappingEventGroupComponent: React.FC<OverlappingEventGroupProps> = ({
  group,
  groupIndex,
  onEventClick,
}) => {
  return (
    <>
      {group.events.map((event, eventIndex) => (
        <CalendarEventComponent
          key={event.id}
          event={event}
          group={group}
          groupIndex={groupIndex}
          eventIndex={eventIndex}
          onClick={() => onEventClick?.(event)}
        />
      ))}
    </>
  );
};

export default CalendarGrid;
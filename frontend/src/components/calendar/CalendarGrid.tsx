import React, { useMemo, useEffect, useCallback, useState } from 'react';
import moment from 'moment-timezone';
import { CalendarEvent } from '../../utils/calendarDataAdapter';
import { CalendarView, CalendarViews } from '../../types/calendar';
import { getPractitionerColor } from '../../utils/practitionerColors';
import { getResourceColorById } from '../../utils/resourceColorUtils';
import { logger } from '../../utils/logger';
import { getCachedElements, invalidateCalendarCache } from '../../utils/domCache';
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
import { CalendarPractitionerAvailability, isTimeSlotAvailable } from '../../utils/practitionerAvailability';
import styles from './CalendarGrid.module.css';

// Calendar configuration constants
const CALENDAR_CONFIG = {
  SLOT_DURATION_MINUTES: 15,
  SLOT_HEIGHT_PX: 20,
  SCROLL_BUFFER_PX: 100
} as const;

interface CalendarGridProps {
  view: CalendarView;
  currentDate: Date;
  events: CalendarEvent[];
  selectedPractitioners: number[];
  selectedResources: number[];
  practitioners?: Array<{ id: number; full_name: string }>; // Practitioner data
  resources?: Array<{ id: number; name: string }>; // Resource data
  practitionerAvailability?: CalendarPractitionerAvailability; // Practitioner availability data
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
  practitioners = [],
  resources = [],
  practitionerAvailability = {},
  onEventClick,
  onSlotClick,
  scrollToCurrentTime = false,
}) => {


  // Generate time slots for the grid
  const timeSlots = useMemo(() => generateTimeSlots(), []);

  // DOM element caching for performance optimization
  const [cachedElements, setCachedElements] = useState<Record<string, Element | null>>({});

  useEffect(() => {
    // Cache frequently accessed DOM elements on mount
    const elements = getCachedElements([
      'MAIN_VIEWPORT',
      'CALENDAR_GRID',
      'RESOURCE_HEADERS',
      'TIME_LABELS',
      'SIDEBAR',
      'DATE_STRIP',
      'CURRENT_TIME_INDICATOR'
    ]);

    setCachedElements(elements);

    logger.info('CalendarGrid: Cached frequently accessed DOM elements', {
      cachedCount: Object.values(elements).filter(el => el !== null).length
    });

    // Cleanup cache on unmount
    return () => {
      invalidateCalendarCache();
    };
  }, []); // Only run on mount

  // Scroll to current time functionality
  const scrollToCurrentTimePosition = useCallback(() => {
    // Use cached element if available, otherwise fall back to querySelector for compatibility
    const gridElement = (cachedElements.CALENDAR_GRID as HTMLElement) ||
                       (document.querySelector('.calendarGrid') as HTMLElement);
    if (!gridElement) return;

    const now = getCurrentTaiwanTime();
    const today = moment(currentDate).tz('Asia/Taipei').startOf('day');

    // Only scroll if we're viewing today
    if (!now.isSame(today, 'day')) return;

    const hours = now.hour();
    const minutes = now.minute();

    // Scroll for full 24-hour day (no business hour restrictions)

    // Calculate position: (hours from 0 AM * 60 + minutes) / slot_duration * slot_height
    const minutesFromMidnight = (hours - 0) * 60 + minutes;
    const pixelsFromTop = (minutesFromMidnight / CALENDAR_CONFIG.SLOT_DURATION_MINUTES) * CALENDAR_CONFIG.SLOT_HEIGHT_PX;

    // Add buffer to show context above current time
    const scrollPosition = Math.max(0, pixelsFromTop - CALENDAR_CONFIG.SCROLL_BUFFER_PX);

    gridElement.scrollTo({
      top: scrollPosition,
      behavior: 'smooth'
    });
  }, [currentDate, cachedElements]);

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
    selectedPractitioners.map(practitionerId => {
      const practitionerEvents = events.filter(event => event.resource.practitioner_id === practitionerId);

      return {
        practitionerId,
        events: practitionerEvents,
        groups: calculateOverlappingEvents(practitionerEvents)
      };
    }), [selectedPractitioners, events]);

  const resourceGroups = useMemo(() =>
    selectedResources.map(resourceId => {
      const resourceEvents = events.filter(event => event.resource.resource_id === resourceId);

      return {
        resourceId,
        events: resourceEvents,
        groups: calculateOverlappingEvents(resourceEvents)
      };
    }), [selectedResources, events]);

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

    // Use cached element if available, otherwise fall back to querySelector for compatibility
    const gridElement = (cachedElements.CALENDAR_GRID as HTMLElement) ||
                       (document.querySelector('.calendarGrid') as HTMLElement);

    // Only handle keyboard navigation if we're in the calendar grid
    // For tests and edge cases, be more permissive
    if (gridElement && !gridElement.contains(target)) return;

    handleKeyboardNavigation(key, target, event, gridElement);
  };

  // Separate function for keyboard navigation logic that can work with or without grid element
  const handleKeyboardNavigation = (key: string, target: HTMLElement, event: React.KeyboardEvent, gridElement?: HTMLElement) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(key)) {
      event.preventDefault();

      const currentSlot = target.closest('[role="button"][aria-label*="Time slot"]') as HTMLElement;
      if (!currentSlot) return;

      // Find all time slots - use gridElement if available, otherwise search from document
      const searchRoot = gridElement || document;
      const allSlots = Array.from(searchRoot.querySelectorAll('[role="button"][aria-label*="Time slot"]')) as HTMLElement[];
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
          break;
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
      const searchRoot = gridElement || document;
      const events = Array.from(searchRoot.querySelectorAll('.calendar-event, .exception-layer')) as HTMLElement[];
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
        onEventClick={onEventClick || (() => {})}
      />
    );
  }


  return (
    <div className={styles.calendarViewport} id="main-viewport" data-testid="calendar-grid">
      <div className={styles.calendarGridContainer}>
        {/* Header Row: Sticky Top */}
        <div className={styles.headerRow} data-testid="calendar-header-row">
          <div className={styles.timeCorner} data-testid="calendar-time-corner"></div>
          <div className={styles.resourceHeaders} id="resource-headers">
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
                    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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
                          onClick={() => handleSlotClick(slot.hour, slot.minute)}
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
                        <CalendarEventComponent
                          key={`single-${practitionerId}-${groupIndex}`}
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
                          key={`group-${practitionerId}-${groupIndex}`}
                          group={group}
                          groupIndex={groupIndex}
                          selectedPractitioners={selectedPractitioners}
                          selectedResources={selectedResources}
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
                          onClick={() => handleSlotClick(slot.hour, slot.minute)}
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

                return (
                  <div
                    key={`${day.date.format('YYYY-MM-DD')}-${event.id}-${eventIndex}`}
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

export default CalendarGrid;
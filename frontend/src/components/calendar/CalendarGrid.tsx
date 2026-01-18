import React, { useMemo, useRef } from 'react';
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
  OverlappingEventGroup,
} from '../../utils/calendarGridUtils';
import styles from './CalendarGrid.module.css';

interface CalendarGridProps {
  view: CalendarView;
  currentDate: Date;
  events: CalendarEvent[];
  selectedPractitioners: number[];
  selectedResources: number[];
  onEventClick?: (event: CalendarEvent) => void;
  onSlotClick?: (slotInfo: { start: Date; end: Date }) => void;
}

const CalendarGrid: React.FC<CalendarGridProps> = ({
  view,
  currentDate,
  events,
  selectedPractitioners,
  selectedResources,
  onEventClick,
  onSlotClick,
}) => {
  const gridRef = useRef<HTMLDivElement>(null);

  // Generate time slots for the grid
  const timeSlots = useMemo(() => generateTimeSlots(), []);

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
    // Allow keyboard navigation within the calendar grid
    const { key } = event;

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(key)) {
      event.preventDefault();

      // Focus management for keyboard navigation would be implemented here
      // For now, we just prevent default behavior to avoid page scrolling
    }
  };

  if (view === CalendarViews.MONTH) {
    return <MonthlyCalendarGrid currentDate={currentDate} events={events} onEventClick={onEventClick || (() => {})} />;
  }

  return (
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
      />

      <div className="grid-container" role="presentation">
        {/* Time column */}
        <div className={styles.timeColumn}>
          {timeSlots.map((slot, index) => (
            <div key={index} className={styles.timeLabel}>
              {slot.minute === 0 && slot.hour >= 8 && slot.hour <= 22 && (
                <span>{slot.hour > 12 ? slot.hour - 12 : slot.hour}</span>
              )}
            </div>
          ))}
        </div>

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

  return (
    <div className={styles.monthlyGrid}>
      <style dangerouslySetInnerHTML={{
        __html: `
          .monthly-grid {
            padding: 16px;
            background: white;
          }

          .monthly-header {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            margin-bottom: 8px;
          }

          .weekday-header {
            text-align: center;
            font-weight: 600;
            color: #6b7280;
            padding: 8px;
            font-size: 12px;
          }

          .monthly-calendar {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 1px;
            background: #e5e7eb;
            border-radius: 8px;
            overflow: hidden;
          }

          .day-cell {
            background: white;
            min-height: 120px;
            padding: 4px;
            position: relative;
          }

          .day-cell.other-month {
            background: #f9fafb;
            color: #9ca3af;
          }

          .day-cell.today {
            background: #eff6ff;
          }

          .day-number {
            font-size: 12px;
            font-weight: 500;
            margin-bottom: 4px;
            color: inherit;
          }

          .month-event {
            font-size: 10px;
            padding: 1px 2px;
            margin-bottom: 1px;
            border-radius: 2px;
            color: white;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            cursor: pointer;
          }

          .month-event:hover {
            opacity: 0.8;
          }
        `
      }} />

      <div className="monthly-header">
        {weekDays.map(day => (
          <div key={day} className="weekday-header">
            {day}
          </div>
        ))}
      </div>

      <div className="monthly-calendar">
        {calendarDays.map((day, index) => (
          <div
            key={index}
            className={`day-cell ${!day.isCurrentMonth ? 'other-month' : ''} ${day.isToday ? 'today' : ''}`}
          >
            <div className="day-number">
              {day.date.date()}
            </div>
            <div>
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
                    className="month-event"
                    style={{ backgroundColor }}
                    onClick={() => onEventClick && onEventClick(event)}
                    title={event.title}
                  >
                    {event.title}
                  </div>
                );
              })}
              {day.events.length > 3 && (
                <div className="month-event" style={{ backgroundColor: '#9ca3af' }}>
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
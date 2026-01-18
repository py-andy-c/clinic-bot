import React, { useMemo, useRef } from 'react';
import { View, Views } from 'react-big-calendar';
import moment from 'moment-timezone';
import { CalendarEvent } from '../../utils/calendarDataAdapter';
import { getPractitionerColor } from '../../utils/practitionerColors';
import { getResourceColorById } from '../../utils/resourceColorUtils';
import {
  generateTimeSlots,
  calculateCurrentTimeIndicatorPosition,
  createTimeSlotDate,
  calculateEventPosition,
  calculateEventHeight,
} from '../../utils/calendarGridUtils';
import styles from './CalendarGrid.module.css';

interface CalendarGridProps {
  view: View;
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

  const handleSlotClick = (hour: number, minute: number) => {
    if (onSlotClick) {
      const slotDate = createTimeSlotDate(currentDate, hour, minute);
      onSlotClick({
        start: slotDate,
        end: new Date(slotDate.getTime() + 15 * 60 * 1000), // 15 minutes later
      });
    }
  };

  if (view === Views.MONTH) {
    return <MonthlyCalendarGrid currentDate={currentDate} events={events} onEventClick={onEventClick || (() => {})} />;
  }

  return (
    <div className={styles.calendarGrid} ref={gridRef}>
      {/* Current time indicator */}
      <div className={styles.timeIndicator} style={currentTimeIndicatorStyle} />

      <div className="grid-container">
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
          {selectedPractitioners.map((practitionerId) => (
            <div key={`practitioner-${practitionerId}`} className={styles.practitionerColumn}>
              {timeSlots.map((slot, index) => (
                <div
                  key={index}
                  className={styles.timeSlot}
                  onClick={() => handleSlotClick(slot.hour, slot.minute)}
                />
              ))}
              {/* Render events for this practitioner */}
              {events
                .filter(event => event.resource.practitioner_id === practitionerId)
                .map((event) => (
                  <CalendarEventComponent
                    key={event.id}
                    event={event}
                    onClick={() => onEventClick?.(event)}
                  />
                ))}
            </div>
          ))}

          {selectedResources.map((resourceId) => (
            <div key={`resource-${resourceId}`} className={styles.practitionerColumn}>
              {timeSlots.map((slot, index) => (
                <div
                  key={index}
                  className={styles.timeSlot}
                  onClick={() => handleSlotClick(slot.hour, slot.minute)}
                />
              ))}
              {/* Render events for this resource */}
              {events
                .filter(event => event.resource.resource_id === resourceId)
                .map((event) => (
                  <CalendarEventComponent
                    key={event.id}
                    event={event}
                    onClick={() => onEventClick?.(event)}
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
}

const CalendarEventComponent: React.FC<CalendarEventComponentProps> = ({ event, onClick }) => {
  const eventStyle = useMemo(() => {
    const position = calculateEventPosition(event.start);
    const size = calculateEventHeight(event.start, event.end);

    let backgroundColor = '#6b7280'; // default gray

    if (event.resource.practitioner_id) {
      backgroundColor = getPractitionerColor(event.resource.practitioner_id, 0, []) || '#6b7280';
    } else if (event.resource.resource_id) {
      backgroundColor = getResourceColorById(event.resource.resource_id, [], [], null) || '#6b7280';
    }

    return {
      ...position,
      ...size,
      backgroundColor,
    };
  }, [event]);

  return (
    <div
      className={styles.calendarEvent}
      style={eventStyle}
      onClick={onClick}
      title={`${event.title} - ${event.resource.patient_name || 'No patient'}`}
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

export default CalendarGrid;
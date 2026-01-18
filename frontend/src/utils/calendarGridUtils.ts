import moment from 'moment-timezone';
import { CalendarView, CalendarViews } from '../types/calendar';
import { CalendarEvent } from './calendarDataAdapter';

/**
 * Time slot configuration for calendar grid
 */
export interface TimeSlot {
  hour: number;
  minute: number;
  time: string;
}

/**
 * Generate time slots for calendar grid (8 AM to 10 PM, 15-minute intervals)
 */
export const generateTimeSlots = (): TimeSlot[] => {
  const slots: TimeSlot[] = [];
  for (let hour = 8; hour <= 22; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      slots.push({
        hour,
        minute,
        time: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
      });
    }
  }
  return slots;
};

/**
 * Get current time in Taiwan timezone
 */
export const getCurrentTaiwanTime = () => {
  return moment().tz('Asia/Taipei');
};

/**
 * Calculate current time indicator position for calendar grid
 */
export const calculateCurrentTimeIndicatorPosition = (
  currentDate: Date,
  view: CalendarView
): React.CSSProperties => {
  const now = getCurrentTaiwanTime();
  const today = moment(currentDate).tz('Asia/Taipei').startOf('day');

  if (!now.isSame(today, 'day')) {
    return { display: 'none' };
  }

  const hours = now.hour();
  const minutes = now.minute();

  // Only show indicator between 8 AM and 10 PM
  if (hours < 8 || hours > 22) {
    return { display: 'none' };
  }

  // Calculate position: (hours from 8 AM * 60 + minutes) / 15 * 20px per slot
  const minutesFrom8AM = (hours - 8) * 60 + minutes;
  const pixelsFromTop = (minutesFrom8AM / 15) * 20;

  return {
    top: `${pixelsFromTop}px`,
    left: view === CalendarViews.DAY ? '28px' : '0',
    right: view === CalendarViews.DAY ? '0' : 'auto',
    width: view === CalendarViews.DAY ? 'auto' : '100%',
  };
};

/**
 * Convert hour and minute to Date object in Taiwan timezone
 */
export const createTimeSlotDate = (currentDate: Date, hour: number, minute: number): Date => {
  return moment(currentDate).tz('Asia/Taipei')
    .hour(hour)
    .minute(minute)
    .second(0)
    .millisecond(0)
    .toDate();
};

/**
 * Calculate event position in calendar grid
 */
export const calculateEventPosition = (start: Date): React.CSSProperties => {
  const top = (start.getHours() - 8) * 80 + (start.getMinutes() / 15) * 20;
  return { top: `${top}px` };
};

/**
 * Calculate event height in calendar grid
 */
export const calculateEventHeight = (start: Date, end: Date): React.CSSProperties => {
  const duration = (end.getTime() - start.getTime()) / (1000 * 60); // minutes
  const height = Math.max((duration / 15) * 20, 20);
  return { height: `${height}px` };
};

/**
 * Interface for overlapping event groups
 */
export interface OverlappingEventGroup {
  events: CalendarEvent[];
  left: number;
  width: number;
}

/**
 * Calculate overlapping event groups and their positioning
 * Implements the mock UI overlapping logic (15%/12%/calculated percentages)
 */
export const calculateOverlappingEvents = (events: CalendarEvent[]): OverlappingEventGroup[] => {
  if (events.length === 0) return [];

  // Sort events by start time
  const sortedEvents = [...events].sort((a, b) => a.start.getTime() - b.start.getTime());

  const groups: OverlappingEventGroup[] = [];

  for (const event of sortedEvents) {
    let placed = false;

    // Try to place in existing group
    for (const group of groups) {
      const hasOverlap = group.events.some(existingEvent =>
        event.start < existingEvent.end && event.end > existingEvent.start
      );

      if (!hasOverlap) {
        group.events.push(event);
        placed = true;
        break;
      }
    }

    // Create new group if couldn't place in existing one
    if (!placed) {
      groups.push({ events: [event], left: 0, width: 100 });
    }
  }

  // Calculate positioning for each group
  groups.forEach(group => {
    const count = group.events.length;

    if (count === 1) {
      // Single event takes full width
      group.left = 0;
      group.width = 100;
    } else if (count === 2) {
      // Two events: 15% overlap as per mock UI
      group.left = 0;
      group.width = 85; // 100% - 15% overlap
    } else if (count === 3) {
      // Three events: 12% overlap as per mock UI
      group.left = 0;
      group.width = 88; // 100% - 12% overlap
    } else {
      // Four or more events: calculated percentage
      const overlapPercent = Math.max(5, 100 / count); // Minimum 5% per event
      group.left = 0;
      group.width = Math.max(20, 100 - (overlapPercent * (count - 1)));
    }
  });

  return groups;
};

/**
 * Calculate individual event position within an overlapping group
 */
export const calculateEventInGroupPosition = (
  event: CalendarEvent,
  group: OverlappingEventGroup,
  groupIndex: number
): React.CSSProperties => {
  const position = calculateEventPosition(event.start);
  const size = calculateEventHeight(event.start, event.end);

  // Calculate offset based on position in group
  // For overlapping events, distribute them evenly within the available space
  const offset = groupIndex * (100 - group.width) / Math.max(1, group.events.length - 1);

  return {
    ...position,
    ...size,
    left: `${group.left + offset}%`,
    width: `${group.width}%`,
    zIndex: groupIndex + 1,
  };
};
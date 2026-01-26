import moment from 'moment-timezone';
import { CalendarView, CalendarViews } from '../types/calendar';
import { CalendarEvent } from './calendarDataAdapter';

/**
 * Calendar grid configuration constants
 * Coordinate system: midnight-based (0:00-24:00) with 15-minute slots
 */
export const CALENDAR_GRID_CONFIG = {
  SLOT_DURATION_MINUTES: 15,
  SLOT_HEIGHT_PX: 20,
  HOUR_HEIGHT_PX: 80, // 4 slots × 20px = 80px per hour
  SCROLL_BUFFER_PX: 100, // Buffer when scrolling to current time
} as const;

/**
 * Time slot configuration for calendar grid
 */
export interface TimeSlot {
  hour: number;
  minute: number;
  time: string;
}

/**
 * Generate time slots for calendar grid (0:00 to 23:45, 15-minute intervals)
 */
export const generateTimeSlots = (): TimeSlot[] => {
  const slots: TimeSlot[] = [];
  for (let hour = 0; hour < 24; hour++) {
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
 * Used consistently across all calendar time calculations for timezone accuracy
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

  // Show indicator for full 24-hour day when viewing today's calendar
  // (no business hour restrictions since we now display full day)

  // Calculate position: (hours * 60 + minutes) / slot_duration * slot_height
  const minutesFromMidnight = hours * 60 + minutes;
  const pixelsFromTop = (minutesFromMidnight / CALENDAR_GRID_CONFIG.SLOT_DURATION_MINUTES) * CALENDAR_GRID_CONFIG.SLOT_HEIGHT_PX;

  return {
    top: `${pixelsFromTop}px`,
    left: view === CalendarViews.DAY ? '0' : '0',
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
 * Calculate event position in calendar grid using Taiwan timezone
 * Coordinate system: midnight-based (0:00) with 15-minute slots (20px each) and 80px per hour
 * @param start - Event start time (any timezone, converted to Taiwan time)
 * @returns CSS position properties for vertical placement
 */
export const calculateEventPosition = (start: Date): React.CSSProperties => {
  // Convert to Taiwan timezone for consistent positioning with current time indicator
  const taiwanTime = moment(start).tz('Asia/Taipei');
  const hours = taiwanTime.hour();
  const minutes = taiwanTime.minute();

  // Calculate pixel position from midnight (0:00)
  const top = hours * CALENDAR_GRID_CONFIG.HOUR_HEIGHT_PX +
    (minutes / CALENDAR_GRID_CONFIG.SLOT_DURATION_MINUTES) * CALENDAR_GRID_CONFIG.SLOT_HEIGHT_PX;
  return { top: `${top}px` };
};

/**
 * Calculate event height in calendar grid based on duration
 * @param start - Event start time
 * @param end - Event end time
 * @returns CSS height property (minimum 1 slot = 20px)
 */
export const calculateEventHeight = (start: Date, end: Date): React.CSSProperties => {
  const duration = (end.getTime() - start.getTime()) / (1000 * 60); // minutes
  const height = Math.max(
    (duration / CALENDAR_GRID_CONFIG.SLOT_DURATION_MINUTES) * CALENDAR_GRID_CONFIG.SLOT_HEIGHT_PX,
    CALENDAR_GRID_CONFIG.SLOT_HEIGHT_PX // minimum 1 slot height
  );
  return { height: `${height}px` };
};

/**
 * Interface for overlapping event groups
 */
export interface OverlappingEventGroup {
  events: CalendarEvent[];
  // Map event ID to its layout info within the group
  eventLayouts: Record<string | number, {
    column: number;
    totalColumns: number;
    span: number;
  }>;
}

/**
 * Calculate overlapping event groups and their positioning
 * Implements Google Calendar style columnar layout with Right Expansion
 */
export const calculateOverlappingEvents = (events: CalendarEvent[]): OverlappingEventGroup[] => {
  if (events.length === 0) return [];

  // Sort events by start time, then by duration (longer events first for better placement)
  const sortedEvents = [...events].sort((a, b) => {
    if (a.start.getTime() !== b.start.getTime()) {
      return a.start.getTime() - b.start.getTime();
    }
    return b.end.getTime() - a.end.getTime();
  });

  const groups: OverlappingEventGroup[] = [];

  for (const event of sortedEvents) {
    let placed = false;

    // Try to place in existing group
    for (const group of groups) {
      // An event belongs to a group if it overlaps with ANY event already in that group
      const hasOverlap = group.events.some(existingEvent =>
        event.start < existingEvent.end && event.end > existingEvent.start
      );

      if (hasOverlap) {
        group.events.push(event);
        placed = true;
        break;
      }
    }

    // Create new group if couldn't place in existing one
    if (!placed) {
      groups.push({
        events: [event],
        eventLayouts: {}
      });
    }
  }

  // Calculate positioning for each group
  groups.forEach(group => {
    const columns: CalendarEvent[][] = [];

    // 1. Assign columns greedily
    group.events.forEach(event => {
      let colIdx = columns.findIndex(colEvents =>
        !colEvents.some(existingEvent =>
          event.start < existingEvent.end && event.end > existingEvent.start
        )
      );

      if (colIdx === -1) {
        colIdx = columns.length;
        columns.push([event]);
      } else {
        columns[colIdx]!.push(event);
      }

      group.eventLayouts[event.id] = {
        column: colIdx,
        totalColumns: 0, // Will update after column count is known
        span: 1
      };
    });

    const totalColumns = columns.length;

    // 2. Set totalColumns and calculate Right Expansion
    group.events.forEach(event => {
      const layout = group.eventLayouts[event.id];
      if (!layout) return;

      layout.totalColumns = totalColumns;

      // Expand to the right if possible
      let span = 1;
      for (let nextColIdx = layout.column + 1; nextColIdx < totalColumns; nextColIdx++) {
        const hasOverlapInNextCol = columns[nextColIdx]?.some(otherEvent =>
          event.start < otherEvent.end && event.end > otherEvent.start
        );

        if (!hasOverlapInNextCol) {
          span++;
        } else {
          break;
        }
      }
      layout.span = span;
    });
  });

  return groups;
};

/**
 * Calculate individual event position within an overlapping group
 * Implements Google Calendar style logic with column-based width and offset
 */
export const calculateEventInGroupPosition = (
  event: CalendarEvent,
  group: OverlappingEventGroup,
  _eventIndex: number // Kept for backward compatibility, but we use event.id
): React.CSSProperties => {
  const position = calculateEventPosition(event.start);
  const size = calculateEventHeight(event.start, event.end);

  const layout = group.eventLayouts[event.id];

  // If we don't have layout info (shouldn't happen), fall back to full width
  if (!layout || layout.totalColumns === 0) {
    return {
      ...position,
      ...size,
      left: '0%',
      width: '100%',
      zIndex: 5
    };
  }

  const columnWidth = 100 / layout.totalColumns;

  // Determine base z-index based on event type hierarchy:
  // Current time indicator > Appointments > Availability exceptions
  let baseZIndex = 5; // Default for appointments
  if (event.resource.type === 'availability_exception') {
    baseZIndex = 3; // Exceptions get lowest priority
  }

  return {
    ...position,
    ...size,
    left: `${layout.column * columnWidth}%`,
    width: `${layout.span * columnWidth}%`,
    zIndex: baseZIndex + layout.column, // Use column for stacking priority if needed
  };
};
import moment from 'moment-timezone';
import { CalendarView, CalendarViews } from '../types/calendar';
import { CalendarEvent } from './calendarDataAdapter';

/**
 * Calendar grid configuration constants
 * Coordinate system: midnight-based (0:00-24:00) with 15-minute slots
 */
const CALENDAR_GRID_CONFIG = {
  SLOT_DURATION_MINUTES: 15,
  SLOT_HEIGHT_PX: 20,
  HOUR_HEIGHT_PX: 80, // 4 slots × 20px = 80px per hour
  OVERLAP_PERCENT_TWO_EVENTS: 15,
  OVERLAP_PERCENT_THREE_TO_FOUR_EVENTS: 12,
  OVERLAP_PERCENT_MAX: 15,
  OVERLAP_WIDTH_DENOMINATOR: 75,
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
 * Calculate overlap percentage for event stacking based on event count
 * Implements mock UI design: 15% for 2 events, 12% for 3-4 events, calculated for 5+
 * @param eventCount - Number of overlapping events
 * @returns Percentage overlap (0-15)
 */
const getOverlapPercentage = (eventCount: number): number => {
  if (eventCount <= 2) {
    return CALENDAR_GRID_CONFIG.OVERLAP_PERCENT_TWO_EVENTS; // 15%
  }
  if (eventCount <= 4) {
    return CALENDAR_GRID_CONFIG.OVERLAP_PERCENT_THREE_TO_FOUR_EVENTS; // 12%
  }
  // For 5+ events, ensure minimum readable width with max 15% overlap
  return Math.min(
    CALENDAR_GRID_CONFIG.OVERLAP_PERCENT_MAX,
    CALENDAR_GRID_CONFIG.OVERLAP_WIDTH_DENOMINATOR / (eventCount - 1)
  );
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

      if (hasOverlap) {
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

  // Calculate positioning for each group - matching mock UI exactly
  groups.forEach(group => {
    const count = group.events.length;

    if (count === 1) {
      // Single event takes full width
      group.left = 0;
      group.width = 100;
    } else {
      // Use shared overlap calculation logic matching mock UI design
      const overlapPercent = getOverlapPercentage(count);
      group.width = 100 - ((count - 1) * overlapPercent);
      group.left = 0;
    }
  });

  return groups;
};

/**
 * Calculate individual event position within an overlapping group
 * Matches mock UI overlapping logic exactly
 */
export const calculateEventInGroupPosition = (
  event: CalendarEvent,
  group: OverlappingEventGroup,
  eventIndex: number
): React.CSSProperties => {
  const position = calculateEventPosition(event.start);
  const size = calculateEventHeight(event.start, event.end);

  // Use shared overlap calculation logic matching mock UI design
  const count = group.events.length;
  const overlapPercent = getOverlapPercentage(count);
  const eventWidth = 100 - ((count - 1) * overlapPercent);

  // Determine base z-index based on event type hierarchy:
  // Current time indicator > Appointments > Availability exceptions
  let baseZIndex = 5; // Default for appointments
  if (event.resource.type === 'availability_exception') {
    baseZIndex = 3; // Exceptions get lowest priority
  }

  return {
    ...position,
    ...size,
    left: `${eventIndex * overlapPercent}%`,
    width: `${eventWidth}%`,
    zIndex: baseZIndex + eventIndex, // Base z-index by type + eventIndex for stacking
  };
};
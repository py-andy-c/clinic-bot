/**
 * Calendar Utility Functions
 * 
 * Utility functions for calendar date/time formatting and calculations.
 */

import moment from 'moment-timezone';

const TAIWAN_TIMEZONE = 'Asia/Taipei';

/**
 * Generate date string in YYYY-MM-DD format (Taiwan timezone)
 */
export const getDateString = (date: Date): string => {
  const taiwanDate = moment(date).tz(TAIWAN_TIMEZONE);
  return taiwanDate.format('YYYY-MM-DD');
};

/**
 * Format appointment time with date and weekday
 * Example: "1/15 (一) 9:00 AM - 10:00 AM"
 */
export const formatAppointmentTime = (start: Date, end: Date): string => {
  const startMoment = moment(start).tz(TAIWAN_TIMEZONE);
  const endMoment = moment(end).tz(TAIWAN_TIMEZONE);
  const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const weekday = weekdayNames[startMoment.day()];
  const dateStr = `${startMoment.format('M/D')} (${weekday})`;
  return `${dateStr} ${startMoment.format('h:mm A')} - ${endMoment.format('h:mm A')}`;
};

/**
 * Get date range for the current view (Taiwan timezone)
 */
export const getDateRange = (date: Date, view: 'month' | 'day' | 'week' | 'agenda' | string): { start: Date; end: Date } => {
  const start = moment(date).tz(TAIWAN_TIMEZONE);
  const end = moment(date).tz(TAIWAN_TIMEZONE);

  switch (view) {
    case 'month':
    case 'MONTH':
      start.startOf('month');
      end.endOf('month');
      break;
    case 'day':
    case 'DAY':
      start.startOf('day');
      end.endOf('day');
      break;
    case 'week':
    case 'WEEK':
      start.startOf('week');
      end.endOf('week');
      break;
    case 'agenda':
    case 'AGENDA':
      start.startOf('day');
      end.endOf('day');
      break;
    default:
      start.startOf('day');
      end.endOf('day');
      break;
  }

  return { start: start.toDate(), end: end.toDate() };
};

/**
 * Format time from time string (e.g., "09:00" -> "9:00 AM")
 */
export const formatTimeString = (timeStr: string): string => {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  if (parts.length < 2 || !parts[0] || !parts[1]) return timeStr; // Invalid format, return as-is
  const hour = parseInt(parts[0], 10);
  const minutes = parts[1];
  if (isNaN(hour)) return timeStr; // Invalid hour, return as-is
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${hour12}:${minutes} ${period}`;
};

/**
 * Get scroll position for day view (9 AM)
 */
export const getScrollToTime = (currentDate: Date): Date => {
  const scrollDate = moment(currentDate).tz(TAIWAN_TIMEZONE);
  scrollDate.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  return scrollDate.toDate();
};


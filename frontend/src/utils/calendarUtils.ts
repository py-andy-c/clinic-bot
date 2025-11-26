/**
 * Calendar Utility Functions
 * 
 * Utility functions for calendar date/time formatting and calculations.
 */

import moment from 'moment-timezone';
import i18n from '../i18n';
import { logger } from './logger';

const TAIWAN_TIMEZONE = 'Asia/Taipei';

/**
 * Weekday names in Traditional Chinese (Sunday = 0, Monday = 1, ..., Saturday = 6)
 * Used as fallback when i18n is not available or returns invalid data
 */
export const WEEKDAY_NAMES_ZH_TW = ['日', '一', '二', '三', '四', '五', '六'] as const;

/**
 * Get weekday names using i18n with fallback to WEEKDAY_NAMES_ZH_TW
 * Returns an array of weekday abbreviations in the current language
 */
export const getWeekdayNames = (): readonly string[] => {
  try {
    const weekdayAbbr = i18n.t('datetime.weekdayAbbr', { returnObjects: true }) as string[];
    if (Array.isArray(weekdayAbbr) && weekdayAbbr.length === 7) {
      return weekdayAbbr;
    }
  } catch (error) {
    logger.warn('Failed to get weekday names from i18n, using fallback');
  }
  return WEEKDAY_NAMES_ZH_TW;
};

/**
 * Generate date string in YYYY-MM-DD format (Taiwan timezone)
 */
export const getDateString = (date: Date): string => {
  const taiwanDate = moment(date).tz(TAIWAN_TIMEZONE);
  return taiwanDate.format('YYYY-MM-DD');
};

/**
 * Format datetime for user-facing display
 * Format: "12/25 (三) 1:30 PM"
 * 
 * Used for all user-facing messages (appointments, notifications, reminders, etc.)
 * to ensure consistent date/time formatting across the platform.
 * 
 * @param dateTime - Date object or ISO string
 * @returns Formatted datetime string
 */
export const formatDateTime = (dateTime: Date | string): string => {
  const taiwanMoment = moment(dateTime).tz(TAIWAN_TIMEZONE);
  const weekdayAbbr = i18n.t('datetime.weekdayAbbr', { returnObjects: true }) as string[];
  // Validate weekday abbreviations array
  if (!Array.isArray(weekdayAbbr) || weekdayAbbr.length !== 7) {
    logger.warn('Invalid weekday abbreviations, using fallback');
    const weekday = WEEKDAY_NAMES_ZH_TW[taiwanMoment.day()] || '';
    const dateStr = taiwanMoment.format('MM/DD');
    const timeStr = taiwanMoment.format('h:mm A');
    return `${dateStr} (${weekday}) ${timeStr}`;
  }
  const weekday = weekdayAbbr[taiwanMoment.day()] || '';
  const dateStr = taiwanMoment.format('MM/DD');
  const timeStr = taiwanMoment.format('h:mm A');
  return `${dateStr} (${weekday}) ${timeStr}`;
};

/**
 * Format appointment time with date and weekday
 * Example: "12/25 (三) 9:00 AM - 10:00 AM"
 */
export const formatAppointmentTime = (start: Date, end: Date): string => {
  const startMoment = moment(start).tz(TAIWAN_TIMEZONE);
  const endMoment = moment(end).tz(TAIWAN_TIMEZONE);
  const weekdayAbbr = i18n.t('datetime.weekdayAbbr', { returnObjects: true }) as string[];
  // Validate weekday abbreviations array
  if (!Array.isArray(weekdayAbbr) || weekdayAbbr.length !== 7) {
    logger.warn('Invalid weekday abbreviations, using fallback');
    const weekday = WEEKDAY_NAMES_ZH_TW[startMoment.day()] || '';
    const dateStr = `${startMoment.format('MM/DD')} (${weekday})`;
    return `${dateStr} ${startMoment.format('h:mm A')} - ${endMoment.format('h:mm A')}`;
  }
  const weekday = weekdayAbbr[startMoment.day()] || '';
  const dateStr = `${startMoment.format('MM/DD')} (${weekday})`;
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
 * Format 24-hour time string to 12-hour format with AM/PM
 * Returns object with time12 and period for flexible display
 * Example: "09:00" -> { time12: "09:00", period: "AM" }
 * Example: "14:30" -> { time12: "02:30", period: "PM" }
 */
export const formatTo12Hour = (time24: string): { time12: string; period: 'AM' | 'PM'; display: string } => {
  const parts = time24.split(':').map(Number);
  const hours = parts[0] ?? 0;
  const minutes = parts[1] ?? 0;
  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  const time12 = `${String(hours12).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  // Display format without leading zero on hour: "1:45 PM" instead of "01:45 PM"
  const displayHour = hours12; // No padding for display
  const displayMinutes = String(minutes).padStart(2, '0');
  return {
    time12,
    period,
    display: `${displayHour}:${displayMinutes} ${period}` // "1:45 PM" format
  };
};

/**
 * Group time slots into AM and PM arrays
 */
export const groupTimeSlots = (slots: string[]): { amSlots: string[]; pmSlots: string[] } => {
  const amSlots: string[] = [];
  const pmSlots: string[] = [];

  slots.forEach(slot => {
    const formatted = formatTo12Hour(slot);
    if (formatted.period === 'AM') {
      amSlots.push(slot);
    } else {
      pmSlots.push(slot);
    }
  });

  return { amSlots, pmSlots };
};

/**
 * Generate calendar days for a given month
 * Returns array of Date objects (or null for empty cells)
 */
export const generateCalendarDays = (month: Date): (Date | null)[] => {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay(); // 0 = Sunday

  const days: (Date | null)[] = [];

  // Add null for days before month starts
  for (let i = 0; i < startingDayOfWeek; i++) {
    days.push(null);
  }

  // Add all days in the month
  for (let day = 1; day <= daysInMonth; day++) {
    days.push(new Date(year, monthIndex, day));
  }

  return days;
};

/**
 * Check if a date is today (Taiwan timezone)
 */
export const isToday = (date: Date): boolean => {
  const todayTaiwan = moment.tz(TAIWAN_TIMEZONE).startOf('day');
  const dateTaiwan = moment(date).tz(TAIWAN_TIMEZONE).startOf('day');
  return dateTaiwan.isSame(todayTaiwan, 'day');
};

/**
 * Format month and year using i18n
 */
export const formatMonthYear = (date: Date): string => {
  const monthNames = i18n.t('datetime.monthNames', { returnObjects: true }) as string[];
  // Validate month names array
  if (!Array.isArray(monthNames) || monthNames.length !== 12) {
    logger.warn('Invalid month names, using fallback');
    const fallback = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
    const monthIndex = date.getMonth();
    const year = date.getFullYear();
    const monthName = fallback[monthIndex] || '';
    return `${year}年${monthName}`;
  }
  const monthIndex = date.getMonth();
  const year = date.getFullYear();
  const monthName = monthNames[monthIndex] || '';
  // For English, format as "January 2024", for Chinese use "2024年一月"
  const currentLang = i18n.language;
  if (currentLang === 'en') {
    return `${monthName} ${year}`;
  } else {
    return `${year}年${monthName}`;
  }
};

/**
 * Format date as YYYY-MM-DD string
 */
export const formatDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Get scroll position for day view (9 AM)
 */
export const getScrollToTime = (currentDate: Date): Date => {
  const scrollDate = moment(currentDate).tz(TAIWAN_TIMEZONE);
  scrollDate.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  return scrollDate.toDate();
};

/**
 * Build array of dates to check for availability in a given month.
 * Only includes dates that are today or in the future (excludes past dates).
 * 
 * @param month - Date object representing the month to check
 * @returns Array of date strings in YYYY-MM-DD format
 */
export const buildDatesToCheckForMonth = (month: Date): string[] => {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  
  // Get today's date in Taiwan timezone to match backend validation
  const todayTaiwan = moment.tz(TAIWAN_TIMEZONE).startOf('day');
  const todayDateString = todayTaiwan.format('YYYY-MM-DD');
  
  const datesToCheck: string[] = [];
  for (let day = 1; day <= lastDay; day++) {
    const dateString = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    // Only check dates that are today or in the future (avoid 400 errors for past dates)
    // Compare date strings to ensure we're using the same timezone as the backend
    if (dateString >= todayDateString) {
      datesToCheck.push(dateString);
    }
  }
  
  return datesToCheck;
};


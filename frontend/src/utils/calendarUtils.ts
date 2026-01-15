/**
 * Calendar Utility Functions
 * 
 * Utility functions for calendar date/time formatting and calculations.
 */

import moment from 'moment-timezone';
import i18n from '../i18n';
import { logger } from './logger';

/**
 * Practitioner name display utility
 */
export interface Practitioner {
  id: number;
  full_name: string;
}

/**
 * Get practitioner name for display in review/editing contexts
 * 
 * @param practitioners - Array of practitioners to search
 * @param practitionerId - ID of the practitioner (can be null)
 * @param isAutoAssigned - Whether the appointment is auto-assigned
 * @param options - Optional configuration
 * @param options.useTranslation - If true, use translation key for auto-assigned (patient-facing). If false, show "(自動指派)" suffix (clinic-facing)
 * @param options.t - Translation function (required if useTranslation is true)
 * @returns Formatted practitioner name string
 */
export const getPractitionerDisplayName = (
  practitioners: Practitioner[],
  practitionerId: number | null,
  isAutoAssigned: boolean,
  options?: {
    useTranslation?: boolean;
    t?: (key: string) => string;
  }
): string => {
  // Handle auto-assigned or null practitioner
  if (isAutoAssigned || practitionerId === null) {
    if (options?.useTranslation && options?.t) {
      // Patient-facing: use translation
      return options.t('practitioner.notSpecified');
    } else {
      // Clinic-facing: show practitioner name with suffix if available, otherwise just "自動指派"
      if (practitionerId !== null) {
        const practitioner = practitioners.find(p => p.id === practitionerId);
        return practitioner ? `${practitioner.full_name} (自動指派)` : '自動指派';
      }
      return '自動指派';
    }
  }

  // Find practitioner by ID
  const practitioner = practitioners.find(p => p.id === practitionerId);
  return practitioner ? practitioner.full_name : '未知';
};

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
 * Format: "12/25 (三) 13:30"
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
    const timeStr = taiwanMoment.format('HH:mm');
    return `${dateStr} (${weekday}) ${timeStr}`;
  }
  const weekday = weekdayAbbr[taiwanMoment.day()] || '';
  const dateStr = taiwanMoment.format('MM/DD');
  const timeStr = taiwanMoment.format('HH:mm');
  return `${dateStr} (${weekday}) ${timeStr}`;
};

/**
 * Format appointment date/time for display
 * Format: "2025/12/8(一) 09:00"
 * 
 * Standardized format for clinic admin platform appointment displays.
 * Uses full year, no leading zeros, weekday in parentheses, 24-hour time.
 * 
 * @param dateTime - Date object or ISO string
 * @returns Formatted datetime string
 */
export const formatAppointmentDateTime = (dateTime: Date | string): string => {
  const taiwanMoment = moment(dateTime).tz(TAIWAN_TIMEZONE);
  const weekdayNames = getWeekdayNames();
  const weekday = weekdayNames[taiwanMoment.day()] || '';
  const dateStr = taiwanMoment.format('YYYY/M/D');
  const timeStr = taiwanMoment.format('HH:mm');
  return `${dateStr}(${weekday}) ${timeStr}`;
};

/**
 * Format appointment date only with weekday
 * Format: "2025/12/8(一)"
 *
 * Standardized format for appointment dates in LIFF.
 *
 * @param date - Date to format
 * @returns Formatted date string with weekday
 */
export const formatAppointmentDateOnly = (date: Date | string): string => {
  const taiwanMoment = moment(date).tz(TAIWAN_TIMEZONE);
  const weekdayNames = getWeekdayNames();
  const weekday = weekdayNames[taiwanMoment.day()] || '';
  const dateStr = taiwanMoment.format('YYYY/M/D');
  return `${dateStr}(${weekday})`;
};

/**
 * Format appointment time range with date and weekday
 * Format: "2025/12/8(一) 09:00 - 10:00"
 * 
 * Standardized format for appointment time ranges in clinic admin platform.
 * 
 * @param start - Start date/time
 * @param end - End date/time
 * @returns Formatted time range string
 */
export const formatAppointmentTimeRange = (start: Date, end: Date): string => {
  const startMoment = moment(start).tz(TAIWAN_TIMEZONE);
  const endMoment = moment(end).tz(TAIWAN_TIMEZONE);
  const weekdayNames = getWeekdayNames();
  const weekday = weekdayNames[startMoment.day()] || '';
  const dateStr = startMoment.format('YYYY/M/D');
  const startTimeStr = startMoment.format('HH:mm');
  const endTimeStr = endMoment.format('HH:mm');
  return `${dateStr}(${weekday}) ${startTimeStr} - ${endTimeStr}`;
};

/**
 * Format date only (no time, no weekday)
 * Format: "2025/12/8"
 * 
 * Used for birthday, created date, and other date-only displays.
 * No leading zeros for month/day.
 * 
 * @param date - Date object or ISO string
 * @returns Formatted date string
 */
export const formatDateOnly = (date: Date | string): string => {
  const taiwanMoment = moment(date).tz(TAIWAN_TIMEZONE);
  return taiwanMoment.format('YYYY/M/D');
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
 * Format time from time string (e.g., "09:00" -> "09:00")
 * Returns 24-hour format (HH:MM)
 */
export const formatTimeString = (timeStr: string): string => {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  if (parts.length < 2 || !parts[0] || !parts[1]) return timeStr; // Invalid format, return as-is
  const hour = parseInt(parts[0], 10);
  const minutes = parts[1];
  if (isNaN(hour) || hour < 0 || hour > 23) return timeStr; // Invalid hour, return as-is
  // Return in 24-hour format with zero-padded hours
  return `${String(hour).padStart(2, '0')}:${minutes}`;
};

/**
 * Format 24-hour time string to 12-hour format with AM/PM
 * Returns object with time12 and period for flexible display
 * Example: "09:00" -> { time12: "09:00", period: "AM" }
 * Example: "14:30" -> { time12: "02:30", period: "PM" }
 *
 * @deprecated This function is deprecated. Use 24-hour format directly instead.
 * Kept for backward compatibility during migration period.
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
 * Parse 12-hour format time string to 24-hour format (HH:MM).
 * Accepts formats like "9:00 PM", "9:00PM", "09:00 PM", etc.
 * Returns 24-hour format string like "21:00".
 */
export const parseTime12hTo24h = (time12h: string): string => {
  if (!time12h || !time12h.trim()) {
    throw new Error('Time string cannot be empty');
  }
  
  const trimmed = time12h.trim().toUpperCase();
  // Pattern to match: hour:minute AM/PM (with or without space)
  const pattern = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/;
  const match = trimmed.match(pattern);
  
  if (!match || !match[1] || !match[2] || !match[3]) {
    throw new Error(`Invalid 12-hour time format (expected H:MM AM/PM): ${time12h}`);
  }
  
  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const period = match[3];
  
  // Validate ranges
  if (hour < 1 || hour > 12) {
    throw new Error(`Invalid hour (must be 1-12): ${hour}`);
  }
  if (minute < 0 || minute > 59) {
    throw new Error(`Invalid minute (must be 0-59): ${minute}`);
  }
  
  // Convert to 24-hour format
  if (period === 'AM') {
    if (hour === 12) {
      hour = 0; // 12:00 AM = 00:00
    }
  } else { // PM
    if (hour !== 12) {
      hour = hour + 12;
    }
    // 12:00 PM = 12:00 (no change)
  }
  
  // Return as HH:MM string
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

/**
 * Format 24-hour format time string (HH:MM) to 12-hour format (H:MM AM/PM).
 * Converts time strings like "21:00" -> "9:00 PM".
 *
 * @deprecated This function is deprecated. Use 24-hour format directly instead.
 * Kept for backward compatibility during migration period.
 */
export const formatTime24hTo12h = (time24h: string): string => {
  if (!time24h || !time24h.trim()) {
    throw new Error('Time string cannot be empty');
  }
  
  const trimmed = time24h.trim();
  const parts = trimmed.split(':');
  
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid 24-hour time format (expected HH:MM): ${time24h}`);
  }
  
  const hour = parseInt(parts[0], 10);
  const minute = parseInt(parts[1], 10);
  
  // Validate ranges
  if (hour < 0 || hour > 23) {
    throw new Error(`Invalid hour (must be 0-23): ${hour}`);
  }
  if (minute < 0 || minute > 59) {
    throw new Error(`Invalid minute (must be 0-59): ${minute}`);
  }
  
  // Convert to 12-hour format
  let hour12: number;
  let period: 'AM' | 'PM';
  
  if (hour === 0) {
    hour12 = 12;
    period = 'AM';
  } else if (hour < 12) {
    hour12 = hour;
    period = 'AM';
  } else if (hour === 12) {
    hour12 = 12;
    period = 'PM';
  } else {
    hour12 = hour - 12;
    period = 'PM';
  }
  
  // Return as H:MM AM/PM (no leading zero on hour for display)
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
};

/**
 * Group time slots into AM and PM arrays
 *
 * @deprecated This function is deprecated. Time slots should be displayed in a single chronological list.
 * Kept for backward compatibility during migration period.
 *
 * For new code, simply sort the slots array: slots.sort()
 */
export const groupTimeSlots = (slots: string[]): { amSlots: string[]; pmSlots: string[] } => {
  const amSlots: string[] = [];
  const pmSlots: string[] = [];

  slots.forEach(slot => {
    const hour = parseInt(slot.split(':')[0] || '0', 10);
    if (hour < 12) {
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
  // Scroll to 9:00 AM
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


/**
 * Timezone Utilities
 *
 * Safe utilities for handling appointment datetime strings.
 * Prevents timezone conversion bugs by preserving timezone information.
 *
 * USAGE PATTERN:
 * 1. When receiving start_time from CreateAppointmentModal (ISO string):
 *    const { date, startTime } = extractAppointmentDateTime(formData.start_time);
 *
 * 2. When displaying times to users:
 *    const displayTime = parseTaiwanTime(appointment.start_time).format('HH:mm');
 *
 * NEVER use moment(formData.start_time) without timezone - it causes bugs!
 */

import moment from 'moment-timezone';

const TAIWAN_TIMEZONE = 'Asia/Taipei';

/**
 * SAFE: Extract date and time from appointment start_time ISO string
 *
 * This is the CORRECT way to handle start_time from CreateAppointmentModal.
 * It preserves the timezone information without conversion.
 *
 * @param startTimeIsoString - ISO string from CreateAppointmentModal (e.g., "2024-01-15T14:30:00.000+08:00")
 * @returns Object with date (YYYY-MM-DD) and startTime (HH:mm:ss+timezone)
 * @throws Error if input is not a valid ISO string
 */
export const extractAppointmentDateTime = (startTimeIsoString: string): {
  date: string;
  startTime: string;
} => {
  if (!startTimeIsoString || typeof startTimeIsoString !== 'string') {
    throw new Error('Invalid input: startTimeIsoString must be a non-empty string');
  }

  if (!startTimeIsoString.includes('T')) {
    throw new Error('Invalid ISO string format: missing "T" separator');
  }

  const parts = startTimeIsoString.split('T');
  const date = parts[0];
  const timePart = parts[1];

  if (!date || date.length < 10) {
    throw new Error('Invalid date format in ISO string');
  }

  if (!timePart) {
    throw new Error('Invalid time format in ISO string');
  }

  return {
    date,
    startTime: timePart,
  };
};

/**
 * SAFE: Parse ISO string in Taiwan timezone for display
 *
 * @param isoString - ISO datetime string
 * @returns moment object in Taiwan timezone
 * @throws Error if input is not a valid string
 */
export const parseTaiwanTime = (isoString: string) => {
  if (!isoString || typeof isoString !== 'string') {
    throw new Error('Invalid input: isoString must be a non-empty string');
  }

  const result = moment.tz(isoString, TAIWAN_TIMEZONE);
  if (!result.isValid()) {
    throw new Error('Invalid datetime string format');
  }

  return result;
};
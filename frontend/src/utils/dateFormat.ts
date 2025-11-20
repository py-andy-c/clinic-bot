/**
 * Utility functions for date format conversion.
 * Handles conversion between YYYY/MM/DD (display) and YYYY-MM-DD (API) formats.
 */

import moment from 'moment-timezone';
import i18n from '../i18n';

const TAIWAN_TIMEZONE = 'Asia/Taipei';

/**
 * Convert date from API format (YYYY-MM-DD) to display format using i18n.
 * @param date - Date string in YYYY-MM-DD format, or null/undefined
 * @returns Formatted date string, or empty string if input is empty
 */
export const formatDateForDisplay = (date: string | null | undefined): string => {
  if (!date) return '';
  const dateMoment = moment.tz(date, TAIWAN_TIMEZONE);
  const format = i18n.t('datetime.monthDayFormat');
  return dateMoment.format(format);
};

/**
 * Convert date from display format (YYYY/MM/DD) to API format (YYYY-MM-DD).
 * @param date - Date string in YYYY/MM/DD format
 * @returns Date string in YYYY-MM-DD format
 */
export const formatDateForApi = (date: string): string => {
  return date.replace(/\//g, '-');
};


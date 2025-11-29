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
 * Normalize date string to YYYY/MM/DD format.
 * Pads single-digit months/days with zeros (e.g., "2022/1/1" -> "2022/01/01").
 * @param date - Date string in YYYY/MM/DD format (may have single digits)
 * @returns Normalized date string in YYYY/MM/DD format, or empty string if input is empty
 */
export const normalizeDate = (date: string): string => {
  if (!date || !date.trim()) return '';
  
  const trimmed = date.trim();
  const parts = trimmed.split('/').filter(p => p.length > 0);
  
  if (parts.length !== 3) return trimmed; // Return as-is if invalid format
  
  const year = parts[0]!.padStart(4, '0');
  const month = parts[1]!.padStart(2, '0');
  const day = parts[2]!.padStart(2, '0');
  
  return `${year}/${month}/${day}`;
};

/**
 * Validate and normalize date string.
 * @param date - Date string in YYYY/MM/DD format (may have single digits)
 * @returns Object with isValid flag and normalized date (if valid) or error message
 */
export const validateAndNormalizeDate = (date: string): {
  isValid: boolean;
  normalized?: string;
  error?: string;
} => {
  if (!date || !date.trim()) {
    return { isValid: true }; // Empty date is valid (optional field)
  }
  
  const normalized = normalizeDate(date.trim());
  const dateRegex = /^\d{4}\/\d{2}\/\d{2}$/;
  
  if (!dateRegex.test(normalized)) {
    return {
      isValid: false,
      error: '生日格式錯誤，請使用 YYYY/MM/DD 格式',
    };
  }
  
  return {
    isValid: true,
    normalized,
  };
};

/**
 * Convert date from display format (YYYY/MM/DD) to API format (YYYY-MM-DD).
 * Automatically normalizes the date before conversion.
 * @param date - Date string in YYYY/MM/DD format (may have single digits)
 * @returns Date string in YYYY-MM-DD format
 */
export const formatDateForApi = (date: string): string => {
  if (!date || !date.trim()) return '';
  const normalized = normalizeDate(date.trim());
  return normalized.replace(/\//g, '-');
};

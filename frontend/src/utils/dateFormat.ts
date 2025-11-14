/**
 * Utility functions for date format conversion.
 * Handles conversion between YYYY/MM/DD (display) and YYYY-MM-DD (API) formats.
 */

/**
 * Convert date from API format (YYYY-MM-DD) to display format (YYYY/MM/DD).
 * @param date - Date string in YYYY-MM-DD format, or null/undefined
 * @returns Date string in YYYY/MM/DD format, or empty string if input is empty
 */
export const formatDateForDisplay = (date: string | null | undefined): string => {
  if (!date) return '';
  return date.replace(/-/g, '/');
};

/**
 * Convert date from display format (YYYY/MM/DD) to API format (YYYY-MM-DD).
 * @param date - Date string in YYYY/MM/DD format
 * @returns Date string in YYYY-MM-DD format
 */
export const formatDateForApi = (date: string): string => {
  return date.replace(/\//g, '-');
};


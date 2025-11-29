/**
 * Phone number validation utilities for Taiwanese phone numbers
 */

import i18n from '../i18n';

/**
 * Validates a Taiwanese phone number
 * Format: 09xxxxxxxx (10 digits starting with 09)
 */
export const validateTaiwanPhoneNumber = (phone: string): boolean => {
  // Remove any spaces or dashes
  const cleanPhone = phone.replace(/[\s-]/g, '');

  // Check if it matches Taiwanese mobile format: 09xxxxxxxx (10 digits)
  const taiwanMobileRegex = /^09\d{8}$/;
  return taiwanMobileRegex.test(cleanPhone);
};

/**
 * Formats a phone number for display (removes spaces and dashes)
 */
export const formatPhoneNumber = (phone: string): string => {
  return phone.replace(/[\s-]/g, '');
};

/**
 * Gets the validation error message for phone numbers
 */
export const getPhoneValidationErrorMessage = (): string => {
  return i18n.t('patient.form.phone.error.invalid');
};

/**
 * Checks if a phone number is valid and returns validation result
 * For required phone numbers (LIFF flow)
 */
export const validatePhoneNumber = (phone: string): {
  isValid: boolean;
  error?: string;
} => {
  if (!phone || phone.trim() === '') {
    return { isValid: false, error: i18n.t('patient.form.phone.error.required') };
  }

  if (!validateTaiwanPhoneNumber(phone)) {
    return { isValid: false, error: getPhoneValidationErrorMessage() };
  }

  return { isValid: true };
};

/**
 * Validates an optional phone number (for clinic-created patients)
 * Returns valid if phone is empty, validates format if provided
 */
export const validateOptionalPhoneNumber = (phone: string): {
  isValid: boolean;
  error?: string;
} => {
  // Empty phone is valid (optional field)
  if (!phone || phone.trim() === '') {
    return { isValid: true };
  }

  // If provided, must be valid format
  if (!validateTaiwanPhoneNumber(phone)) {
    return { isValid: false, error: getPhoneValidationErrorMessage() };
  }

  return { isValid: true };
};

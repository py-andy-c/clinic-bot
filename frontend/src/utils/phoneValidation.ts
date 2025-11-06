/**
 * Phone number validation utilities for Taiwanese phone numbers
 */

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
  return '手機號碼格式不正確，請輸入09開頭的10位數字';
};

/**
 * Checks if a phone number is valid and returns validation result
 */
export const validatePhoneNumber = (phone: string): {
  isValid: boolean;
  error?: string;
} => {
  if (!phone || phone.trim() === '') {
    return { isValid: false, error: '請輸入手機號碼' };
  }

  if (!validateTaiwanPhoneNumber(phone)) {
    return { isValid: false, error: getPhoneValidationErrorMessage() };
  }

  return { isValid: true };
};

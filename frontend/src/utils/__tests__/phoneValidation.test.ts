import { describe, it, expect } from 'vitest';
import {
  validateTaiwanPhoneNumber,
  formatPhoneNumber,
  getPhoneValidationErrorMessage,
  validatePhoneNumber,
} from '../phoneValidation';

describe('Phone Validation Utilities', () => {
  describe('validateTaiwanPhoneNumber', () => {
    it('should validate correct Taiwanese mobile numbers', () => {
      expect(validateTaiwanPhoneNumber('0912345678')).toBe(true);
      expect(validateTaiwanPhoneNumber('0987654321')).toBe(true);
      expect(validateTaiwanPhoneNumber('0900000000')).toBe(true);
    });

    it('should reject numbers not starting with 09', () => {
      expect(validateTaiwanPhoneNumber('0812345678')).toBe(false);
      expect(validateTaiwanPhoneNumber('0212345678')).toBe(false);
      expect(validateTaiwanPhoneNumber('112345678')).toBe(false);
    });

    it('should reject numbers with wrong length', () => {
      expect(validateTaiwanPhoneNumber('091234567')).toBe(false); // 9 digits
      expect(validateTaiwanPhoneNumber('09123456789')).toBe(false); // 11 digits
      expect(validateTaiwanPhoneNumber('091234567890')).toBe(false); // 12 digits
    });

    it('should handle spaces and dashes', () => {
      expect(validateTaiwanPhoneNumber('0912-345-678')).toBe(true);
      expect(validateTaiwanPhoneNumber('0912 345 678')).toBe(true);
      expect(validateTaiwanPhoneNumber('0912-345 678')).toBe(true);
    });

    it('should reject empty or invalid strings', () => {
      expect(validateTaiwanPhoneNumber('')).toBe(false);
      expect(validateTaiwanPhoneNumber('abc')).toBe(false);
      expect(validateTaiwanPhoneNumber('091234567a')).toBe(false);
    });
  });

  describe('formatPhoneNumber', () => {
    it('should remove spaces and dashes', () => {
      expect(formatPhoneNumber('0912-345-678')).toBe('0912345678');
      expect(formatPhoneNumber('0912 345 678')).toBe('0912345678');
      expect(formatPhoneNumber('0912-345 678')).toBe('0912345678');
    });

    it('should return unchanged for already clean numbers', () => {
      expect(formatPhoneNumber('0912345678')).toBe('0912345678');
    });

    it('should handle empty strings', () => {
      expect(formatPhoneNumber('')).toBe('');
    });
  });

  describe('getPhoneValidationErrorMessage', () => {
    it('should return the correct error message', () => {
      expect(getPhoneValidationErrorMessage()).toBe('手機號碼格式不正確，請輸入09開頭的10位數字');
    });
  });

  describe('validatePhoneNumber', () => {
    it('should validate correct phone numbers', () => {
      const result = validatePhoneNumber('0912345678');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject empty phone numbers', () => {
      const result = validatePhoneNumber('');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('請輸入手機號碼');
    });

    it('should reject whitespace-only phone numbers', () => {
      const result = validatePhoneNumber('   ');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('請輸入手機號碼');
    });

    it('should reject invalid phone number formats', () => {
      const result = validatePhoneNumber('0812345678');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('手機號碼格式不正確，請輸入09開頭的10位數字');
    });

    it('should handle formatted phone numbers', () => {
      const result = validatePhoneNumber('0912-345-678');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });
});

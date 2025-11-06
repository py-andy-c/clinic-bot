/**
 * Unit tests for calendar utility functions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import moment from 'moment-timezone';
import {
  getDateString,
  formatAppointmentTime,
  getDateRange,
  formatTimeString,
  getScrollToTime,
} from '../calendarUtils';

describe('calendarUtils', () => {
  beforeEach(() => {
    // Set timezone to Taiwan for consistent testing
    moment.tz.setDefault('Asia/Taipei');
  });

  afterEach(() => {
    moment.tz.setDefault();
  });

  describe('getDateString', () => {
    it('should format date as YYYY-MM-DD in Taiwan timezone', () => {
      const date = new Date('2024-01-15T10:00:00Z');
      const result = getDateString(date);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result).toContain('2024');
    });

    it('should handle different dates correctly', () => {
      const date1 = new Date('2024-12-31T23:59:59Z');
      const date2 = new Date('2024-01-01T00:00:00Z');
      const result1 = getDateString(date1);
      const result2 = getDateString(date2);
      expect(result1).not.toBe(result2);
    });
  });

  describe('formatAppointmentTime', () => {
    it('should format appointment time with date and weekday', () => {
      const start = new Date('2024-01-15T09:00:00+08:00');
      const end = new Date('2024-01-15T10:00:00+08:00');
      const result = formatAppointmentTime(start, end);
      
      expect(result).toContain('1/15');
      expect(result).toContain('9:00');
      expect(result).toContain('10:00');
      expect(result).toMatch(/AM|PM/);
    });

    it('should include weekday in Chinese', () => {
      const start = new Date('2024-01-15T09:00:00+08:00'); // Monday
      const end = new Date('2024-01-15T10:00:00+08:00');
      const result = formatAppointmentTime(start, end);
      
      // Should contain weekday in Chinese (一, 二, 三, etc.)
      expect(result).toMatch(/[一二三四五六日]/);
    });

    it('should format PM times correctly', () => {
      const start = new Date('2024-01-15T14:00:00+08:00');
      const end = new Date('2024-01-15T15:00:00+08:00');
      const result = formatAppointmentTime(start, end);
      
      expect(result).toContain('PM');
    });
  });

  describe('getDateRange', () => {
    it('should return day range for day view', () => {
      const date = new Date('2024-01-15T12:00:00+08:00');
      const { start, end } = getDateRange(date, 'day');
      
      const startMoment = moment(start).tz('Asia/Taipei');
      const endMoment = moment(end).tz('Asia/Taipei');
      
      expect(startMoment.format('YYYY-MM-DD')).toBe('2024-01-15');
      expect(endMoment.format('YYYY-MM-DD')).toBe('2024-01-15');
      expect(startMoment.hour()).toBe(0);
      expect(startMoment.minute()).toBe(0);
      expect(endMoment.hour()).toBe(23);
      expect(endMoment.minute()).toBe(59);
    });

    it('should return month range for month view', () => {
      const date = new Date('2024-01-15T12:00:00+08:00');
      const { start, end } = getDateRange(date, 'month');
      
      const startMoment = moment(start).tz('Asia/Taipei');
      const endMoment = moment(end).tz('Asia/Taipei');
      
      expect(startMoment.format('YYYY-MM')).toBe('2024-01');
      expect(endMoment.format('YYYY-MM')).toBe('2024-01');
      expect(startMoment.date()).toBe(1);
    });

    it('should handle uppercase view names', () => {
      const date = new Date('2024-01-15T12:00:00+08:00');
      const { start, end } = getDateRange(date, 'DAY');
      
      const startMoment = moment(start).tz('Asia/Taipei');
      expect(startMoment.format('YYYY-MM-DD')).toBe('2024-01-15');
    });

    it('should default to day range for unknown view', () => {
      const date = new Date('2024-01-15T12:00:00+08:00');
      const { start, end } = getDateRange(date, 'unknown' as any);
      
      const startMoment = moment(start).tz('Asia/Taipei');
      expect(startMoment.format('YYYY-MM-DD')).toBe('2024-01-15');
    });
  });

  describe('formatTimeString', () => {
    it('should format 24-hour time to 12-hour format', () => {
      expect(formatTimeString('09:00')).toBe('9:00 AM');
      expect(formatTimeString('14:30')).toBe('2:30 PM');
      expect(formatTimeString('00:00')).toBe('12:00 AM');
      expect(formatTimeString('12:00')).toBe('12:00 PM');
      expect(formatTimeString('23:59')).toBe('11:59 PM');
    });

    it('should handle invalid time strings', () => {
      expect(formatTimeString('')).toBe('');
      expect(formatTimeString('invalid')).toBe('invalid');
      expect(formatTimeString('9')).toBe('9');
    });

    it('should handle edge cases', () => {
      expect(formatTimeString('00:00')).toBe('12:00 AM');
      expect(formatTimeString('12:00')).toBe('12:00 PM');
      expect(formatTimeString('13:00')).toBe('1:00 PM');
    });
  });

  describe('getScrollToTime', () => {
    it('should return date set to 9 AM in Taiwan timezone', () => {
      const currentDate = new Date('2024-01-15T14:30:00+08:00');
      const result = getScrollToTime(currentDate);
      
      const resultMoment = moment(result).tz('Asia/Taipei');
      expect(resultMoment.hour()).toBe(9);
      expect(resultMoment.minute()).toBe(0);
      expect(resultMoment.second()).toBe(0);
      expect(resultMoment.format('YYYY-MM-DD')).toBe('2024-01-15');
    });

    it('should preserve the date while changing time', () => {
      const currentDate = new Date('2024-12-31T23:59:59+08:00');
      const result = getScrollToTime(currentDate);
      
      const resultMoment = moment(result).tz('Asia/Taipei');
      expect(resultMoment.format('YYYY-MM-DD')).toBe('2024-12-31');
      expect(resultMoment.hour()).toBe(9);
    });
  });
});


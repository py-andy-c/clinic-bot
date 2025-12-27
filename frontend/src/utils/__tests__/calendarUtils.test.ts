/**
 * Unit tests for calendar utility functions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import moment from 'moment-timezone';
import {
  getDateString,
  formatAppointmentTimeRange,
  getDateRange,
  formatTimeString,
  getScrollToTime,
  isToday,
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

  describe('formatAppointmentTimeRange', () => {
    it('should format appointment time with date and weekday', () => {
      const start = new Date('2024-01-15T09:00:00+08:00');
      const end = new Date('2024-01-15T10:00:00+08:00');
      const result = formatAppointmentTimeRange(start, end);
      
      expect(result).toContain('2024/1/15');
      expect(result).toContain('09:00');
      expect(result).toContain('10:00');
    });

    it('should include weekday in Chinese', () => {
      const start = new Date('2024-01-15T09:00:00+08:00'); // Monday
      const end = new Date('2024-01-15T10:00:00+08:00');
      const result = formatAppointmentTimeRange(start, end);
      
      // Should contain weekday in Chinese (一, 二, 三, etc.)
      expect(result).toMatch(/[一二三四五六日]/);
    });

    it('should format PM times correctly', () => {
      const start = new Date('2024-01-15T14:00:00+08:00');
      const end = new Date('2024-01-15T15:00:00+08:00');
      const result = formatAppointmentTimeRange(start, end);
      
      expect(result).toContain('14:00');
    });

    it('should use standardized format YYYY/M/D(weekday) H:MM AM/PM - H:MM AM/PM', () => {
      const start = new Date('2024-01-15T09:00:00+08:00');
      const end = new Date('2024-01-15T10:00:00+08:00');
      const result = formatAppointmentTimeRange(start, end);
      
      // Should match format: 2024/1/15(一) 09:00 - 10:00
      expect(result).toMatch(/^\d{4}\/\d{1,2}\/\d{1,2}\([一二三四五六日]\)\s+\d{2}:\d{2}\s+-\s+\d{2}:\d{2}$/);
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

    it('should return week range for week view', () => {
      // 2024-01-15 is a Monday
      const date = new Date('2024-01-15T12:00:00+08:00');
      const { start, end } = getDateRange(date, 'week');
      
      const startMoment = moment(start).tz('Asia/Taipei');
      const endMoment = moment(end).tz('Asia/Taipei');
      
      // Week should start on Sunday (2024-01-14) and end on Saturday (2024-01-20)
      // moment.js with zh-tw locale uses Sunday as the first day of the week
      expect(startMoment.format('YYYY-MM-DD')).toBe('2024-01-14');
      expect(endMoment.format('YYYY-MM-DD')).toBe('2024-01-20');
      expect(startMoment.day()).toBe(0); // Sunday
      expect(endMoment.day()).toBe(6); // Saturday
    });

    it('should handle week view across month boundaries', () => {
      // 2024-01-31 is a Wednesday, week should span Jan 28 - Feb 3
      const date = new Date('2024-01-31T12:00:00+08:00');
      const { start, end } = getDateRange(date, 'week');
      
      const startMoment = moment(start).tz('Asia/Taipei');
      const endMoment = moment(end).tz('Asia/Taipei');
      
      expect(startMoment.format('YYYY-MM-DD')).toBe('2024-01-28');
      expect(endMoment.format('YYYY-MM-DD')).toBe('2024-02-03');
      expect(startMoment.day()).toBe(0); // Sunday
      expect(endMoment.day()).toBe(6); // Saturday
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
    it('should format time in 24-hour format', () => {
      expect(formatTimeString('09:00')).toBe('09:00');
      expect(formatTimeString('14:30')).toBe('14:30');
      expect(formatTimeString('00:00')).toBe('00:00');
      expect(formatTimeString('12:00')).toBe('12:00');
      expect(formatTimeString('23:59')).toBe('23:59');
    });

    it('should handle invalid time strings', () => {
      expect(formatTimeString('')).toBe('');
      expect(formatTimeString('invalid')).toBe('invalid');
      expect(formatTimeString('9')).toBe('9');
    });

    it('should handle edge cases', () => {
      expect(formatTimeString('00:00')).toBe('00:00');
      expect(formatTimeString('12:00')).toBe('12:00');
      expect(formatTimeString('13:00')).toBe('13:00');
    });
  });

  describe('getScrollToTime', () => {
    it('should return date set to 9:00 AM in Taiwan timezone', () => {
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

  describe('isToday', () => {
    it('should return true for today in Taiwan timezone', () => {
      const todayTaiwan = moment.tz('Asia/Taipei');
      const todayDate = new Date(todayTaiwan.year(), todayTaiwan.month(), todayTaiwan.date());
      expect(isToday(todayDate)).toBe(true);
    });

    it('should return false for yesterday in Taiwan timezone', () => {
      const yesterdayTaiwan = moment.tz('Asia/Taipei').subtract(1, 'day');
      const yesterdayDate = new Date(yesterdayTaiwan.year(), yesterdayTaiwan.month(), yesterdayTaiwan.date());
      expect(isToday(yesterdayDate)).toBe(false);
    });

    it('should return false for tomorrow in Taiwan timezone', () => {
      const tomorrowTaiwan = moment.tz('Asia/Taipei').add(1, 'day');
      const tomorrowDate = new Date(tomorrowTaiwan.year(), tomorrowTaiwan.month(), tomorrowTaiwan.date());
      expect(isToday(tomorrowDate)).toBe(false);
    });

    it('should correctly identify today even when browser timezone differs', () => {
      // Create a date that represents today in Taiwan timezone
      const todayTaiwan = moment.tz('Asia/Taipei').startOf('day');
      const todayDate = todayTaiwan.toDate();
      
      // The function should use Taiwan timezone, not browser timezone
      expect(isToday(todayDate)).toBe(true);
    });
  });
});

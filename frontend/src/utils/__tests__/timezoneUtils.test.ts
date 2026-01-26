import { extractAppointmentDateTime, parseTaiwanTime } from '../timezoneUtils';

describe('timezoneUtils', () => {
  describe('extractAppointmentDateTime', () => {
    test('extracts date and time from ISO string correctly', () => {
      const isoString = '2024-01-15T14:30:00.000+08:00';
      const result = extractAppointmentDateTime(isoString);

      expect(result).toEqual({
        date: '2024-01-15',
        startTime: '14:30:00.000+08:00',
      });
    });

    test('handles ISO string without milliseconds', () => {
      const isoString = '2024-01-15T09:15:00+08:00';
      const result = extractAppointmentDateTime(isoString);

      expect(result).toEqual({
        date: '2024-01-15',
        startTime: '09:15:00+08:00',
      });
    });

    test('throws error for invalid input types', () => {
      expect(() => extractAppointmentDateTime(null as any)).toThrow('Invalid input: startTimeIsoString must be a non-empty string');
      expect(() => extractAppointmentDateTime('')).toThrow('Invalid input: startTimeIsoString must be a non-empty string');
      expect(() => extractAppointmentDateTime(123 as any)).toThrow('Invalid input: startTimeIsoString must be a non-empty string');
    });

    test('throws error for malformed ISO strings', () => {
      expect(() => extractAppointmentDateTime('2024-01-15')).toThrow('Invalid ISO string format: missing "T" separator');
      expect(() => extractAppointmentDateTime('invalid-date')).toThrow('Invalid ISO string format: missing "T" separator');
      expect(() => extractAppointmentDateTime('2024-01-15T')).toThrow('Invalid time format in ISO string');
      expect(() => extractAppointmentDateTime('2024T14:30:00')).toThrow('Invalid date format in ISO string');
    });
  });

  describe('parseTaiwanTime', () => {
    test('parses ISO string in Taiwan timezone', () => {
      const isoString = '2024-01-15T14:30:00.000+08:00';
      const result = parseTaiwanTime(isoString);

      expect(result.format('YYYY-MM-DD HH:mm')).toBe('2024-01-15 14:30');
      expect(result.tz()).toBe('Asia/Taipei');
    });

    test('throws error for invalid inputs', () => {
      expect(() => parseTaiwanTime(null as any)).toThrow('Invalid input: isoString must be a non-empty string');
      expect(() => parseTaiwanTime('')).toThrow('Invalid input: isoString must be a non-empty string');
      expect(() => parseTaiwanTime('invalid-date')).toThrow('Invalid datetime string format');
    });
  });
});
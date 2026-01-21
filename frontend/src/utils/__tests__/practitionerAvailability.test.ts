import { describe, it, expect } from 'vitest';
import { extractPractitionerAvailability, isTimeSlotAvailable, CalendarPractitionerAvailability } from '../practitionerAvailability';
import moment from 'moment-timezone';

describe('practitionerAvailability', () => {
  describe('extractPractitionerAvailability', () => {
    it('should extract availability from calendar API response', () => {
      const calendarResults = [
        {
          user_id: 1,
          date: '2024-01-15',
          default_schedule: [
            { start_time: '09:00', end_time: '12:00' },
            { start_time: '13:00', end_time: '17:00' }
          ],
          events: []
        },
        {
          user_id: 2,
          date: '2024-01-15',
          default_schedule: [
            { start_time: '08:00', end_time: '17:00' }
          ],
          events: []
        }
      ];

      const result = extractPractitionerAvailability(calendarResults);

      expect(result).toEqual({
        1: {
          schedule: {
            '2024-01-15': [
              { start_time: '09:00', end_time: '12:00' },
              { start_time: '13:00', end_time: '17:00' }
            ]
          }
        },
        2: {
          schedule: {
            '2024-01-15': [
              { start_time: '08:00', end_time: '17:00' }
            ]
          }
        }
      });
    });

    it('should handle empty results', () => {
      const result = extractPractitionerAvailability([]);
      expect(result).toEqual({});
    });
  });

  describe('isTimeSlotAvailable', () => {
    const mockAvailability: CalendarPractitionerAvailability = {
      1: {
        schedule: {
          '2024-01-15': [ // Monday
            { start_time: '09:00', end_time: '12:00' },
            { start_time: '13:00', end_time: '17:00' }
          ],
          '2024-01-16': [ // Tuesday
            { start_time: '10:00', end_time: '15:00' }
          ]
        }
      }
    };

    it('should return true for time slots within practitioner availability', () => {
      // Monday, 10:00 should be available (within 09:00-12:00)
      const monday = new Date('2024-01-15'); // Monday
      const result = isTimeSlotAvailable(1, monday, 10, 0, mockAvailability);
      expect(result).toBe(true);
    });

    it('should correctly identify time slots within and outside practitioner availability', () => {
      const monday = new Date('2024-01-15'); // Monday

      // Test slots WITHIN practitioner availability
      // Monday, 11:00 should be available (within 09:00-12:00 interval)
      const resultWithin1 = isTimeSlotAvailable(1, monday, 11, 0, mockAvailability);
      expect(resultWithin1).toBe(true);

      // Monday, 15:00 should be available (within 13:00-17:00 interval)
      const resultWithin2 = isTimeSlotAvailable(1, monday, 15, 0, mockAvailability);
      expect(resultWithin2).toBe(true);

      // Test slots OUTSIDE practitioner availability
      // Monday, 12:30 should be unavailable (gap between 12:00 and 13:00)
      const resultOutside1 = isTimeSlotAvailable(1, monday, 12, 30, mockAvailability);
      expect(resultOutside1).toBe(false);

      // Monday, 18:00 should be unavailable (after 17:00 end time)
      const resultOutside2 = isTimeSlotAvailable(1, monday, 18, 0, mockAvailability);
      expect(resultOutside2).toBe(false);
    });

    it('should return false for unknown practitioners (conservative safety approach)', () => {
      const monday = new Date('2024-01-15'); // Monday
      const result = isTimeSlotAvailable(999, monday, 10, 0, mockAvailability);
      expect(result).toBe(false);
    });

    it('should use business hours when useBusinessHours is true', () => {
      const monday = new Date('2024-01-15'); // Monday

      // 10:00 should be available (within 9AM-6PM)
      const result1 = isTimeSlotAvailable(1, monday, 10, 0, mockAvailability, true);
      expect(result1).toBe(true);

      // 8:00 should be unavailable (before 9AM)
      const result2 = isTimeSlotAvailable(1, monday, 8, 0, mockAvailability, true);
      expect(result2).toBe(false);

      // 18:00 should be unavailable (after 6PM)
      const result3 = isTimeSlotAvailable(1, monday, 18, 0, mockAvailability, true);
      expect(result3).toBe(false);
    });

    it('should handle time slots at exact boundaries', () => {
      const monday = new Date('2024-01-15'); // Monday

      // 09:00 should be available (start of first interval)
      const result1 = isTimeSlotAvailable(1, monday, 9, 0, mockAvailability);
      expect(result1).toBe(true);

      // 12:00 should be unavailable (end of first interval)
      const result2 = isTimeSlotAvailable(1, monday, 12, 0, mockAvailability);
      expect(result2).toBe(false);

      // 13:00 should be available (start of second interval)
      const result3 = isTimeSlotAvailable(1, monday, 13, 0, mockAvailability);
      expect(result3).toBe(true);

      // 17:00 should be unavailable (end of second interval)
      const result4 = isTimeSlotAvailable(1, monday, 17, 0, mockAvailability);
      expect(result4).toBe(false);
    });

    it('should handle different dates', () => {
      // Test Monday schedule: 09:00-12:00 and 13:00-17:00
      const monday = new Date('2024-01-15'); // Monday

      // 11:00 should be available (within 09:00-12:00)
      const result1 = isTimeSlotAvailable(1, monday, 11, 0, mockAvailability);
      expect(result1).toBe(true);

      // 15:00 should be available (within 13:00-17:00)
      const result2 = isTimeSlotAvailable(1, monday, 15, 0, mockAvailability);
      expect(result2).toBe(true);

      // 12:30 should be unavailable (gap between schedules)
      const result3 = isTimeSlotAvailable(1, monday, 12, 30, mockAvailability);
      expect(result3).toBe(false);

      // Test Tuesday schedule: 10:00-15:00
      const tuesday = new Date('2024-01-16'); // Tuesday

      // 11:00 should be available (within 10:00-15:00)
      const result4 = isTimeSlotAvailable(1, tuesday, 11, 0, mockAvailability);
      expect(result4).toBe(true);

      // 16:00 should be unavailable (after schedule end)
      const result5 = isTimeSlotAvailable(1, tuesday, 16, 0, mockAvailability);
      expect(result5).toBe(false);

      // Test Wednesday - no schedule, should be completely unavailable
      const wednesday = new Date('2024-01-17'); // Wednesday (no schedule in mock data)

      // All times should be unavailable when no schedule exists
      const result6 = isTimeSlotAvailable(1, wednesday, 11, 0, mockAvailability);
      expect(result6).toBe(false);

      const result7 = isTimeSlotAvailable(1, wednesday, 8, 0, mockAvailability);
      expect(result7).toBe(false);

      const result8 = isTimeSlotAvailable(1, wednesday, 18, 0, mockAvailability);
      expect(result8).toBe(false);
    });

    it('should handle null practitionerId for business hours mode', () => {
      const monday = new Date('2024-01-15'); // Monday

      // 10:00 should be available
      const result1 = isTimeSlotAvailable(null, monday, 10, 0, mockAvailability, true);
      expect(result1).toBe(true);

      // 8:00 should be unavailable
      const result2 = isTimeSlotAvailable(null, monday, 8, 0, mockAvailability, true);
      expect(result2).toBe(false);
    });

    it('should support resource availability checking based on practitioner schedules', () => {
      const monday = new Date('2024-01-15'); // Monday

      // For resources, we typically check if ANY practitioner is available
      // This test verifies the underlying logic works correctly for resource scenarios

      // When practitioner 1 is available at 11:00
      const result1 = isTimeSlotAvailable(1, monday, 11, 0, mockAvailability);
      expect(result1).toBe(true);

      // When practitioner 1 is not available at 12:30
      const result2 = isTimeSlotAvailable(1, monday, 12, 30, mockAvailability);
      expect(result2).toBe(false);

      // Unknown practitioner should be unavailable (for resource safety)
      const result3 = isTimeSlotAvailable(999, monday, 11, 0, mockAvailability);
      expect(result3).toBe(false);
    });

    it('should handle malformed API data gracefully', () => {
      // Test with null input
      const result1 = extractPractitionerAvailability(null as any);
      expect(result1).toEqual({});

      // Test with invalid result objects
      const result2 = extractPractitionerAvailability([
        null,
        undefined,
        { invalid: 'object' }
      ] as any);
      expect(result2).toEqual({});

      // Test with invalid date format
      const result3 = extractPractitionerAvailability([
        {
          user_id: 1,
          date: 'invalid-date',
          default_schedule: [{ start_time: '09:00', end_time: '17:00' }],
          events: []
        }
      ]);
      expect(result3).toEqual({});

      // Test with invalid time formats
      const result4 = extractPractitionerAvailability([
        {
          user_id: 1,
          date: '2024-01-15',
          default_schedule: [
            { start_time: '25:00', end_time: '17:00' }, // Invalid hour
            { start_time: '09:00', end_time: '99:00' }, // Invalid minute
            { start_time: '09:00', end_time: '17:00' }  // Valid
          ],
          events: []
        }
      ]);
      expect(result4[1].schedule['2024-01-15']).toEqual([
        { start_time: '09:00', end_time: '17:00' }
      ]);
    });
  });
});
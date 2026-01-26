import moment from 'moment-timezone';

const isDevelopment = import.meta.env.DEV;

export interface TimeInterval {
  start_time: string;
  end_time: string;
}

export interface CalendarPractitionerAvailability {
  [practitionerId: number]: {
    schedule: Record<string, TimeInterval[]>; // Key is date string (YYYY-MM-DD)
  };
}

/**
 * Extracts practitioner availability from calendar API response
 * @param calendarResults - Results from the batch calendar API
 * @returns PractitionerAvailability mapping
 */
export function extractPractitionerAvailability(calendarResults: Array<{
  user_id: number;
  date: string;
  default_schedule: TimeInterval[]; // Array of intervals for the specific date
  events: any[];
}>): CalendarPractitionerAvailability {
  // Input validation
  if (!Array.isArray(calendarResults)) {
    if (isDevelopment) console.warn('extractPractitionerAvailability: calendarResults is not an array');
    return {};
  }
  const availability: CalendarPractitionerAvailability = {};

  calendarResults.forEach(result => {
    // Validate result structure
    if (!result || typeof result !== 'object') {
      if (isDevelopment) console.warn('extractPractitionerAvailability: Invalid result object', result);
      return;
    }

    if (!result.user_id || typeof result.user_id !== 'number') {
      if (isDevelopment) console.warn('extractPractitionerAvailability: Invalid user_id', result.user_id);
      return;
    }

    if (!result.date || typeof result.date !== 'string') {
      if (isDevelopment) console.warn('extractPractitionerAvailability: Invalid date', result.date);
      return;
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(result.date)) {
      if (isDevelopment) console.warn('extractPractitionerAvailability: Invalid date format', result.date);
      return;
    }

    // Validate schedule array
    let validSchedule: TimeInterval[] = [];
    if (Array.isArray(result.default_schedule)) {
      validSchedule = result.default_schedule.filter(interval => {
        if (!interval || typeof interval !== 'object') {
          if (isDevelopment) console.warn('extractPractitionerAvailability: Invalid interval object', interval);
          return false;
        }

        // Validate time format (HH:MM)
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(interval.start_time) || !timeRegex.test(interval.end_time)) {
          if (isDevelopment) console.warn('extractPractitionerAvailability: Invalid time format', interval);
          return false;
        }

        return true;
      });
    }

    availability[result.user_id] = {
      schedule: {
        ...(availability[result.user_id]?.schedule || {}),
        [result.date]: validSchedule
      }
    };
  });

  return availability;
}

/**
 * Checks if a specific time slot is available for a practitioner
 * @param practitionerId - The practitioner ID (can be null for weekly view business hours)
 * @param date - The date to check (Date object)
 * @param hour - Hour (0-23)
 * @param minute - Minute (0, 15, 30, 45)
 * @param practitionerAvailability - The availability data
 * @param useBusinessHours - If true, use business hours (9AM-6PM) instead of practitioner schedule (legacy compatibility)
 * @returns true if the time slot is available, false if unavailable
 */
export function isTimeSlotAvailable(
  practitionerId: number | null,
  date: Date,
  hour: number,
  minute: number,
  practitionerAvailability: CalendarPractitionerAvailability,
  useBusinessHours: boolean = false
): boolean {
  // For business hours mode (legacy/compatibility - not used in calendar)
  if (useBusinessHours || practitionerId === null) {
    return hour >= 9 && hour < 18;
  }

  const availability = practitionerAvailability[practitionerId];
  if (!availability) {
    // If no availability data, practitioner is not available (conservative approach for safety)
    return false;
  }

  // Get the date string for this specific date
  // NOTE: Using Asia/Taipei timezone for date calculations to match clinic's primary location
  // TODO: Make timezone configurable based on clinic settings
  const dateString = moment(date).tz('Asia/Taipei').format('YYYY-MM-DD');

  // Get schedule intervals for this date
  const dateSchedule = availability.schedule[dateString];
  if (!dateSchedule || dateSchedule.length === 0) {
    // No schedule for this date - practitioner is not available this day
    return false;
  }

  // Create time string for the slot (HH:MM)
  const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

  // Check if this time falls within any availability interval
  return dateSchedule.some(interval => {
    return timeString >= interval.start_time && timeString < interval.end_time;
  });
}

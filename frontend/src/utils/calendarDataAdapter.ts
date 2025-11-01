import { ApiCalendarEvent, MonthlyCalendarData } from '../types';
import moment from 'moment-timezone';

export interface CalendarEvent {
  id: number;
  title: string;
  start: Date;
  end: Date;
  resource: {
    type: 'appointment' | 'availability_exception' | 'availability';
    isOutsideHours?: boolean;
    calendar_event_id: number;
    patient_id?: number;
    appointment_type_id?: number;
    status?: string;
    exception_id?: number;
    appointment_id?: number; // For appointment cancellation
  };
}

export interface MonthlyCalendarEvent {
  date: string;
  appointmentCount: number;
}

/**
 * Transform API calendar events to React Big Calendar format
 */
export const transformToCalendarEvents = (apiEvents: (ApiCalendarEvent | any)[]): CalendarEvent[] => {
  const taiwanTimezone = 'Asia/Taipei';
  
  return apiEvents.map(event => {
    // Create dates in Taiwan timezone
    const startDateTime = moment.tz(`${(event as any).date}T${event.start_time || '00:00'}`, taiwanTimezone);
    const endDateTime = moment.tz(`${(event as any).date}T${event.end_time || '23:59'}`, taiwanTimezone);
    
    return {
      id: event.calendar_event_id,
      title: event.title,
      start: startDateTime.toDate(),
      end: endDateTime.toDate(),
      resource: {
        type: event.type as 'appointment' | 'availability_exception' | 'availability',
        isOutsideHours: false, // Will be calculated based on default schedule
        calendar_event_id: event.calendar_event_id,
        patient_id: event.patient_id,
        appointment_type_id: event.appointment_type_id,
        status: event.status,
        exception_id: event.exception_id,
        appointment_id: event.appointment_id
      }
    };
  });
};

/**
 * Transform monthly calendar data for React Big Calendar
 */
export const transformMonthlyData = (monthlyData: MonthlyCalendarData): MonthlyCalendarEvent[] => {
  return monthlyData.days.map(day => ({
    date: day.date,
    appointmentCount: day.appointment_count
  }));
};

/**
 * Check if an event is outside consultation hours
 */
export const isEventOutsideHours = (event: CalendarEvent, defaultSchedule: any[]): boolean => {
  if (!event.start || !event.end) return false;

  const eventStart = event.start.toTimeString().substring(0, 5);
  const eventEnd = event.end.toTimeString().substring(0, 5);

  // Check if the event time overlaps with any default schedule interval
  return !defaultSchedule.some(interval => {
    const intervalStart = interval.start_time;
    const intervalEnd = interval.end_time;

    return eventStart >= intervalStart && eventEnd <= intervalEnd;
  });
};

/**
 * Get event color based on type and outside hours status
 */
export const getEventColor = (eventType: string, isOutsideHours: boolean): string => {
  if (eventType === 'appointment') {
    return isOutsideHours ? '#F59E0B' : '#3B82F6'; // Orange for outside hours, blue for normal
  }
  return '#EF4444'; // Red for availability exceptions
};

/**
 * Generate time slots for daily view
 */
export const generateTimeSlots = (startHour: number = 8, endHour: number = 22): string[] => {
  const slots: string[] = [];
  for (let hour = startHour; hour < endHour; hour++) {
    for (let minute = 0; minute < 60; minute += 30) {
      const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      slots.push(timeString);
    }
  }
  return slots;
};

/**
 * Format time for display
 */
export const formatTime = (timeStr: string): string => {
  return timeStr.substring(0, 5); // HH:MM format
};

/**
 * Get events for a specific time slot
 */
export const getEventsForSlot = (slotTime: string, events: CalendarEvent[]): CalendarEvent[] => {
  const slotStart = new Date(`2000-01-01T${slotTime}`);
  const slotEnd = new Date(slotStart.getTime() + 30 * 60000); // 30 minutes later

  return events.filter(event => {
    const eventStart = new Date(`2000-01-01T${event.start.toTimeString().substring(0, 5)}`);
    const eventEnd = new Date(`2000-01-01T${event.end.toTimeString().substring(0, 5)}`);

    return eventStart < slotEnd && eventEnd > slotStart;
  });
};

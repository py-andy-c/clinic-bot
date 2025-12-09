import { ApiCalendarEvent } from '../types';
import moment from 'moment-timezone';

export interface CalendarEvent {
  id: number;
  title: string;
  start: Date;
  end: Date;
  resource: {
    type: 'appointment' | 'availability_exception' | 'availability';
    calendar_event_id: number;
    patient_id?: number;
    appointment_type_id?: number;
    status?: string;
    exception_id?: number;
    appointment_id?: number; // For appointment cancellation
    notes?: string; // Patient-provided notes
    clinic_notes?: string; // Clinic internal notes (visible only to clinic users)
    patient_phone?: string;
    patient_birthday?: string;
    line_display_name?: string;
    patient_name?: string;
    practitioner_name?: string;
    appointment_type_name?: string;
    practitioner_id?: number | null; // For multi-practitioner calendar view (null for auto-assigned when user is not admin)
    is_primary?: boolean; // Whether this is the primary practitioner's event
    event_practitioner_name?: string; // Name of practitioner who owns this event (for multi-practitioner view)
    is_auto_assigned?: boolean; // Whether appointment is auto-assigned (shows "不指定" to patient)
    originally_auto_assigned?: boolean; // Whether appointment was originally auto-assigned (for tracking)
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
        calendar_event_id: event.calendar_event_id,
        patient_id: event.patient_id,
        appointment_type_id: event.appointment_type_id,
        status: event.status,
        exception_id: event.exception_id,
        appointment_id: event.appointment_id,
        notes: event.notes,
        clinic_notes: event.clinic_notes,
        patient_phone: event.patient_phone,
        patient_birthday: event.patient_birthday,
        line_display_name: event.line_display_name,
        patient_name: event.patient_name,
        practitioner_name: event.practitioner_name,
        appointment_type_name: event.appointment_type_name,
        practitioner_id: (event as any).practitioner_id, // Preserve practitioner ID for color-coding
        is_primary: (event as any).is_primary, // Preserve primary flag
        event_practitioner_name: (event as any).practitioner_name || (event as any).event_practitioner_name, // Preserve event practitioner name
        is_auto_assigned: (event as any).is_auto_assigned // Preserve auto-assignment flag
      }
    };
  });
};

/**
 * Format event time range for display (e.g., "10:30 AM - 11:00 AM")
 * Uses Taiwan timezone for consistent formatting.
 * 
 * @param start - Start date/time of the event
 * @param end - End date/time of the event
 * @returns Formatted time range string
 */
export const formatEventTimeRange = (start: Date, end: Date): string => {
  const taiwanTimezone = 'Asia/Taipei';
  const startMoment = moment(start).tz(taiwanTimezone);
  const endMoment = moment(end).tz(taiwanTimezone);
  const startStr = startMoment.format('h:mm A');
  const endStr = endMoment.format('h:mm A');
  return `${startStr} - ${endStr}`;
};

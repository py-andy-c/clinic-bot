import { ApiCalendarEvent } from '../types';
import moment from 'moment-timezone';

export interface CalendarEvent {
  id: number | string; // Can be number for practitioner events or string for resource events (composite key)
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
    has_active_receipt?: boolean; // Whether appointment has an active (non-voided) receipt
    has_any_receipt?: boolean; // Whether appointment has any receipt (active or voided)
    receipt_id?: number | null; // ID of active receipt (null if no active receipt)
    receipt_ids?: number[]; // List of all receipt IDs (always included, empty if none)
        resource_names?: string[]; // Names of allocated resources
        resource_ids?: number[]; // IDs of allocated resources
        is_resource_event?: boolean; // Whether this is a resource calendar event
        resource_id?: number; // Resource ID for resource calendar events
        resource_name?: string; // Resource name for resource calendar events
      };
    }

export interface MonthlyCalendarEvent {
  date: string;
  appointmentCount: number;
}

/**
 * Transform API calendar events to React Big Calendar format
 */
export const transformToCalendarEvents = (apiEvents: ApiCalendarEvent[]): any[] => {
  const taiwanTimezone = 'Asia/Taipei';
  
  return apiEvents.map(event => {
    // Extended event type to include all possible fields from API
    type ExtendedApiCalendarEvent = ApiCalendarEvent & {
      date?: string;
      practitioner_id?: number | null;
      is_primary?: boolean;
      event_practitioner_name?: string;
      is_auto_assigned?: boolean;
      has_active_receipt?: boolean;
      has_any_receipt?: boolean;
      receipt_id?: number | null;
      receipt_ids?: number[];
      resource_names?: string[];
      resource_ids?: number[];
      is_resource_event?: boolean;
      resource_id?: number;
      resource_name?: string;
      clinic_notes?: string;
    };
    const extendedEvent = event as ExtendedApiCalendarEvent;

    // Create dates in Taiwan timezone
    const eventDate = extendedEvent.date || '';
    const startDateTime = moment.tz(`${eventDate}T${event.start_time || '00:00'}`, taiwanTimezone);
    const endDateTime = moment.tz(`${eventDate}T${event.end_time || '23:59'}`, taiwanTimezone);

    // For resource events, use composite ID to ensure unique React keys
    // Format: calendar_event_id-resource-{resource_id}
    const eventId = event.calendar_event_id;
    const isResourceEvent = extendedEvent.is_resource_event === true;
    const resourceId = extendedEvent.resource_id;
    const uniqueId = isResourceEvent && resourceId
      ? `${eventId}-resource-${resourceId}`
      : eventId;

    return {
      id: uniqueId,
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
        clinic_notes: (event as ApiCalendarEvent & { clinic_notes?: string }).clinic_notes,
        patient_phone: event.patient_phone,
        patient_birthday: event.patient_birthday,
        line_display_name: event.line_display_name,
        patient_name: event.patient_name,
        practitioner_name: event.practitioner_name,
        appointment_type_name: event.appointment_type_name,
        practitioner_id: extendedEvent.practitioner_id, // Preserve practitioner ID for color-coding
        is_primary: extendedEvent.is_primary, // Preserve primary flag
        event_practitioner_name: extendedEvent.practitioner_name || extendedEvent.event_practitioner_name, // Preserve event practitioner name
        is_auto_assigned: extendedEvent.is_auto_assigned, // Preserve auto-assignment flag
        has_active_receipt: extendedEvent.has_active_receipt || false, // Active receipt status
        has_any_receipt: extendedEvent.has_any_receipt || false, // Any receipt status (for constraint enforcement)
        receipt_id: extendedEvent.receipt_id || null, // Active receipt ID
        receipt_ids: extendedEvent.receipt_ids || [], // All receipt IDs
        resource_names: extendedEvent.resource_names || [], // Allocated resource names
        resource_ids: extendedEvent.resource_ids || [], // Allocated resource IDs
        is_resource_event: extendedEvent.is_resource_event || false, // Whether this is a resource calendar event
        resource_id: extendedEvent.resource_id, // Resource ID for resource calendar events
        resource_name: extendedEvent.resource_name, // Resource name for resource calendar events
      }
    };
  });
};

/**
 * Format event time range for display (e.g., "10:30 - 11:00")
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
  const startStr = startMoment.format('HH:mm');
  const endStr = endMoment.format('HH:mm');
  return `${startStr} - ${endStr}`;
};

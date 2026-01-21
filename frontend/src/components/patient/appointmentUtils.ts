import moment from "moment-timezone";
import { CalendarEvent } from "../../utils/calendarDataAdapter";
import { logger } from "../../utils/logger";

interface Appointment {
  id: number; // calendar_event_id (old format)
  calendar_event_id?: number; // explicit field (new format)
  patient_id: number;
  patient_name: string;
  practitioner_id?: number | null; // Optional - hidden for auto-assigned appointments when user is not admin
  practitioner_name: string;
  appointment_type_id?: number;
  appointment_type_name: string;
  event_name?: string; // Effective calendar event name (custom_event_name or default format)
  start_time: string;
  end_time: string;
  status: string;
  notes?: string | null; // Patient-provided notes
  clinic_notes?: string | null; // Clinic internal notes
  line_display_name?: string | null;
  originally_auto_assigned?: boolean;
  is_auto_assigned?: boolean;
  has_active_receipt?: boolean; // Whether appointment has an active (non-voided) receipt
  has_any_receipt?: boolean; // Whether appointment has any receipt (active or voided)
  receipt_id?: number | null; // ID of active receipt (null if no active receipt)
  receipt_ids?: number[]; // List of all receipt IDs (always included, empty if none)
  resource_names?: string[]; // Names of allocated resources
  resource_ids?: number[]; // IDs of allocated resources
}

/**
 * Converts appointment data from patient appointments API to CalendarEvent format.
 * Handles both old API format (id = calendar_event_id) and new format (explicit calendar_event_id field).
 *
 * @param appointment - Appointment data from getPatientAppointments API
 * @returns CalendarEvent object compatible with calendar modals
 * @throws Error if required fields are missing
 */
export function appointmentToCalendarEvent(
  appointment: Appointment,
): CalendarEvent {
  // Handle both old API format (id = calendar_event_id) and new format (explicit calendar_event_id field)
  const calendarEventId = appointment.calendar_event_id ?? appointment.id;

  if (!calendarEventId) {
    throw new Error("Missing calendar_event_id in appointment data");
  }

  // Validate required fields
  if (!appointment.start_time || !appointment.end_time) {
    throw new Error("Missing start_time or end_time in appointment data");
  }

  const startMoment = moment.tz(appointment.start_time, "Asia/Taipei");
  const endMoment = moment.tz(appointment.end_time, "Asia/Taipei");

  // Validate dates are valid
  if (!startMoment.isValid() || !endMoment.isValid()) {
    throw new Error("Invalid date format in appointment data");
  }

  const resource: CalendarEvent["resource"] = {
    type: "appointment",
    calendar_event_id: calendarEventId,
    // Note: appointment_id is not needed for delete API (it uses calendar_event_id)
    // But we include it for consistency with CalendarEvent type
    appointment_id: calendarEventId, // Same as calendar_event_id for these APIs
    patient_id: appointment.patient_id,
    patient_name: appointment.patient_name,
    practitioner_name: appointment.practitioner_name,
    appointment_type_name: appointment.appointment_type_name,
    status: appointment.status,
    originally_auto_assigned: appointment.originally_auto_assigned ?? false,
    is_auto_assigned: appointment.is_auto_assigned ?? false,
  };

  // Only include optional fields if they are defined (for exactOptionalPropertyTypes)
  // Note: practitioner_id may be null for auto-assigned appointments when user is not admin
  if (appointment.practitioner_id !== undefined && appointment.practitioner_id !== null) {
    resource.practitioner_id = appointment.practitioner_id;
  }
  if (appointment.appointment_type_id !== undefined) {
    resource.appointment_type_id = appointment.appointment_type_id;
  }
  if (appointment.notes) {
    resource.notes = appointment.notes;
  }
  if (appointment.clinic_notes) {
    resource.clinic_notes = appointment.clinic_notes;
  }
  if (appointment.line_display_name) {
    resource.line_display_name = appointment.line_display_name;
  }
  if (appointment.resource_names && appointment.resource_names.length > 0) {
    resource.resource_names = appointment.resource_names;
  }
  if (appointment.resource_ids && appointment.resource_ids.length > 0) {
    resource.resource_ids = appointment.resource_ids;
  }
  if (appointment.has_active_receipt !== undefined) {
    resource.has_active_receipt = appointment.has_active_receipt;
  }
  if (appointment.has_any_receipt !== undefined) {
    resource.has_any_receipt = appointment.has_any_receipt;
  }
  if (appointment.receipt_id !== undefined) {
    resource.receipt_id = appointment.receipt_id;
  }
  if (appointment.receipt_ids !== undefined) {
    // Validate that receipt_ids is actually an array of numbers
    if (Array.isArray(appointment.receipt_ids) &&
        appointment.receipt_ids.every(id => typeof id === 'number' && !isNaN(id))) {
      resource.receipt_ids = appointment.receipt_ids;
    } else {
      logger.warn('Invalid receipt_ids format, skipping:', appointment.receipt_ids);
    }
  }

  // Use event_name if available (custom event name), otherwise use default format
  const title =
    appointment.event_name ||
    `${appointment.patient_name} - ${appointment.appointment_type_name}`;

  return {
    id: calendarEventId,
    title,
    start: startMoment.toDate(),
    end: endMoment.toDate(),
    resource,
  };
}

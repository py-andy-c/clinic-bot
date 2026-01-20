/**
 * Event Permissions Utility
 *
 * Shared permission logic for calendar events across the application.
 * Provides consistent permission checking for event operations.
 */

import { CalendarEvent } from '../utils/calendarDataAdapter';
import { canEditAppointment } from './appointmentPermissions';

export interface UserContext {
  userId: number | undefined;
  isAdmin: boolean;
}

/**
 * Check if a user can edit a calendar event
 * This consolidates the logic used across AvailabilityPage and PatientAppointmentsList
 */
export function canEditEvent(event: CalendarEvent | null, canEdit: boolean, userContext: UserContext): boolean {
  if (!event || !canEdit || !userContext.userId) return false;

  // Use shared utility for appointments
  if (event.resource.type === "appointment") {
    return canEditAppointment(event, userContext.userId, userContext.isAdmin);
  }

  // For other events, check if it's their own event
  // Use practitioner_id if available, otherwise fallback to userId
  const eventPractitionerId = event.resource.practitioner_id || userContext.userId;
  return eventPractitionerId === userContext.userId;
}
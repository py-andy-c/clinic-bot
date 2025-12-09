import { CalendarEvent } from './calendarDataAdapter';

/**
 * Check if user can edit/delete an appointment.
 * 
 * Rules:
 * - Admins can edit/delete any appointment
 * - Practitioners can only edit/delete own appointments that are NOT auto-assigned
 * - Practitioners cannot edit/delete auto-assigned appointments, even if assigned to them
 * 
 * @param event - The calendar event to check
 * @param userId - Current user's ID
 * @param isAdmin - Whether the current user is an admin
 * @returns true if user can edit/delete the appointment
 */
export const canEditAppointment = (
  event: CalendarEvent | null,
  userId: number | undefined,
  isAdmin: boolean
): boolean => {
  if (!event || event.resource.type !== 'appointment') return false;
  
  // Admins can edit any appointment
  if (isAdmin) return true;
  
  // Non-admin practitioners cannot edit auto-assigned appointments
  // (even if they are the assigned practitioner, they shouldn't know about it)
  const isAutoAssigned = event.resource.is_auto_assigned ?? false;
  if (isAutoAssigned) return false;
  
  // Check if it's their own appointment
  // Use practitioner_id if available, otherwise fallback to userId
  const eventPractitionerId = event.resource.practitioner_id || userId;
  return eventPractitionerId === userId;
};

/**
 * Check if user can duplicate an appointment.
 * 
 * Rules:
 * - All visible appointments can be duplicated (no ownership check)
 * - Auto-assigned appointments are filtered out by backend on calendar page
 * - On patient detail page, all appointments can be duplicated
 * - When duplicating auto-assigned appointments, practitioner_id won't be populated
 * 
 * @param event - The calendar event to check
 * @returns true if appointment can be duplicated
 */
export const canDuplicateAppointment = (
  event: CalendarEvent | null
): boolean => {
  if (!event || event.resource.type !== 'appointment') return false;
  // All visible appointments can be duplicated
  return true;
};

/**
 * Get practitioner ID for duplicate appointment, hiding it for auto-assigned appointments.
 * 
 * Security: Prevents non-admin practitioners from seeing who was auto-assigned
 * by returning undefined for auto-assigned appointments when user is not admin.
 * 
 * @param event - The calendar event to duplicate
 * @param isAdmin - Whether the current user is an admin
 * @returns practitioner_id if should be included, undefined otherwise
 */
export const getPractitionerIdForDuplicate = (
  event: CalendarEvent | null,
  isAdmin: boolean
): number | undefined => {
  if (!event || event.resource.type !== 'appointment') return undefined;
  
  const practitionerId = event.resource.practitioner_id;
  
  // Security: Hide practitioner_id for auto-assigned appointments when user is not admin
  // This prevents non-admin practitioners from seeing who was auto-assigned
  // Note: Backend should also filter/hide this, but this provides defense in depth
  const isAutoAssigned = event.resource.is_auto_assigned ?? false;
  if (isAutoAssigned && !isAdmin) {
    return undefined; // Don't include practitioner_id for auto-assigned appointments
  }
  
  return practitionerId ?? undefined;
};


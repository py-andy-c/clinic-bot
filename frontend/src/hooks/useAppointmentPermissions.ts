import { useCallback } from 'react';
import { CalendarEvent } from '../utils/calendarDataAdapter';
import { canEditAppointment, canDuplicateAppointment, getPractitionerIdForDuplicate } from '../utils/appointmentPermissions';

export interface AppointmentPermissions {
  canEdit: boolean;
  isAdmin: boolean;
  userId: number | undefined;
}

/**
 * Hook that provides consistent appointment permission checking logic
 * Used by both calendar page and patient detail page
 */
export const useAppointmentPermissions = (permissions: AppointmentPermissions) => {
  const { canEdit, isAdmin, userId } = permissions;

  /**
   * Check if user can edit/delete an event
   * Handles both appointments and other event types
   */
  const canEditEvent = useCallback(
    (event: CalendarEvent | null): boolean => {
      if (!event || !canEdit) return false;

      if (event.resource.type === 'appointment') {
        return canEditAppointment(event, userId, isAdmin);
      }

      // For other events (availability exceptions), check ownership
      const eventPractitionerId = event.resource.practitioner_id || userId;
      return eventPractitionerId === userId;
    },
    [canEdit, isAdmin, userId]
  );

  /**
   * Check if appointment can be duplicated
   */
  const canDuplicateEvent = useCallback(
    (event: CalendarEvent | null): boolean => {
      return canDuplicateAppointment(event);
    },
    []
  );

  /**
   * Get practitioner ID for duplicate, handling auto-assigned permissions
   */
  const getPractitionerIdForDuplicateEvent = useCallback(
    (event: CalendarEvent): number | undefined => {
      return getPractitionerIdForDuplicate(event, isAdmin);
    },
    [isAdmin]
  );

  return {
    canEditEvent,
    canDuplicateEvent,
    getPractitionerIdForDuplicateEvent,
  };
};
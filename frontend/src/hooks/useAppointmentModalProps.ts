// No React hooks needed for this simple props generator
import { CalendarEvent } from '../utils/calendarDataAdapter';

export interface AppointmentModalPropsOptions {
  selectedEvent: CalendarEvent | null;
  canEditEvent: (event: CalendarEvent | null) => boolean;
  canDuplicateEvent: (event: CalendarEvent | null) => boolean;
  handleEditAppointment: () => void;
  handleDeleteAppointment: () => void;
  handleDuplicateAppointment: () => void;
}

/**
 * Hook that generates consistent modal props for appointment interactions
 * Provides EventModal props that conditionally show buttons based on permissions
 */
export const useAppointmentModalProps = (options: AppointmentModalPropsOptions) => {
  const {
    selectedEvent,
    canEditEvent,
    canDuplicateEvent,
    handleEditAppointment,
    handleDeleteAppointment,
    handleDuplicateAppointment,
  } = options;

  // EventModal props - conditionally show buttons based on permissions
  const eventModalProps = {
    onEditAppointment: canEditEvent(selectedEvent) ? handleEditAppointment : undefined,
    onDeleteAppointment: canEditEvent(selectedEvent) ? handleDeleteAppointment : undefined,
    onDuplicateAppointment: canDuplicateEvent(selectedEvent) ? handleDuplicateAppointment : undefined,
  };

  return {
    eventModalProps,
  };
};
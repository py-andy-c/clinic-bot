import { useCallback } from 'react';
import { CalendarEvent } from '../utils/calendarDataAdapter';

export interface AppointmentActionsOptions {
  selectedEvent: CalendarEvent | null;
  canEditEvent: (event: CalendarEvent | null) => boolean;
  canDuplicateEvent: (event: CalendarEvent | null) => boolean;
  getPractitionerIdForDuplicateEvent: (event: CalendarEvent) => number | undefined;
  openEditModal: () => void;
  openDeleteModal: () => void;
  openDuplicateModal: (data: {
    initialDate?: string;
    preSelectedAppointmentTypeId?: number;
    preSelectedPractitionerId?: number;
    preSelectedTime?: string;
    preSelectedClinicNotes?: string;
    event?: CalendarEvent;
  }) => void;
}

/**
 * Hook that provides event handlers for appointment interactions
 * Handles the business logic for edit, delete, and duplicate actions
 */
export const useAppointmentActions = (options: AppointmentActionsOptions) => {
  const {
    selectedEvent,
    canEditEvent,
    canDuplicateEvent,
    getPractitionerIdForDuplicateEvent,
    openEditModal,
    openDeleteModal,
    openDuplicateModal,
  } = options;

  const handleEditAppointment = useCallback(async () => {
    if (!selectedEvent || !canEditEvent(selectedEvent)) {
      return;
    }
    openEditModal();
  }, [selectedEvent, canEditEvent, openEditModal]);

  const handleDeleteAppointment = useCallback(async () => {
    if (!selectedEvent || !canEditEvent(selectedEvent)) {
      return;
    }
    openDeleteModal();
  }, [selectedEvent, canEditEvent, openDeleteModal]);

  const handleDuplicateAppointment = useCallback(async () => {
    if (!selectedEvent || !canDuplicateEvent(selectedEvent)) {
      return;
    }

    const event = selectedEvent;
    const appointmentTypeId = event.resource.appointment_type_id;
    const practitionerId = getPractitionerIdForDuplicateEvent(event);
    const clinicNotes = event.resource.clinic_notes;

    // Extract date and time
    const startMoment = event.start;
    const initialDate = startMoment.toISOString().split('T')[0];
    const initialTime = startMoment.toTimeString().slice(0, 5);

    openDuplicateModal({
      ...(initialDate && { initialDate }),
      ...(appointmentTypeId !== undefined && { preSelectedAppointmentTypeId: appointmentTypeId }),
      ...(practitionerId !== undefined && { preSelectedPractitionerId: practitionerId }),
      ...(initialTime && { preSelectedTime: initialTime }),
      ...(clinicNotes !== undefined && clinicNotes !== null && { preSelectedClinicNotes: clinicNotes }),
      event,
    });
  }, [selectedEvent, canDuplicateEvent, getPractitionerIdForDuplicateEvent, openDuplicateModal]);

  return {
    handleEditAppointment,
    handleDeleteAppointment,
    handleDuplicateAppointment,
  };
};
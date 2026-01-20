/**
 * Appointment Modal Orchestrator
 *
 * A shared component that manages all appointment-related modals,
 * replacing complex inline modal state management with a unified system.
 */

import React from 'react';
import { ModalState, AppointmentModalData } from '../../types/modal';
import { CreateAppointmentModal } from '../calendar/CreateAppointmentModal';
import { EditAppointmentModal } from '../calendar/EditAppointmentModal';
import { DeleteConfirmationModal } from '../calendar/DeleteConfirmationModal';
import { apiService } from '../../services/api';
import { logger } from '../../utils/logger';
import { useModal } from '../../contexts/ModalContext';
import { AppointmentType } from '../../types';

interface AppointmentModalOrchestratorProps {
  modalState: ModalState<AppointmentModalData>;
  onModalChange: (state: ModalState<AppointmentModalData>) => void;
  practitioners: { id: number; full_name: string }[];
  appointmentTypes: AppointmentType[];
  onRefresh?: (forceRefresh?: boolean) => void | Promise<void>;
  canEditEvent?: (event: any) => boolean;
}

export const AppointmentModalOrchestrator: React.FC<AppointmentModalOrchestratorProps> = ({
  modalState,
  onModalChange,
  practitioners,
  appointmentTypes,
  onRefresh,
  canEditEvent = () => true,
}) => {
  const { alert } = useModal();

  const handleClose = () => {
    onModalChange({ type: null });
  };

  const handleCreateAppointment = async (formData: any) => {
    try {
      await apiService.createClinicAppointment(formData);
      await alert("預約已建立");
      if (onRefresh) await onRefresh(true); // Force refresh to show new appointment
      onModalChange({ type: null });
    } catch (error) {
      logger.error('Failed to create appointment:', error);
      throw error;
    }
  };

  const handleUpdateAppointment = async (formData: any) => {
    const event = modalState.data?.event;
    if (!event?.id || typeof event.id !== 'number') return;

    if (!canEditEvent(event)) {
      await alert('您只能編輯自己的預約');
      return;
    }

    try {
      const updateData: any = {
        appointment_type_id: formData.appointment_type_id,
        practitioner_id: formData.practitioner_id,
        start_time: formData.start_time,
      };

      if (formData.clinic_notes !== undefined) {
        updateData.clinic_notes = formData.clinic_notes;
      }

      await apiService.editClinicAppointment(event.id, updateData);
      if (onRefresh) await onRefresh(true); // Force refresh after editing
      onModalChange({ type: null });
    } catch (error) {
      logger.error('Failed to update appointment:', error);
      throw error;
    }
  };

  const handleDeleteAppointment = async () => {
    const event = modalState.data?.event;
    if (!event?.id || typeof event.id !== 'number') return;

    if (!canEditEvent(event)) {
      alert('您只能取消自己的預約');
      return;
    }

    try {
      await apiService.cancelClinicAppointment(event.id);
      if (onRefresh) await onRefresh(true); // Force refresh after deleting
      onModalChange({ type: null });
    } catch (error) {
      logger.error('Failed to cancel appointment:', error);
      throw error;
    }
  };

  return (
    <>
      {/* Create Appointment Modal */}
      {modalState.type === 'create_appointment' && modalState.data && (
        <CreateAppointmentModal
          key="create-appointment-modal"
          initialDate={modalState.data.initialDate || null}
          {...(modalState.data.patientId !== undefined && { preSelectedPatientId: modalState.data.patientId })}
          {...(modalState.data.preSelectedAppointmentTypeId !== undefined && { preSelectedAppointmentTypeId: modalState.data.preSelectedAppointmentTypeId })}
          {...(modalState.data.preSelectedPractitionerId !== undefined && { preSelectedPractitionerId: modalState.data.preSelectedPractitionerId })}
          {...(modalState.data.preSelectedTime !== undefined && { preSelectedTime: modalState.data.preSelectedTime })}
          {...(modalState.data.preSelectedClinicNotes !== undefined && { preSelectedClinicNotes: modalState.data.preSelectedClinicNotes })}
          {...(modalState.data.event !== undefined && { event: modalState.data.event })}
          onClose={handleClose}
          onConfirm={handleCreateAppointment}
          onRecurringAppointmentsCreated={async () => {
            if (onRefresh) await onRefresh(true); // Force refresh for recurring appointments
          }}
          practitioners={practitioners}
          appointmentTypes={appointmentTypes}
        />
      )}

      {/* Edit Appointment Modal */}
      {modalState.type === 'edit_appointment' && modalState.data?.event && (
        <EditAppointmentModal
          event={modalState.data.event}
          practitioners={practitioners}
          appointmentTypes={appointmentTypes}
          onClose={handleClose}
          onComplete={async () => {
            onModalChange({ type: null });
          }}
          onConfirm={handleUpdateAppointment}
          formatAppointmentTime={(start, end) =>
            `${start.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`
          }
        />
      )}

      {/* Delete Confirmation Modal */}
      {modalState.type === 'delete_confirmation' && modalState.data?.event && (
        <DeleteConfirmationModal
          event={modalState.data.event}
          onCancel={handleClose}
          onConfirm={handleDeleteAppointment}
        />
      )}
    </>
  );
};
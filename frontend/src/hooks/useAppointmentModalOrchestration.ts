import { CalendarEvent } from '../utils/calendarDataAdapter';
import { useAppointmentPermissions, AppointmentPermissions } from './useAppointmentPermissions';
import { useAppointmentModalState } from './useAppointmentModalState';
import { useAppointmentActions } from './useAppointmentActions';
import { useAppointmentModalProps } from './useAppointmentModalProps';

export interface AppointmentModalOrchestrationOptions {
  selectedEvent: CalendarEvent | null;
  permissions: AppointmentPermissions;
  onRefresh: () => void | Promise<void>;
}

/**
 * Composed hook that provides complete appointment modal orchestration
 * Combines smaller hooks for modal state, actions, and props generation
 * Used by both calendar page and patient detail page for consistent behavior
 */
export const useAppointmentModalOrchestration = (options: AppointmentModalOrchestrationOptions) => {
  const { selectedEvent, permissions, onRefresh } = options;

  // Use smaller hooks for separation of concerns
  const { canEditEvent, canDuplicateEvent, getPractitionerIdForDuplicateEvent } = useAppointmentPermissions(permissions);

  const modalState = useAppointmentModalState();

  const actions = useAppointmentActions({
    selectedEvent,
    canEditEvent,
    canDuplicateEvent,
    getPractitionerIdForDuplicateEvent,
    openEditModal: modalState.openEditModal,
    openDeleteModal: modalState.openDeleteModal,
    openDuplicateModal: modalState.openDuplicateModal,
  });

  const { eventModalProps } = useAppointmentModalProps({
    selectedEvent,
    canEditEvent,
    canDuplicateEvent,
    handleEditAppointment: actions.handleEditAppointment,
    handleDeleteAppointment: actions.handleDeleteAppointment,
    handleDuplicateAppointment: actions.handleDuplicateAppointment,
  });

  // Success handlers that refresh data and close modals
  const handleEditSuccess = async () => {
    modalState.closeEditModal();
    await onRefresh();
  };

  const handleCreateSuccess = async () => {
    modalState.closeCreateModal();
    await onRefresh();
  };

  const handleDeleteSuccess = async () => {
    modalState.closeDeleteModal();
    await onRefresh();
  };

  // Modal render props - extend state with success handlers
  const editModalProps = modalState.modalStates.isEditModalOpen && selectedEvent ? {
    event: selectedEvent,
    onClose: modalState.closeEditModal,
    onComplete: handleEditSuccess,
  } : null;

  const createModalProps = modalState.modalStates.isCreateModalOpen ? {
    key: modalState.createModalKey,
    initialDate: modalState.duplicateData?.initialDate || null,
    preSelectedAppointmentTypeId: modalState.duplicateData?.preSelectedAppointmentTypeId,
    preSelectedPractitionerId: modalState.duplicateData?.preSelectedPractitionerId,
    preSelectedTime: modalState.duplicateData?.preSelectedTime,
    preSelectedClinicNotes: modalState.duplicateData?.preSelectedClinicNotes,
    event: modalState.duplicateData?.event,
    onClose: modalState.closeCreateModal,
    onConfirm: handleCreateSuccess,
  } : null;

  const deleteModalProps = modalState.modalStates.isDeleteModalOpen && selectedEvent ? {
    event: selectedEvent,
    onCancel: modalState.closeDeleteModal,
    onConfirm: handleDeleteSuccess,
  } : null;

  return {
    // Permission helpers
    canEditEvent,
    canDuplicateEvent,

    // EventModal props
    eventModalProps,

    // Modal render data
    editModalProps,
    createModalProps,
    deleteModalProps,

    // State for components that need to manage their own modals
    modalStates: modalState.modalStates,

    // Actions for manual modal control
    actions: {
      openEditModal: modalState.openEditModal,
      openCreateModal: modalState.openCreateModal,
      openDeleteModal: modalState.openDeleteModal,
      closeEditModal: modalState.closeEditModal,
      closeCreateModal: modalState.closeCreateModal,
      closeDeleteModal: modalState.closeDeleteModal,
    },

    // Success handlers (for testing)
    handleEditSuccess,
    handleCreateSuccess,
    handleDeleteSuccess,
  };
};
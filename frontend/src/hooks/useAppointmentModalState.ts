import { useState } from 'react';
import { CalendarEvent } from '../utils/calendarDataAdapter';

/**
 * Hook that manages modal state for appointment interactions
 * Provides a clean interface for opening/closing modals and tracking their state
 */
export const useAppointmentModalState = () => {
  // Modal open/close state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // Duplicate appointment data
  const [duplicateData, setDuplicateData] = useState<{
    initialDate?: string;
    preSelectedAppointmentTypeId?: number;
    preSelectedPractitionerId?: number;
    preSelectedTime?: string;
    preSelectedClinicNotes?: string;
    event?: CalendarEvent;
  } | null>(null);
  const [createModalKey, setCreateModalKey] = useState(0);

  // Actions for opening/closing modals
  const openEditModal = () => setIsEditModalOpen(true);
  const closeEditModal = () => setIsEditModalOpen(false);

  const openCreateModal = () => {
    setDuplicateData(null); // Clear any duplicate data for new appointments
    setCreateModalKey(prev => prev + 1);
    setIsCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    setIsCreateModalOpen(false);
    setDuplicateData(null);
  };

  const openDeleteModal = () => setIsDeleteModalOpen(true);
  const closeDeleteModal = () => setIsDeleteModalOpen(false);

  // Utility to set duplicate data and open create modal
  const openDuplicateModal = (data: {
    initialDate?: string;
    preSelectedAppointmentTypeId?: number;
    preSelectedPractitionerId?: number;
    preSelectedTime?: string;
    preSelectedClinicNotes?: string;
    event?: CalendarEvent;
  }) => {
    setDuplicateData(data);
    setCreateModalKey(prev => prev + 1);
    setIsCreateModalOpen(true);
  };

  return {
    // State
    modalStates: {
      isEditModalOpen,
      isCreateModalOpen,
      isDeleteModalOpen,
    },
    duplicateData,
    createModalKey,

    // Actions
    openEditModal,
    closeEditModal,
    openCreateModal,
    closeCreateModal,
    openDeleteModal,
    closeDeleteModal,
    openDuplicateModal,
  };
};
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppointmentModalState } from '../useAppointmentModalState';
import { CalendarEvent } from '../../utils/calendarDataAdapter';

describe('useAppointmentModalState', () => {
  const mockEvent: CalendarEvent = {
    id: 1,
    title: 'Test Appointment',
    start: new Date('2024-01-15T10:00:00'),
    end: new Date('2024-01-15T11:00:00'),
    patientName: 'Test Patient',
    resource: {
      practitioner_id: 1,
      resource_id: null,
      type: 'appointment',
      appointment_type_id: 1,
      clinic_notes: 'Test clinic notes',
      patient_id: 1,
    },
    notes: 'Test notes',
    patient_id: 1,
    appointment_type_id: 1,
    clinic_notes: 'Test clinic notes',
  };

  it('should initialize with all modals closed', () => {
    const { result } = renderHook(() => useAppointmentModalState());

    expect(result.current.modalStates.isEditModalOpen).toBe(false);
    expect(result.current.modalStates.isCreateModalOpen).toBe(false);
    expect(result.current.modalStates.isDeleteModalOpen).toBe(false);
    expect(result.current.duplicateData).toBeNull();
    expect(result.current.createModalKey).toBe(0);
  });

  it('should open and close edit modal', () => {
    const { result } = renderHook(() => useAppointmentModalState());

    // Open modal
    act(() => {
      result.current.openEditModal();
    });
    expect(result.current.modalStates.isEditModalOpen).toBe(true);

    // Close modal
    act(() => {
      result.current.closeEditModal();
    });
    expect(result.current.modalStates.isEditModalOpen).toBe(false);
  });

  it('should open and close create modal for new appointments', () => {
    const { result } = renderHook(() => useAppointmentModalState());

    // Open modal
    act(() => {
      result.current.openCreateModal();
    });
    expect(result.current.modalStates.isCreateModalOpen).toBe(true);
    expect(result.current.duplicateData).toBeNull(); // Should clear duplicate data
    expect(result.current.createModalKey).toBe(1); // Should increment key

    // Close modal
    act(() => {
      result.current.closeCreateModal();
    });
    expect(result.current.modalStates.isCreateModalOpen).toBe(false);
    expect(result.current.duplicateData).toBeNull();
  });

  it('should open and close delete modal', () => {
    const { result } = renderHook(() => useAppointmentModalState());

    // Open modal
    act(() => {
      result.current.openDeleteModal();
    });
    expect(result.current.modalStates.isDeleteModalOpen).toBe(true);

    // Close modal
    act(() => {
      result.current.closeDeleteModal();
    });
    expect(result.current.modalStates.isDeleteModalOpen).toBe(false);
  });

  it('should open duplicate modal with data', () => {
    const { result } = renderHook(() => useAppointmentModalState());
    const duplicateData = {
      initialDate: '2024-01-15',
      preSelectedAppointmentTypeId: 1,
      preSelectedPractitionerId: 2,
      preSelectedTime: '10:00',
      preSelectedClinicNotes: 'Test notes',
      event: mockEvent,
    };

    act(() => {
      result.current.openDuplicateModal(duplicateData);
    });

    expect(result.current.modalStates.isCreateModalOpen).toBe(true);
    expect(result.current.duplicateData).toEqual(duplicateData);
    expect(result.current.createModalKey).toBe(1);
  });

  it('should increment create modal key on each open', () => {
    const { result } = renderHook(() => useAppointmentModalState());

    // Open multiple times
    act(() => {
      result.current.openCreateModal();
    });
    expect(result.current.createModalKey).toBe(1);

    act(() => {
      result.current.openCreateModal();
    });
    expect(result.current.createModalKey).toBe(2);

    act(() => {
      result.current.openDuplicateModal({ event: mockEvent });
    });
    expect(result.current.createModalKey).toBe(3);
  });

  it('should clear duplicate data when closing create modal', () => {
    const { result } = renderHook(() => useAppointmentModalState());

    // Open with duplicate data
    act(() => {
      result.current.openDuplicateModal({ event: mockEvent });
    });
    expect(result.current.duplicateData).not.toBeNull();

    // Close modal
    act(() => {
      result.current.closeCreateModal();
    });
    expect(result.current.duplicateData).toBeNull();
  });
});
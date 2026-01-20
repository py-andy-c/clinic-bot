import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppointmentActions } from '../useAppointmentActions';
import { CalendarEvent } from '../../utils/calendarDataAdapter';

describe('useAppointmentActions', () => {
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

  const mockCanEditEvent = vi.fn();
  const mockCanDuplicateEvent = vi.fn();
  const mockGetPractitionerIdForDuplicateEvent = vi.fn();
  const mockOpenEditModal = vi.fn();
  const mockOpenDeleteModal = vi.fn();
  const mockOpenDuplicateModal = vi.fn();

  const defaultOptions = {
    selectedEvent: mockEvent,
    canEditEvent: mockCanEditEvent,
    canDuplicateEvent: mockCanDuplicateEvent,
    getPractitionerIdForDuplicateEvent: mockGetPractitionerIdForDuplicateEvent,
    openEditModal: mockOpenEditModal,
    openDeleteModal: mockOpenDeleteModal,
    openDuplicateModal: mockOpenDuplicateModal,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleEditAppointment', () => {
    it('should open edit modal when user can edit', async () => {
      mockCanEditEvent.mockReturnValue(true);

      const { result } = renderHook(() =>
        useAppointmentActions(defaultOptions)
      );

      await act(async () => {
        await result.current.handleEditAppointment();
      });

      expect(mockCanEditEvent).toHaveBeenCalledWith(mockEvent);
      expect(mockOpenEditModal).toHaveBeenCalled();
    });

    it('should not open edit modal when user cannot edit', async () => {
      mockCanEditEvent.mockReturnValue(false);

      const { result } = renderHook(() =>
        useAppointmentActions(defaultOptions)
      );

      await act(async () => {
        await result.current.handleEditAppointment();
      });

      expect(mockCanEditEvent).toHaveBeenCalledWith(mockEvent);
      expect(mockOpenEditModal).not.toHaveBeenCalled();
    });

    it('should not open edit modal when no event is selected', async () => {
      const { result } = renderHook(() =>
        useAppointmentActions({ ...defaultOptions, selectedEvent: null })
      );

      await act(async () => {
        await result.current.handleEditAppointment();
      });

      expect(mockCanEditEvent).not.toHaveBeenCalled();
      expect(mockOpenEditModal).not.toHaveBeenCalled();
    });
  });

  describe('handleDeleteAppointment', () => {
    it('should open delete modal when user can edit', async () => {
      mockCanEditEvent.mockReturnValue(true);

      const { result } = renderHook(() =>
        useAppointmentActions(defaultOptions)
      );

      await act(async () => {
        await result.current.handleDeleteAppointment();
      });

      expect(mockCanEditEvent).toHaveBeenCalledWith(mockEvent);
      expect(mockOpenDeleteModal).toHaveBeenCalled();
    });

    it('should not open delete modal when user cannot edit', async () => {
      mockCanEditEvent.mockReturnValue(false);

      const { result } = renderHook(() =>
        useAppointmentActions(defaultOptions)
      );

      await act(async () => {
        await result.current.handleDeleteAppointment();
      });

      expect(mockCanEditEvent).toHaveBeenCalledWith(mockEvent);
      expect(mockOpenDeleteModal).not.toHaveBeenCalled();
    });
  });

  describe('handleDuplicateAppointment', () => {
    it('should open duplicate modal with correct data when user can duplicate', async () => {
      mockCanDuplicateEvent.mockReturnValue(true);
      mockGetPractitionerIdForDuplicateEvent.mockReturnValue(1);

      const { result } = renderHook(() =>
        useAppointmentActions(defaultOptions)
      );

      await act(async () => {
        await result.current.handleDuplicateAppointment();
      });

      expect(mockCanDuplicateEvent).toHaveBeenCalledWith(mockEvent);
      expect(mockGetPractitionerIdForDuplicateEvent).toHaveBeenCalledWith(mockEvent);
      expect(mockOpenDuplicateModal).toHaveBeenCalledWith({
        initialDate: '2024-01-15',
        preSelectedAppointmentTypeId: 1,
        preSelectedPractitionerId: 1,
        preSelectedTime: '10:00',
        preSelectedClinicNotes: 'Test clinic notes',
        event: mockEvent,
      });
    });

    it('should not open duplicate modal when user cannot duplicate', async () => {
      mockCanDuplicateEvent.mockReturnValue(false);

      const { result } = renderHook(() =>
        useAppointmentActions(defaultOptions)
      );

      await act(async () => {
        await result.current.handleDuplicateAppointment();
      });

      expect(mockCanDuplicateEvent).toHaveBeenCalledWith(mockEvent);
      expect(mockOpenDuplicateModal).not.toHaveBeenCalled();
    });

    it('should handle undefined practitioner ID', async () => {
      mockCanDuplicateEvent.mockReturnValue(true);
      mockGetPractitionerIdForDuplicateEvent.mockReturnValue(undefined);

      const { result } = renderHook(() =>
        useAppointmentActions(defaultOptions)
      );

      await act(async () => {
        await result.current.handleDuplicateAppointment();
      });

      expect(mockOpenDuplicateModal).toHaveBeenCalledWith({
        initialDate: '2024-01-15',
        preSelectedAppointmentTypeId: 1,
        preSelectedTime: '10:00',
        preSelectedClinicNotes: 'Test clinic notes',
        event: mockEvent,
        // Note: preSelectedPractitionerId is not included when undefined
      });
      const callArgs = mockOpenDuplicateModal.mock.calls[0][0];
      expect(callArgs.preSelectedPractitionerId).toBeUndefined();
    });

    it('should handle null clinic notes', async () => {
      const eventWithoutNotes = {
        ...mockEvent,
        resource: {
          ...mockEvent.resource,
          clinic_notes: null,
        },
      };

      mockCanDuplicateEvent.mockReturnValue(true);
      mockGetPractitionerIdForDuplicateEvent.mockReturnValue(1);

      const { result } = renderHook(() =>
        useAppointmentActions({ ...defaultOptions, selectedEvent: eventWithoutNotes })
      );

      await act(async () => {
        await result.current.handleDuplicateAppointment();
      });

      expect(mockOpenDuplicateModal).toHaveBeenCalledWith({
        initialDate: '2024-01-15',
        preSelectedAppointmentTypeId: 1,
        preSelectedPractitionerId: 1,
        preSelectedTime: '10:00',
        event: eventWithoutNotes,
        // Note: preSelectedClinicNotes is not included when null
      });
      const callArgs = mockOpenDuplicateModal.mock.calls[0][0];
      expect(callArgs.preSelectedClinicNotes).toBeUndefined();
    });
  });
});
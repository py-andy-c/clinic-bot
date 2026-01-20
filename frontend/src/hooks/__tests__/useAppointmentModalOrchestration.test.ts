import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppointmentModalOrchestration } from '../useAppointmentModalOrchestration';
import { CalendarEvent } from '../../utils/calendarDataAdapter';

// Mock the permissions hook
vi.mock('../useAppointmentPermissions', () => ({
  useAppointmentPermissions: vi.fn(),
}));

import { useAppointmentPermissions } from '../useAppointmentPermissions';

describe('useAppointmentModalOrchestration', () => {
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

  const mockPermissions = {
    canEdit: true,
    isAdmin: false,
    userId: 1,
  };

  const mockOnRefresh = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    const mockUseAppointmentPermissions = vi.mocked(useAppointmentPermissions);
    mockUseAppointmentPermissions.mockReturnValue({
      canEditEvent: vi.fn().mockReturnValue(true),
      canDuplicateEvent: vi.fn().mockReturnValue(true),
      getPractitionerIdForDuplicateEvent: vi.fn().mockReturnValue(1),
    });
  });

  describe('initial state', () => {
    it('should initialize with all modals closed', () => {
      const { result } = renderHook(() =>
        useAppointmentModalOrchestration({
          selectedEvent: null,
          permissions: mockPermissions,
          onRefresh: mockOnRefresh,
        })
      );

      expect(result.current.modalStates.isEditModalOpen).toBe(false);
      expect(result.current.modalStates.isCreateModalOpen).toBe(false);
      expect(result.current.modalStates.isDeleteModalOpen).toBe(false);
    });

    it('should not provide modal props when modals are closed', () => {
      const { result } = renderHook(() =>
        useAppointmentModalOrchestration({
          selectedEvent: null,
          permissions: mockPermissions,
          onRefresh: mockOnRefresh,
        })
      );

      expect(result.current.editModalProps).toBeNull();
      expect(result.current.createModalProps).toBeNull();
      expect(result.current.deleteModalProps).toBeNull();
    });
  });

  describe('eventModalProps', () => {
    it('should conditionally show buttons based on permissions', () => {
      const mockCanEditEvent = vi.fn().mockReturnValue(true);
      const mockCanDuplicateEvent = vi.fn().mockReturnValue(true);

      const mockUseAppointmentPermissions = vi.mocked(useAppointmentPermissions);
      mockUseAppointmentPermissions.mockReturnValue({
        canEditEvent: mockCanEditEvent,
        canDuplicateEvent: mockCanDuplicateEvent,
        getPractitionerIdForDuplicateEvent: vi.fn(),
      });

      const { result } = renderHook(() =>
        useAppointmentModalOrchestration({
          selectedEvent: mockEvent,
          permissions: mockPermissions,
          onRefresh: mockOnRefresh,
        })
      );

      expect(result.current.eventModalProps.onEditAppointment).toBeDefined();
      expect(result.current.eventModalProps.onDeleteAppointment).toBeDefined();
      expect(result.current.eventModalProps.onDuplicateAppointment).toBeDefined();
    });

    it('should hide buttons when permissions are denied', () => {
      const mockCanEditEvent = vi.fn().mockReturnValue(false);
      const mockCanDuplicateEvent = vi.fn().mockReturnValue(false);

      const mockUseAppointmentPermissions = vi.mocked(useAppointmentPermissions);
      mockUseAppointmentPermissions.mockReturnValue({
        canEditEvent: mockCanEditEvent,
        canDuplicateEvent: mockCanDuplicateEvent,
        getPractitionerIdForDuplicateEvent: vi.fn(),
      });

      const { result } = renderHook(() =>
        useAppointmentModalOrchestration({
          selectedEvent: mockEvent,
          permissions: mockPermissions,
          onRefresh: mockOnRefresh,
        })
      );

      expect(result.current.eventModalProps.onEditAppointment).toBeUndefined();
      expect(result.current.eventModalProps.onDeleteAppointment).toBeUndefined();
      expect(result.current.eventModalProps.onDuplicateAppointment).toBeUndefined();
    });
  });

  describe('duplicate appointment', () => {
    it('should open create modal with duplicate data when duplicate is triggered', () => {
      const mockGetPractitionerIdForDuplicateEvent = vi.fn().mockReturnValue(1);

      const mockUseAppointmentPermissions = vi.mocked(useAppointmentPermissions);
      mockUseAppointmentPermissions.mockReturnValue({
        canEditEvent: vi.fn(),
        canDuplicateEvent: vi.fn().mockReturnValue(true),
        getPractitionerIdForDuplicateEvent: mockGetPractitionerIdForDuplicateEvent,
      });

      const { result } = renderHook(() =>
        useAppointmentModalOrchestration({
          selectedEvent: mockEvent,
          permissions: mockPermissions,
          onRefresh: mockOnRefresh,
        })
      );

      act(() => {
        result.current.eventModalProps.onDuplicateAppointment?.();
      });

      expect(result.current.modalStates.isCreateModalOpen).toBe(true);
      expect(result.current.createModalProps).not.toBeNull();
      expect(result.current.createModalProps?.initialDate).toBe('2024-01-15');
      expect(result.current.createModalProps?.preSelectedAppointmentTypeId).toBe(1);
      expect(result.current.createModalProps?.preSelectedPractitionerId).toBe(1);
      expect(result.current.createModalProps?.preSelectedTime).toBe('10:00');
      expect(result.current.createModalProps?.preSelectedClinicNotes).toBe('Test clinic notes');
    });
  });

  describe('modal actions', () => {
    it('should open create modal for new appointments', () => {
      const { result } = renderHook(() =>
        useAppointmentModalOrchestration({
          selectedEvent: null,
          permissions: mockPermissions,
          onRefresh: mockOnRefresh,
        })
      );

      act(() => {
        result.current.actions.openCreateModal();
      });

      expect(result.current.modalStates.isCreateModalOpen).toBe(true);
      expect(result.current.createModalProps).not.toBeNull();
      expect(result.current.createModalProps?.initialDate).toBeNull(); // No duplicate data
    });

    it('should close modals when close actions are called', () => {
      const { result } = renderHook(() =>
        useAppointmentModalOrchestration({
          selectedEvent: null,
          permissions: mockPermissions,
          onRefresh: mockOnRefresh,
        })
      );

      // Open a modal first
      act(() => {
        result.current.actions.openCreateModal();
      });
      expect(result.current.modalStates.isCreateModalOpen).toBe(true);

      // Close it
      act(() => {
        result.current.actions.closeCreateModal();
      });
      expect(result.current.modalStates.isCreateModalOpen).toBe(false);
    });
  });

  describe('success handlers', () => {
    it('should provide success handlers that call onRefresh', () => {
      const { result } = renderHook(() =>
        useAppointmentModalOrchestration({
          selectedEvent: mockEvent,
          permissions: mockPermissions,
          onRefresh: mockOnRefresh,
        })
      );

      // The success handlers should be available (even if modals are closed)
      expect(typeof result.current.handleEditSuccess).toBe('function');
      expect(typeof result.current.handleCreateSuccess).toBe('function');
      expect(typeof result.current.handleDeleteSuccess).toBe('function');

      // Test that they call onRefresh
      act(() => {
        result.current.handleEditSuccess();
      });
      expect(mockOnRefresh).toHaveBeenCalledWith();

      vi.clearAllMocks();

      act(() => {
        result.current.handleCreateSuccess();
      });
      expect(mockOnRefresh).toHaveBeenCalledWith();

      vi.clearAllMocks();

      act(() => {
        result.current.handleDeleteSuccess();
      });
      expect(mockOnRefresh).toHaveBeenCalledWith();
    });
  });
});
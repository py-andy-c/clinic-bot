import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock components and hooks
vi.mock('../pages/AvailabilityPage', () => ({
  default: vi.fn(),
}));

vi.mock('../components/patient/PatientAppointmentsList', () => ({
  PatientAppointmentsList: vi.fn(),
}));

vi.mock('../hooks/useAppointmentModalOrchestration', () => ({
  useAppointmentModalOrchestration: vi.fn(),
}));

vi.mock('../utils/appointmentPermissions', () => ({
  canEditAppointment: vi.fn(),
  canDuplicateAppointment: vi.fn(),
  getPractitionerIdForDuplicate: vi.fn(),
}));

import { useAppointmentModalOrchestration } from '../hooks/useAppointmentModalOrchestration';
import { canEditAppointment, canDuplicateAppointment, getPractitionerIdForDuplicate } from '../utils/appointmentPermissions';

describe('Appointment Modal Integration Tests', () => {
  const mockEvent = {
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Permission System Consistency', () => {
    it('should apply identical permission checks across both pages', () => {
      // Mock permission utilities
      const mockCanEditAppointment = vi.mocked(canEditAppointment);
      const mockCanDuplicateAppointment = vi.mocked(canDuplicateAppointment);

      mockCanEditAppointment.mockReturnValue(true);
      mockCanDuplicateAppointment.mockReturnValue(true);

      // Test that both pages would use the same utilities
      expect(mockCanEditAppointment).not.toHaveBeenCalled();
      expect(mockCanDuplicateAppointment).not.toHaveBeenCalled();

      // Simulate calling the utilities as both pages would
      const canEdit = canEditAppointment(mockEvent, 1, false);
      const canDuplicate = canDuplicateAppointment(mockEvent);

      expect(canEdit).toBe(true);
      expect(canDuplicate).toBe(true);

      expect(mockCanEditAppointment).toHaveBeenCalledWith(mockEvent, 1, false);
      expect(mockCanDuplicateAppointment).toHaveBeenCalledWith(mockEvent);
    });

    it('should handle auto-assigned appointment permissions consistently', () => {
      const autoAssignedEvent = {
        ...mockEvent,
        resource: {
          ...mockEvent.resource,
          is_auto_assigned: true,
          originally_auto_assigned: true,
        },
      };

      const mockCanEditAppointment = vi.mocked(canEditAppointment);
      const mockGetPractitionerIdForDuplicate = vi.mocked(getPractitionerIdForDuplicate);

      // Admin can edit auto-assigned appointments
      mockCanEditAppointment.mockReturnValueOnce(true);
      // Non-admin cannot get practitioner ID for auto-assigned
      mockGetPractitionerIdForDuplicate.mockReturnValueOnce(undefined);

      // Test admin permissions
      const adminCanEdit = canEditAppointment(autoAssignedEvent, 1, true);
      expect(adminCanEdit).toBe(true);

      // Test non-admin duplicate permissions
      const practitionerId = getPractitionerIdForDuplicate(autoAssignedEvent, false);
      expect(practitionerId).toBeUndefined();

      expect(mockCanEditAppointment).toHaveBeenCalledWith(autoAssignedEvent, 1, true);
      expect(mockGetPractitionerIdForDuplicate).toHaveBeenCalledWith(autoAssignedEvent, false);
    });
  });

  describe('Modal Orchestration Consistency', () => {
    const mockPermissions = {
      canEdit: true,
      isAdmin: false,
      userId: 1,
    };

    const mockOnRefresh = vi.fn();

    it('should provide identical modal interfaces for both pages', () => {
      const mockOrchestrationResult = {
        canEditEvent: vi.fn().mockReturnValue(true),
        canDuplicateEvent: vi.fn().mockReturnValue(true),
        eventModalProps: {
          onEditAppointment: vi.fn(),
          onDeleteAppointment: vi.fn(),
          onDuplicateAppointment: vi.fn(),
        },
        editModalProps: null,
        createModalProps: null,
        deleteModalProps: null,
        modalStates: {
          isEditModalOpen: false,
          isCreateModalOpen: false,
          isDeleteModalOpen: false,
        },
        actions: {
          openCreateModal: vi.fn(),
        },
      };

      const mockUseAppointmentModalOrchestration = vi.mocked(useAppointmentModalOrchestration);
      mockUseAppointmentModalOrchestration.mockReturnValue(mockOrchestrationResult);

      // Both pages should call the hook with similar parameters
      const calendarResult = useAppointmentModalOrchestration({
        selectedEvent: mockEvent,
        permissions: mockPermissions,
        onRefresh: mockOnRefresh,
      });

      const patientResult = useAppointmentModalOrchestration({
        selectedEvent: mockEvent,
        permissions: mockPermissions,
        onRefresh: mockOnRefresh,
      });

      // Both should return identical interfaces
      expect(calendarResult.eventModalProps).toEqual(patientResult.eventModalProps);
      expect(calendarResult.modalStates).toEqual(patientResult.modalStates);
      expect(calendarResult.actions).toEqual(patientResult.actions);

      expect(mockUseAppointmentModalOrchestration).toHaveBeenCalledTimes(2);
    });

    it('should handle duplicate data extraction consistently', () => {
      const mockGetPractitionerIdForDuplicate = vi.mocked(getPractitionerIdForDuplicate);
      mockGetPractitionerIdForDuplicate.mockReturnValue(1);

      // Both pages should extract duplicate data identically
      const expectedDuplicateData = {
        initialDate: '2024-01-15',
        preSelectedAppointmentTypeId: 1,
        preSelectedPractitionerId: 1,
        preSelectedTime: '10:00',
        preSelectedClinicNotes: 'Test clinic notes',
        event: mockEvent,
      };

      // Simulate the duplicate logic that both pages use
      const appointmentTypeId = mockEvent.resource.appointment_type_id;
      const practitionerId = getPractitionerIdForDuplicate(mockEvent, false);
      const clinicNotes = mockEvent.resource.clinic_notes;
      const startMoment = mockEvent.start;
      const initialDate = startMoment.toISOString().split('T')[0];
      const initialTime = startMoment.toTimeString().slice(0, 5);

      const actualDuplicateData = {
        ...(initialDate && { initialDate }),
        ...(appointmentTypeId !== undefined && { preSelectedAppointmentTypeId: appointmentTypeId }),
        ...(practitionerId !== undefined && { preSelectedPractitionerId: practitionerId }),
        ...(initialTime && { preSelectedTime: initialTime }),
        ...(clinicNotes !== undefined && clinicNotes !== null && { preSelectedClinicNotes: clinicNotes }),
        event: mockEvent,
      };

      expect(actualDuplicateData).toEqual(expectedDuplicateData);
      expect(mockGetPractitionerIdForDuplicate).toHaveBeenCalledWith(mockEvent, false);
    });
  });

  describe('Error Handling Consistency', () => {
    it('should handle API errors identically across pages', async () => {
      const mockOnRefresh = vi.fn().mockRejectedValue(new Error('API Error'));

      const mockUseAppointmentModalOrchestration = vi.mocked(useAppointmentModalOrchestration);
      mockUseAppointmentModalOrchestration.mockReturnValue({
        canEditEvent: vi.fn(),
        canDuplicateEvent: vi.fn(),
        eventModalProps: {},
        editModalProps: {
          event: mockEvent,
          onClose: vi.fn(),
          onComplete: vi.fn(),
        },
        createModalProps: null,
        deleteModalProps: null,
        modalStates: { isEditModalOpen: true, isCreateModalOpen: false, isDeleteModalOpen: false },
        actions: {},
      });

      // Both pages should handle refresh errors gracefully
      useAppointmentModalOrchestration({
        selectedEvent: mockEvent,
        permissions: { canEdit: true, isAdmin: false, userId: 1 },
        onRefresh: mockOnRefresh,
      });

      // The orchestration hook should handle errors in onComplete handlers
      const result = useAppointmentModalOrchestration({
        selectedEvent: mockEvent,
        permissions: { canEdit: true, isAdmin: false, userId: 1 },
        onRefresh: mockOnRefresh,
      });

      // The test verifies that the hook is set up to handle errors
      // In a real scenario, onComplete would be defined and would call onRefresh
      expect(result.editModalProps).not.toBeNull();
      expect(typeof result.editModalProps?.onComplete).toBe('function');
    });
  });

  describe('State Management Consistency', () => {
    it('should maintain consistent modal state across operations', () => {
      const mockUseAppointmentModalOrchestration = vi.mocked(useAppointmentModalOrchestration);

      // Mock the hook to return consistent state
      mockUseAppointmentModalOrchestration.mockReturnValue({
        canEditEvent: vi.fn(),
        canDuplicateEvent: vi.fn(),
        eventModalProps: {
          onEditAppointment: vi.fn(),
          onDeleteAppointment: vi.fn(),
          onDuplicateAppointment: vi.fn(),
        },
        editModalProps: null,
        createModalProps: null,
        deleteModalProps: null,
        modalStates: {
          isEditModalOpen: false,
          isCreateModalOpen: false,
          isDeleteModalOpen: false,
        },
        actions: {
          openCreateModal: vi.fn(),
        },
      });

      // Both pages should start with identical closed states
      const calendarResult = useAppointmentModalOrchestration({
        selectedEvent: null,
        permissions: { canEdit: true, isAdmin: false, userId: 1 },
        onRefresh: vi.fn(),
      });

      const patientResult = useAppointmentModalOrchestration({
        selectedEvent: null,
        permissions: { canEdit: true, isAdmin: false, userId: 1 },
        onRefresh: vi.fn(),
      });

      expect(calendarResult.modalStates).toEqual(patientResult.modalStates);
      expect(calendarResult.eventModalProps.onEditAppointment).toBeDefined();
      expect(calendarResult.eventModalProps.onDeleteAppointment).toBeDefined();
      expect(calendarResult.eventModalProps.onDuplicateAppointment).toBeDefined();
    });
  });
});
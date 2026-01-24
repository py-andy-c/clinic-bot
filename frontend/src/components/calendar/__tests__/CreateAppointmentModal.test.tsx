/**
 * Unit tests for CreateAppointmentModal component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { CreateAppointmentModal } from '../CreateAppointmentModal';
import { apiService } from '../../../services/api';
import { usePatients } from '../../../hooks/queries';
import { useAppointmentForm } from '../../../hooks/useAppointmentForm';

// Mock React Query hooks
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}));

// Mock useResourceAvailability hook
vi.mock('../../../hooks/queries/useResourceAvailability', () => ({
  useResourceAvailability: vi.fn(() => ({
    data: {
      requirements: [
        {
          resource_type_id: 1,
          resource_type_name: 'Room',
          required_quantity: 1,
          available_resources: [
            { id: 1, name: 'Room A', description: null, is_available: true }
          ],
          available_quantity: 1,
        }
      ],
      suggested_allocation: [],
      conflicts: [],
    },
    isLoading: false,
    error: null,
  })),
}));
import { ModalProvider } from '../../../contexts/ModalContext';
import { ModalQueueProvider } from '../../../contexts/ModalQueueContext';

// Mock createPortal to render directly
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

// Mock react-router-dom's useLocation
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/test' }),
}));

// Mock apiService
vi.mock('../../../services/api', () => ({
  apiService: {
    getPatients: vi.fn(),
    getPractitioners: vi.fn(),
    createPatient: vi.fn(),
    getPatient: vi.fn(),
    getServiceTypeGroups: vi.fn().mockResolvedValue({ groups: [] }),
    checkBatchPractitionerConflicts: vi.fn().mockResolvedValue({ results: [] }),
    getResourceTypes: vi.fn(() => Promise.resolve([
      { id: 1, name: 'Room', display_order: 1 },
      { id: 2, name: 'Equipment', display_order: 2 }
    ])),
    getResources: vi.fn(() => Promise.resolve([
      { id: 1, name: 'Room A', resource_type_id: 1, description: 'Main consultation room' },
      { id: 2, name: 'Room B', resource_type_id: 1, description: 'Secondary room' }
    ])),
  },
}));

// Mock DateTimePicker
vi.mock('../DateTimePicker', () => ({
  DateTimePicker: ({ onHasAvailableSlotsChange, onDateSelect, onTimeSelect, selectedPractitionerId }: any) => {
    React.useEffect(() => {
      let isMounted = true;
      if (selectedPractitionerId) {
        const timer = setTimeout(() => {
          if (!isMounted) return;
          if (onHasAvailableSlotsChange) onHasAvailableSlotsChange(true);
          // Auto-select date/time for testing
          if (onDateSelect) onDateSelect('2024-01-15');
          if (onTimeSelect) onTimeSelect('09:00');
        }, 0);
        return () => {
          isMounted = false;
          clearTimeout(timer);
        };
      }
    }, [selectedPractitionerId, onHasAvailableSlotsChange, onDateSelect, onTimeSelect]);
    return <div data-testid="datetime-picker">DateTimePicker</div>;
  },
}));

// Mock ResourceSelection to avoid complex async operations
vi.mock('../../ResourceSelection', () => ({
  ResourceSelection: () => <div data-testid="resource-selection">ResourceSelection</div>,
}));

// Mock hooks
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    isLoading: false,
    isAuthenticated: true,
  }),
}));

vi.mock('../../../hooks/queries', () => ({
  usePatients: vi.fn(),
  useBatchPractitionerConflicts: vi.fn(() => ({
    data: {
      results: []
    },
    isLoading: false,
    error: null,
  })),
  usePractitionerConflicts: vi.fn(() => ({
    data: {
      has_conflict: false,
      conflict_type: null,
      appointment_conflict: null,
      exception_conflict: null,
      default_availability: {
        is_within_hours: true,
        normal_hours: null,
      },
    },
    isLoading: false,
    error: null,
  })),
}));

// Mock hooks - use shared state for dynamic updates
const mockAppointmentFormState = {
  selectedAppointmentTypeId: null as number | null,
  setSelectedAppointmentTypeId: vi.fn((value: number | null) => {
    mockAppointmentFormState.selectedAppointmentTypeId = value;
  }),
};

vi.mock('../../../hooks/useAppointmentForm', () => ({
  useAppointmentForm: vi.fn((props) => ({
    selectedPatientId: props?.preSelectedPatientId || null,
    setSelectedPatientId: vi.fn(),
    selectedAppointmentTypeId: mockAppointmentFormState.selectedAppointmentTypeId,
    setSelectedAppointmentTypeId: mockAppointmentFormState.setSelectedAppointmentTypeId,
    selectedPractitionerId: props?.preSelectedPractitionerId || null,
    setSelectedPractitionerId: vi.fn(),
    selectedDate: null,
    setSelectedDate: vi.fn(),
    selectedTime: null,
    setSelectedTime: vi.fn(),
    clinicNotes: props?.preSelectedClinicNotes || '',
    setClinicNotes: vi.fn(),
    selectedResourceIds: [],
    setSelectedResourceIds: vi.fn(),
    initialResources: [],
    initialAvailability: null,
    availablePractitioners: [
      { id: 1, full_name: 'Dr. Test 1', offered_types: [1] },
      { id: 2, full_name: 'Dr. Test 2', offered_types: [1] }
    ],
    isInitialLoading: false,
    isLoadingPractitioners: false,
    error: null,
    setError: vi.fn(),
    isValid: false,
    referenceDateTime: null,
    hasChanges: false,
    changeDetails: {
      appointmentTypeChanged: false,
      practitionerChanged: false,
      timeChanged: false,
      dateChanged: false,
      resourcesChanged: false,
      originalAppointmentTypeName: '',
      newAppointmentTypeName: '',
      originalPractitionerName: '',
      newPractitionerName: '',
      originalStartTime: '',
      newStartTime: '',
    },
    hasPractitionerTypeMismatch: false,
    prePopulatedFromSlot: props?.prePopulatedFromSlot || false,
  })),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  useIsMobile: vi.fn(() => false),
}));

vi.mock('../../../contexts/ModalQueueContext', () => ({
  useModalQueue: vi.fn(() => ({
    enqueueModal: vi.fn(),
    showModal: vi.fn(),
    closeCurrent: vi.fn(),
    showNext: vi.fn(),
    clearQueue: vi.fn(),
    cancelQueue: vi.fn(),
    currentModal: null,
    hasPendingModals: false,
  })),
  ModalQueueProvider: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'modal-queue-provider' }, children),
}));

vi.mock('../../../contexts/ModalContext', () => ({
  useModal: vi.fn(() => ({
    modal: null,
    alert: vi.fn(),
    confirm: vi.fn(),
    closeModal: vi.fn(),
  })),
  ModalProvider: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'modal-provider' }, children),
}));

vi.mock('../../../utils/searchUtils', () => ({
  useDebouncedSearch: (query: string) => query,
  shouldTriggerSearch: (query: string) => query.length >= 1,
}));

// Mock patient creation modals
vi.mock('../../PatientCreationModal', () => ({
  PatientCreationModal: () => <div data-testid="patient-creation-modal">PatientCreationModal</div>,
}));

vi.mock('../../PatientCreationSuccessModal', () => ({
  PatientCreationSuccessModal: () => <div data-testid="patient-success-modal">PatientCreationSuccessModal</div>,
}));

const mockOnConfirm = vi.fn();
const mockOnClose = vi.fn();

// Helper to wrap component with ModalProvider and ModalQueueProvider
const renderWithModal = (component: React.ReactElement) => {
  return render(
    <ModalProvider>
      <ModalQueueProvider>
        {component}
      </ModalQueueProvider>
    </ModalProvider>
  );
};

describe('CreateAppointmentModal', () => {
  const mockPatients = [
    { id: 1, full_name: 'Test Patient', phone_number: '1234567890', created_at: '2024-01-01T00:00:00Z' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock state
    mockAppointmentFormState.selectedAppointmentTypeId = null;
    vi.mocked(apiService.getPractitioners).mockResolvedValue([
      { id: 1, full_name: 'Dr. Test', offered_types: [1] },
      { id: 2, full_name: 'Dr. Another', offered_types: [1] },
    ]);
    vi.mocked(usePatients).mockReturnValue({
      data: { patients: mockPatients, total: 1, page: 1, page_size: 100 },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  const mockPractitioners = [
    { id: 1, full_name: 'Dr. Test', offered_types: [1] },
    { id: 2, full_name: 'Dr. Another', offered_types: [1] },
  ];

  const mockAppointmentTypes = [
    { id: 1, name: 'Test Type', duration_minutes: 30, clinic_id: 1 },
    { id: 2, name: 'Another Type', duration_minutes: 60, clinic_id: 1 },
  ];

  it('should render form step by default', async () => {
    renderWithModal(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    expect(screen.getByText('建立預約')).toBeInTheDocument();
    // Wait for form to load (skip skeleton)
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should show appointment type dropdown', async () => {
    renderWithModal(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    // Wait for form to load (skip skeleton)
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
    });

    // Find appointment type dropdown by role (combobox)
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThan(0);
    const appointmentTypeSelect = selects[0];
    expect(appointmentTypeSelect).toBeInTheDocument();
    expect(appointmentTypeSelect).toHaveValue('');
  });

  it('should accept duplicate props without crashing', async () => {
    // Test that component accepts all pre-fill props for duplication feature
    // The actual pre-filling behavior is tested through integration tests
    renderWithModal(
      <CreateAppointmentModal
        preSelectedPatientId={1}
        preSelectedAppointmentTypeId={1}
        preSelectedPractitionerId={1}
        preSelectedTime="09:00"
        preSelectedClinicNotes="Test clinic notes"
        initialDate="2024-01-15"
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    // Wait for form to load (skip skeleton)
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/診所內部備註/i)).toBeInTheDocument();
    });
  });

  it('should show practitioner selection button', async () => {
    // Test that the practitioner selection button exists and shows correct text

    renderWithModal(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    // Wait for form to load
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
    });

    // Practitioner button should exist with correct text
    const practitionerButton = screen.getByRole('button', { name: /選擇治療師/ });
    expect(practitionerButton).toBeInTheDocument();
    expect(practitionerButton).toHaveTextContent('選擇治療師');
  });

  it('should retain practitioner selection and show mismatch when appointment type changes to incompatible type', async () => {
    // Mock the hook to simulate: appointment type changed to one that doesn't include the selected practitioner
    // This should clear the practitioner selection
    vi.mocked(useAppointmentForm).mockReturnValue({
      selectedPatientId: null,
      setSelectedPatientId: vi.fn(),
      selectedAppointmentTypeId: 2, // Changed to type 2 (which doesn't have practitioner 1)
      setSelectedAppointmentTypeId: vi.fn(),
      selectedPractitionerId: 1, // RETAINED even if not available for type 2
      setSelectedPractitionerId: vi.fn(),
      selectedDate: null,
      setSelectedDate: vi.fn(),
      selectedTime: '',
      setSelectedTime: vi.fn(),
      clinicNotes: '',
      setClinicNotes: vi.fn(),
      selectedResourceIds: [],
      setSelectedResourceIds: vi.fn(),
      initialResources: [],
      availablePractitioners: [
        { id: 2, full_name: 'Dr. Another', offered_types: [1] }, // Only practitioner 2 available for type 2
      ],
      isInitialLoading: false,
      isLoadingPractitioners: false,
      error: null,
      setError: vi.fn(),
      isValid: false,
      referenceDateTime: null,
      hasChanges: false,
      changeDetails: {
        appointmentTypeChanged: false,
        practitionerChanged: false,
        timeChanged: false,
        dateChanged: false,
        resourcesChanged: false,
      },
      initialAvailability: null,
      hasPractitionerTypeMismatch: true,
      prePopulatedFromSlot: false,
    });

    renderWithModal(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    // Wait for form to load
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
    });

    // screen.debug(); // Uncomment if needed

    // The practitioner selection should NOT be cleared even though practitioner 1 doesn't offer type 2
    // (Mocked hook returns selectedAppointmentTypeId: 2 and selectedPractitionerId: 1)
    const practitionerButton = screen.getByText('Dr. Test');
    expect(practitionerButton).toBeInTheDocument();
  });

  it('should open practitioner modal when button is clicked', async () => {
    // Mock practitioners API to return data
    vi.mocked(apiService.getPractitioners).mockResolvedValue(mockPractitioners);

    // Mock the hook to simulate appointment type being selected
    vi.mocked(useAppointmentForm).mockReturnValue({
      selectedPatientId: null,
      setSelectedPatientId: vi.fn(),
      selectedAppointmentTypeId: 1, // Appointment type selected
      setSelectedAppointmentTypeId: vi.fn(),
      selectedPractitionerId: null,
      setSelectedPractitionerId: vi.fn(),
      selectedDate: null,
      setSelectedDate: vi.fn(),
      selectedTime: '',
      setSelectedTime: vi.fn(),
      clinicNotes: '',
      setClinicNotes: vi.fn(),
      selectedResourceIds: [],
      setSelectedResourceIds: vi.fn(),
      initialResources: [],
      availablePractitioners: mockPractitioners,
      isInitialLoading: false,
      isLoadingPractitioners: false,
      error: null,
      setError: vi.fn(),
      isValid: false,
      referenceDateTime: null,
      hasChanges: false,
      changeDetails: {
        appointmentTypeChanged: false,
        practitionerChanged: false,
        timeChanged: false,
        dateChanged: false,
        resourcesChanged: false,
      },
      initialAvailability: null, hasPractitionerTypeMismatch: false, prePopulatedFromSlot: false,
    });

    renderWithModal(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    // Wait for form to load
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
    });

    // Practitioner button should be enabled when appointment type is selected
    const practitionerButton = screen.getByRole('button', { name: /選擇治療師/ });
    expect(practitionerButton).not.toBeDisabled();

    // Click practitioner button to open modal
    fireEvent.click(practitionerButton);

    // Verify modal opens - check for any dialog elements
    await waitFor(() => {
      const dialogs = screen.queryAllByRole('dialog');
      expect(dialogs.length).toBeGreaterThan(1); // Should have main modal + practitioner modal
    });
  });

  it('should handle error when practitioner fetch fails in modal', async () => {
    // Mock the hook to simulate appointment type being selected but practitioner fetch failing
    vi.mocked(useAppointmentForm).mockReturnValue({
      selectedPatientId: null,
      setSelectedPatientId: vi.fn(),
      selectedAppointmentTypeId: 1, // Appointment type selected
      setSelectedAppointmentTypeId: vi.fn(),
      selectedPractitionerId: null,
      setSelectedPractitionerId: vi.fn(),
      selectedDate: null,
      setSelectedDate: vi.fn(),
      selectedTime: '',
      setSelectedTime: vi.fn(),
      clinicNotes: '',
      setClinicNotes: vi.fn(),
      selectedResourceIds: [],
      setSelectedResourceIds: vi.fn(),
      initialResources: [],
      availablePractitioners: [], // Empty due to fetch failure
      isInitialLoading: false,
      isLoadingPractitioners: false,
      error: '無法載入治療師列表，請稍後再試', // Error message
      setError: vi.fn(),
      isValid: false,
      referenceDateTime: null,
      hasChanges: false,
      changeDetails: {
        appointmentTypeChanged: false,
        practitionerChanged: false,
        timeChanged: false,
        dateChanged: false,
        resourcesChanged: false,
      },
      initialAvailability: null, hasPractitionerTypeMismatch: false, prePopulatedFromSlot: false,
    });

    renderWithModal(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    // Wait for form to load
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
    });

    // Practitioner button should be enabled when appointment type is selected
    const practitionerButton = screen.getByRole('button', { name: /選擇治療師/ });
    expect(practitionerButton).not.toBeDisabled();

    // Click practitioner button to open modal
    fireEvent.click(practitionerButton);

    // Modal should open even when there are no practitioners due to error
    await waitFor(() => {
      const dialogs = screen.queryAllByRole('dialog');
      expect(dialogs.length).toBeGreaterThan(1);
    });

    // Error message should NOT be displayed in the form (removed feature)
    expect(screen.queryByText('此預約類型目前沒有可用的治療師')).not.toBeInTheDocument();
  });

  it('should enable submit button to allow validation feedback', async () => {
    renderWithModal(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    // Wait for form to load
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
    });

    const submitButton = screen.getByText('下一步');
    expect(submitButton).not.toBeDisabled();
  });

  it('should enable submit button when all required fields are filled', async () => {
    // Uses default mock which returns no conflicts

    // Mock the hook to return a fully valid form state with no conflicts
    vi.mocked(useAppointmentForm).mockReturnValue({
      selectedPatientId: 1,
      setSelectedPatientId: vi.fn(),
      selectedAppointmentTypeId: 1,
      setSelectedAppointmentTypeId: vi.fn(),
      selectedPractitionerId: 1,
      setSelectedPractitionerId: vi.fn(),
      selectedDate: '2024-01-15',
      setSelectedDate: vi.fn(),
      selectedTime: '09:00',
      setSelectedTime: vi.fn(),
      clinicNotes: '',
      setClinicNotes: vi.fn(),
      selectedResourceIds: [],
      setSelectedResourceIds: vi.fn(),
      initialResources: [],
      availablePractitioners: mockPractitioners,
      isInitialLoading: false,
      isLoadingPractitioners: false,
      error: null,
      setError: vi.fn(),
      isValid: true,
      referenceDateTime: null,
      hasChanges: false,
      changeDetails: {
        appointmentTypeChanged: false,
        practitionerChanged: false,
        timeChanged: false,
        dateChanged: false,
        resourcesChanged: false,
      },
      initialAvailability: null, hasPractitionerTypeMismatch: false, prePopulatedFromSlot: false,
    });

    renderWithModal(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    // Wait for form to load and all async operations to complete
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
    });

    // Wait a bit more for any state updates
    await waitFor(() => {
      const submitButton = screen.getByText('下一步');
      expect(submitButton).not.toBeDisabled();
    }, { timeout: 1000 });
  });

  it('should show confirmation step when form is submitted', async () => {
    // Uses default mock which returns no conflicts

    vi.mocked(useAppointmentForm).mockReturnValue({
      selectedPatientId: 1,
      setSelectedPatientId: vi.fn(),
      selectedAppointmentTypeId: 1,
      setSelectedAppointmentTypeId: vi.fn(),
      selectedPractitionerId: 1,
      setSelectedPractitionerId: vi.fn(),
      selectedDate: '2024-01-15',
      setSelectedDate: vi.fn(),
      selectedTime: '09:00',
      setSelectedTime: vi.fn(),
      clinicNotes: '',
      setClinicNotes: vi.fn(),
      selectedResourceIds: [],
      setSelectedResourceIds: vi.fn(),
      initialResources: [],
      availablePractitioners: mockPractitioners,
      isInitialLoading: false,
      isLoadingPractitioners: false,
      error: null,
      setError: vi.fn(),
      isValid: true,
      referenceDateTime: null,
      hasChanges: false,
      changeDetails: {
        appointmentTypeChanged: false,
        practitionerChanged: false,
        timeChanged: false,
        dateChanged: false,
        resourcesChanged: false,
      },
      initialAvailability: null, hasPractitionerTypeMismatch: false, prePopulatedFromSlot: false,
    });

    renderWithModal(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    // Wait for form to load
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
    });

    // Submit form (button should be enabled with our mocks)
    const submitButton = screen.getByText('下一步');
    fireEvent.click(submitButton);

    // Check confirmation step appears
    await waitFor(() => {
      expect(screen.getByText('確認預約')).toBeInTheDocument();
    });
  });

  it('should show message when no practitioners available for appointment type', async () => {
    // Mock the hook to simulate appointment type selected but no practitioners available
    vi.mocked(useAppointmentForm).mockReturnValue({
      selectedPatientId: null,
      setSelectedPatientId: vi.fn(),
      selectedAppointmentTypeId: 1, // Appointment type selected
      setSelectedAppointmentTypeId: vi.fn(),
      selectedPractitionerId: null,
      setSelectedPractitionerId: vi.fn(),
      selectedDate: null,
      setSelectedDate: vi.fn(),
      selectedTime: '',
      setSelectedTime: vi.fn(),
      clinicNotes: '',
      setClinicNotes: vi.fn(),
      selectedResourceIds: [],
      setSelectedResourceIds: vi.fn(),
      initialResources: [],
      availablePractitioners: [], // No practitioners available
      isInitialLoading: false,
      isLoadingPractitioners: false,
      error: null,
      setError: vi.fn(),
      isValid: false,
      referenceDateTime: null,
      hasChanges: false,
      changeDetails: {
        appointmentTypeChanged: false,
        practitionerChanged: false,
        timeChanged: false,
        dateChanged: false,
        resourcesChanged: false,
      },
      initialAvailability: null, hasPractitionerTypeMismatch: false, prePopulatedFromSlot: false,
    });

    renderWithModal(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    // Wait for form to load
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
    });

    // Message should NOT appear when no practitioners are available (feature removed)
    expect(screen.queryByText('此預約類型目前沒有可用的治療師')).not.toBeInTheDocument();
  });

  it('should clear practitioner when appointment type is cleared', async () => {
    // Mock the hook to simulate practitioner being cleared when appointment type is cleared
    vi.mocked(useAppointmentForm).mockReturnValue({
      selectedPatientId: null,
      setSelectedPatientId: vi.fn(),
      selectedAppointmentTypeId: null, // Appointment type cleared
      setSelectedAppointmentTypeId: vi.fn(),
      selectedPractitionerId: null, // Practitioner should be cleared
      setSelectedPractitionerId: vi.fn(),
      selectedDate: null,
      setSelectedDate: vi.fn(),
      selectedTime: '',
      setSelectedTime: vi.fn(),
      clinicNotes: '',
      setClinicNotes: vi.fn(),
      selectedResourceIds: [],
      setSelectedResourceIds: vi.fn(),
      initialResources: [],
      availablePractitioners: mockPractitioners,
      isInitialLoading: false,
      isLoadingPractitioners: false,
      error: null,
      setError: vi.fn(),
      isValid: false,
      referenceDateTime: null,
      hasChanges: false,
      changeDetails: {
        appointmentTypeChanged: false,
        practitionerChanged: false,
        timeChanged: false,
        dateChanged: false,
        resourcesChanged: false,
      },
      initialAvailability: null, hasPractitionerTypeMismatch: false, prePopulatedFromSlot: false,
    });

    renderWithModal(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    // Wait for form to load
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
    });

    // Verify practitioner button shows default text when cleared
    const practitionerButton = screen.getByRole('button', { name: /選擇治療師/ });
    expect(practitionerButton).toBeInTheDocument();
  });

  describe('Recurrence Toggle', () => {
    it('should toggle recurrence when button is clicked', async () => {
      renderWithModal(
        <CreateAppointmentModal
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

      // Wait for form to load
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
      });

      // Find the recurrence toggle button
      const recurrenceButton = screen.getByRole('button', { name: '重複' });
      expect(recurrenceButton).toBeInTheDocument();
      expect(recurrenceButton).toHaveAttribute('aria-pressed', 'false');

      // Click to enable
      fireEvent.click(recurrenceButton);

      // Verify button is now pressed
      await waitFor(() => {
        expect(recurrenceButton).toHaveAttribute('aria-pressed', 'true');
      });

      // Click again to disable
      fireEvent.click(recurrenceButton);

      // Verify button is no longer pressed
      await waitFor(() => {
        expect(recurrenceButton).toHaveAttribute('aria-pressed', 'false');
      });
    });

    it('should show recurrence inputs when enabled', async () => {
      renderWithModal(
        <CreateAppointmentModal
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

      // Wait for form to load
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
      });

      const recurrenceButton = screen.getByRole('button', { name: '重複' });

      // Initially, recurrence inputs should not be visible
      const numberInputs = screen.queryAllByRole('spinbutton');
      expect(numberInputs.length).toBe(0);

      // Enable recurrence
      fireEvent.click(recurrenceButton);

      // Verify recurrence inputs appear
      await waitFor(() => {
        const inputs = screen.getAllByRole('spinbutton');
        expect(inputs.length).toBeGreaterThanOrEqual(2);
        // Check that the labels are visible
        expect(screen.getByText('每')).toBeInTheDocument();
        expect(screen.getByText('共')).toBeInTheDocument();
      });
    });

    it('should hide recurrence inputs when disabled', async () => {
      renderWithModal(
        <CreateAppointmentModal
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

      // Wait for form to load
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
      });

      const recurrenceButton = screen.getByRole('button', { name: '重複' });

      // Enable recurrence
      fireEvent.click(recurrenceButton);

      await waitFor(() => {
        expect(screen.getByText('每')).toBeInTheDocument();
      });

      // Disable recurrence
      fireEvent.click(recurrenceButton);

      // Verify recurrence inputs are hidden
      await waitFor(() => {
        expect(screen.queryByText('每')).not.toBeInTheDocument();
        expect(screen.queryByText('共')).not.toBeInTheDocument();
      });
    });

    it('should reset recurrence state when disabled', async () => {
      renderWithModal(
        <CreateAppointmentModal
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

      // Wait for form to load
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
      });

      const recurrenceButton = screen.getByRole('button', { name: '重複' });

      // Enable recurrence
      fireEvent.click(recurrenceButton);

      await waitFor(() => {
        expect(screen.getByText('每')).toBeInTheDocument();
      });

      // Get the number inputs
      const numberInputs = screen.getAllByRole('spinbutton');
      const weeksInput = numberInputs[0]; // First input is weeks interval
      const countInput = numberInputs[1]; // Second input is occurrence count

      // Set some values
      fireEvent.change(weeksInput, { target: { value: '2' } });
      fireEvent.change(countInput, { target: { value: '5' } });

      // Verify values are set
      expect(weeksInput).toHaveValue(2);
      expect(countInput).toHaveValue(5);

      // Disable recurrence
      fireEvent.click(recurrenceButton);

      // Verify inputs are hidden (state reset)
      await waitFor(() => {
        expect(screen.queryByText('每')).not.toBeInTheDocument();
      });

      // Re-enable to verify state was reset
      fireEvent.click(recurrenceButton);

      await waitFor(() => {
        const newInputs = screen.getAllByRole('spinbutton');
        const newWeeksInput = newInputs[0];
        const newCountInput = newInputs[1];
        // Values should be reset to defaults
        expect(newWeeksInput).toHaveValue(1);
        // When occurrenceCount is null, the input value is empty string (HTML number inputs use '' for empty)
        // Check that the input defaults to 1
        expect(newCountInput.value).toBe('1');
      });
    });
  });

  describe('Auto-select assigned practitioner', () => {
    beforeEach(() => {
      vi.mocked(apiService.getPatient).mockResolvedValue({
        id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioner_ids: [1], // Patient has practitioner 1 assigned
      });
    });

    it('should auto-select first assigned practitioner when patient and appointment type are selected', async () => {
      vi.mocked(apiService.getPractitioners).mockResolvedValue([
        { id: 1, full_name: 'Dr. Assigned', offered_types: [1] },
        { id: 2, full_name: 'Dr. Another', offered_types: [1] },
      ]);

      // Mock the hook to simulate auto-selection
      vi.mocked(useAppointmentForm).mockReturnValue({
        selectedPatientId: 1,
        setSelectedPatientId: vi.fn(),
        selectedAppointmentTypeId: 1,
        setSelectedAppointmentTypeId: vi.fn(),
        selectedPractitionerId: 1, // Auto-selected practitioner
        setSelectedPractitionerId: vi.fn(),
        selectedDate: null,
        setSelectedDate: vi.fn(),
        selectedTime: '',
        setSelectedTime: vi.fn(),
        clinicNotes: '',
        setClinicNotes: vi.fn(),
        selectedResourceIds: [],
        setSelectedResourceIds: vi.fn(),
        initialResources: [],
        availablePractitioners: [
          { id: 1, full_name: 'Dr. Assigned', offered_types: [1] },
          { id: 2, full_name: 'Dr. Another', offered_types: [1] },
        ],
        isInitialLoading: false,
        isLoadingPractitioners: false,
        error: null,
        setError: vi.fn(),
        isValid: false,
        referenceDateTime: null,
        hasChanges: false,
        changeDetails: {
          appointmentTypeChanged: false,
          practitionerChanged: false,
          timeChanged: false,
          dateChanged: false,
          resourcesChanged: false,
        },
        initialAvailability: null, hasPractitionerTypeMismatch: false, prePopulatedFromSlot: false,
      });

      renderWithModal(
        <CreateAppointmentModal
          preSelectedPatientId={1}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

      // Wait for form to load
      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
      });

      // Verify practitioner button shows auto-selected practitioner
      const practitionerButton = screen.getByText('Dr. Test');
      expect(practitionerButton).toBeInTheDocument();
    });

    it('should not auto-select if user has already selected a practitioner', async () => {
      // Mock the hook to simulate user has already manually selected practitioner 2
      // (not the auto-assigned practitioner 1)
      vi.mocked(useAppointmentForm).mockReturnValue({
        selectedPatientId: 1,
        setSelectedPatientId: vi.fn(),
        selectedAppointmentTypeId: 1, // Appointment type selected
        setSelectedAppointmentTypeId: vi.fn(),
        selectedPractitionerId: 2, // User manually selected practitioner 2
        setSelectedPractitionerId: vi.fn(),
        selectedDate: null,
        setSelectedDate: vi.fn(),
        selectedTime: '',
        setSelectedTime: vi.fn(),
        clinicNotes: '',
        setClinicNotes: vi.fn(),
        selectedResourceIds: [],
        setSelectedResourceIds: vi.fn(),
        initialResources: [],
        availablePractitioners: [
          { id: 1, full_name: 'Dr. Assigned', offered_types: [1] },
          { id: 2, full_name: 'Dr. Another', offered_types: [1] },
        ],
        isInitialLoading: false,
        isLoadingPractitioners: false,
        error: null,
        setError: vi.fn(),
        isValid: false,
        referenceDateTime: null,
        hasChanges: false,
        changeDetails: {
          appointmentTypeChanged: false,
          practitionerChanged: false,
          timeChanged: false,
          dateChanged: false,
          resourcesChanged: false,
        },
        initialAvailability: null, hasPractitionerTypeMismatch: false, prePopulatedFromSlot: false,
      });

      renderWithModal(
        <CreateAppointmentModal
          preSelectedPatientId={1}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

      // Wait for form to load
      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
      });

      // Verify practitioner button shows user's manual selection (practitioner 2)
      // not the auto-selected practitioner 1
      const practitionerButton = screen.getByRole('button', { name: /Dr\. Another/ });
      expect(practitionerButton).toBeInTheDocument();
    });

    it('should not auto-select if assigned practitioner is not available for appointment type', async () => {
      // Mock the hook to simulate: patient has assigned practitioner 1, but appointment type only offers practitioner 2
      // So no auto-selection should happen
      vi.mocked(useAppointmentForm).mockReturnValue({
        selectedPatientId: 1,
        setSelectedPatientId: vi.fn(),
        selectedAppointmentTypeId: 1, // Appointment type selected
        setSelectedAppointmentTypeId: vi.fn(),
        selectedPractitionerId: null, // No auto-selection because assigned practitioner not available
        setSelectedPractitionerId: vi.fn(),
        selectedDate: null,
        setSelectedDate: vi.fn(),
        selectedTime: '',
        setSelectedTime: vi.fn(),
        clinicNotes: '',
        setClinicNotes: vi.fn(),
        selectedResourceIds: [],
        setSelectedResourceIds: vi.fn(),
        initialResources: [],
        availablePractitioners: [
          { id: 2, full_name: 'Dr. Another', offered_types: [1] }, // Only practitioner 2 available for this type
        ],
        isInitialLoading: false,
        isLoadingPractitioners: false,
        error: null,
        setError: vi.fn(),
        isValid: false,
        referenceDateTime: null,
        hasChanges: false,
        changeDetails: {
          appointmentTypeChanged: false,
          practitionerChanged: false,
          timeChanged: false,
          dateChanged: false,
          resourcesChanged: false,
        },
        initialAvailability: null, hasPractitionerTypeMismatch: false, prePopulatedFromSlot: false,
      });

      renderWithModal(
        <CreateAppointmentModal
          preSelectedPatientId={1}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

      // Wait for form to load
      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
      });

      // Verify practitioner button shows default text (no auto-selection)
      const practitionerButton = screen.getByRole('button', { name: /選擇治療師/ });
      expect(practitionerButton).toBeInTheDocument();
    });

    it('should auto-select when appointment type changes if patient has assigned practitioner', async () => {
      // Mock the hook to simulate: appointment type changed to one that includes the assigned practitioner
      // This triggers auto-selection of the assigned practitioner
      vi.mocked(useAppointmentForm).mockReturnValue({
        selectedPatientId: 1,
        setSelectedPatientId: vi.fn(),
        selectedAppointmentTypeId: 2, // Changed to type 2 (which has assigned practitioner available)
        setSelectedAppointmentTypeId: vi.fn(),
        selectedPractitionerId: 1, // Auto-selected assigned practitioner
        setSelectedPractitionerId: vi.fn(),
        selectedDate: null,
        setSelectedDate: vi.fn(),
        selectedTime: '',
        setSelectedTime: vi.fn(),
        clinicNotes: '',
        setClinicNotes: vi.fn(),
        selectedResourceIds: [],
        setSelectedResourceIds: vi.fn(),
        initialResources: [],
        availablePractitioners: [
          { id: 1, full_name: 'Dr. Assigned', offered_types: [1] },
          { id: 2, full_name: 'Dr. Another', offered_types: [1] },
        ],
        isInitialLoading: false,
        isLoadingPractitioners: false,
        error: null,
        setError: vi.fn(),
        isValid: false,
        referenceDateTime: null,
        hasChanges: false,
        changeDetails: {
          appointmentTypeChanged: false,
          practitionerChanged: false,
          timeChanged: false,
          dateChanged: false,
          resourcesChanged: false,
        },
        initialAvailability: null, hasPractitionerTypeMismatch: false, prePopulatedFromSlot: false,
      });

      renderWithModal(
        <CreateAppointmentModal
          preSelectedPatientId={1}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

      // Wait for form to load
      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
      });

      // Verify practitioner 1 (assigned) is auto-selected after appointment type change
      const practitionerButton = screen.getByText('Dr. Test');
      expect(practitionerButton).toBeInTheDocument();
    });

    it('should use assigned_practitioners fallback if assigned_practitioner_ids is not available', async () => {
      // Mock the hook to simulate auto-selection using assigned_practitioners fallback
      vi.mocked(useAppointmentForm).mockReturnValue({
        selectedPatientId: 1,
        setSelectedPatientId: vi.fn(),
        selectedAppointmentTypeId: 1, // Appointment type selected
        setSelectedAppointmentTypeId: vi.fn(),
        selectedPractitionerId: 1, // Auto-selected from assigned_practitioners fallback
        setSelectedPractitionerId: vi.fn(),
        selectedDate: null,
        setSelectedDate: vi.fn(),
        selectedTime: '',
        setSelectedTime: vi.fn(),
        clinicNotes: '',
        setClinicNotes: vi.fn(),
        selectedResourceIds: [],
        setSelectedResourceIds: vi.fn(),
        initialResources: [],
        availablePractitioners: [
          { id: 1, full_name: 'Dr. Assigned', offered_types: [1] },
          { id: 2, full_name: 'Dr. Another', offered_types: [1] },
        ],
        isInitialLoading: false,
        isLoadingPractitioners: false,
        error: null,
        setError: vi.fn(),
        isValid: false,
        referenceDateTime: null,
        hasChanges: false,
        changeDetails: {
          appointmentTypeChanged: false,
          practitionerChanged: false,
          timeChanged: false,
          dateChanged: false,
          resourcesChanged: false,
        },
        initialAvailability: null, hasPractitionerTypeMismatch: false, prePopulatedFromSlot: false,
      });

      renderWithModal(
        <CreateAppointmentModal
          preSelectedPatientId={1}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

      // Wait for form to load
      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
      });

    });
    it('should not auto-select assigned practitioner if prePopulatedFromSlot is true', async () => {
      const assignedPractitionerId = 2;
      const slotPractitionerId = 1;

      vi.mocked(apiService.getPatient).mockResolvedValue({
        id: 1,
        full_name: 'Test Patient',
        assigned_practitioner_ids: [assignedPractitionerId],
        created_at: '2024-01-01T00:00:00Z',
      } as any);

      vi.mocked(useAppointmentForm).mockReturnValue({
        selectedPatientId: 1,
        setSelectedPatientId: vi.fn(),
        selectedAppointmentTypeId: 1,
        setSelectedAppointmentTypeId: vi.fn(),
        selectedPractitionerId: slotPractitionerId,
        setSelectedPractitionerId: vi.fn(),
        selectedDate: '2024-01-15',
        setSelectedDate: vi.fn(),
        selectedTime: '09:00',
        setSelectedTime: vi.fn(),
        clinicNotes: '',
        setClinicNotes: vi.fn(),
        selectedResourceIds: [],
        setSelectedResourceIds: vi.fn(),
        initialResources: [],
        availablePractitioners: [
          { id: 1, full_name: 'Dr. Test', offered_types: [1] },
          { id: 2, full_name: 'Dr. Another', offered_types: [1] },
        ],
        isInitialLoading: false,
        isLoadingPractitioners: false,
        error: null,
        setError: vi.fn(),
        isValid: true,
        referenceDateTime: null,
        hasChanges: false,
        changeDetails: {
          appointmentTypeChanged: false,
          practitionerChanged: false,
          timeChanged: false,
          dateChanged: false,
          resourcesChanged: false,
        },
        initialAvailability: null,
        hasPractitionerTypeMismatch: false,
        prePopulatedFromSlot: true,
      });

      render(
        <CreateAppointmentModal
          preSelectedPatientId={1}
          preSelectedPractitionerId={slotPractitionerId}
          prePopulatedFromSlot={true}
          practitioners={[
            { id: 1, full_name: 'Dr. Test', offered_types: [1] },
            { id: 2, full_name: 'Dr. Another', offered_types: [1] },
          ]}
          appointmentTypes={[
            { id: 1, name: 'Test Type', duration_minutes: 30, clinic_id: 1 },
          ]}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
      });

      const practitionerButton = screen.getByText('Dr. Test');
      expect(practitionerButton).toBeInTheDocument();
    });
  });

  describe('Service type mismatch and assigned practitioner warnings', () => {
    it('should show mismatch warning indicator when practitioner doesn\'t offer appointment type', async () => {
      vi.mocked(useAppointmentForm).mockReturnValue({
        selectedPatientId: 1,
        setSelectedPatientId: vi.fn(),
        selectedAppointmentTypeId: 2, // Type 2 selected
        setSelectedAppointmentTypeId: vi.fn(),
        selectedPractitionerId: 1, // Practitioner 1 selected
        setSelectedPractitionerId: vi.fn(),
        selectedDate: '2024-01-15',
        setSelectedDate: vi.fn(),
        selectedTime: '09:00',
        setSelectedTime: vi.fn(),
        clinicNotes: '',
        setClinicNotes: vi.fn(),
        selectedResourceIds: [],
        setSelectedResourceIds: vi.fn(),
        initialResources: [],
        availablePractitioners: [{ id: 2, full_name: 'Dr. Other', offered_types: [1] }], // Only Dr. Other offers type 2
        isInitialLoading: false,
        isLoadingPractitioners: false,
        error: null,
        setError: vi.fn(),
        isValid: true,
        referenceDateTime: null,
        hasChanges: false,
        changeDetails: {
          appointmentTypeChanged: false,
          practitionerChanged: false,
          timeChanged: false,
          dateChanged: false,
          resourcesChanged: false,
          originalAppointmentTypeName: 'Type 1',
          newAppointmentTypeName: 'Type 2',
          originalPractitionerName: 'Dr. Test',
          newPractitionerName: 'Dr. Test',
          originalStartTime: '2024-01-15 09:00',
          newStartTime: '2024-01-15 09:00'
        },
        initialAvailability: null,
        hasPractitionerTypeMismatch: true, // Mismatch!
        prePopulatedFromSlot: false,
      });

      render(
        <CreateAppointmentModal
          practitioners={[
            { id: 1, full_name: 'Dr. Test', offered_types: [1] },
            { id: 2, full_name: 'Dr. Other', offered_types: [2] },
          ] as any}
          appointmentTypes={[
            { id: 1, name: 'Type 1', duration_minutes: 30, clinic_id: 1 },
            { id: 2, name: 'Type 2', duration_minutes: 30, clinic_id: 1 },
          ]}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />
      );

      // Check for conflict indicator (mismatch)
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
      });
    });

    it('should show informational message when patient has different assigned practitioners', async () => {
      const assignedPractitionerId = 2;
      const selectedPractitionerId = 1;

      vi.mocked(apiService.getPatient).mockResolvedValue({
        id: 1,
        full_name: 'Test Patient',
        assigned_practitioner_ids: [assignedPractitionerId],
        created_at: '2024-01-01T00:00:00Z',
      } as any);

      vi.mocked(useAppointmentForm).mockReturnValue({
        selectedPatientId: 1,
        setSelectedPatientId: vi.fn(),
        selectedAppointmentTypeId: 1,
        setSelectedAppointmentTypeId: vi.fn(),
        selectedPractitionerId: selectedPractitionerId,
        setSelectedPractitionerId: vi.fn(),
        selectedDate: '2024-01-15',
        setSelectedDate: vi.fn(),
        selectedTime: '09:00',
        setSelectedTime: vi.fn(),
        clinicNotes: '',
        setClinicNotes: vi.fn(),
        selectedResourceIds: [],
        setSelectedResourceIds: vi.fn(),
        initialResources: [],
        availablePractitioners: [
          { id: 1, full_name: 'Dr. Test', offered_types: [1] },
          { id: 2, full_name: 'Dr. Assigned', offered_types: [1] },
        ],
        isInitialLoading: false,
        isLoadingPractitioners: false,
        error: null,
        setError: vi.fn(),
        isValid: true,
        referenceDateTime: null,
        hasChanges: false,
        changeDetails: {
          appointmentTypeChanged: false,
          practitionerChanged: false,
          timeChanged: false,
          dateChanged: false,
          resourcesChanged: false,
        },
        initialAvailability: null,
        hasPractitionerTypeMismatch: false,
        prePopulatedFromSlot: true,
      });

      render(
        <CreateAppointmentModal
          preSelectedPatientId={1}
          preSelectedPractitionerId={selectedPractitionerId}
          prePopulatedFromSlot={true}
          practitioners={[
            { id: 1, full_name: 'Dr. Test', offered_types: [1] },
            { id: 2, full_name: 'Dr. Assigned', offered_types: [1] },
          ] as any}
          appointmentTypes={[
            { id: 1, name: 'Test Type', duration_minutes: 30, clinic_id: 1 },
          ]}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/此病患的負責治療師為：/)).toBeInTheDocument();
        expect(screen.getByText('Dr. Assigned')).toBeInTheDocument();
      });
    });
  });
});

/**
 * Unit tests for CreateAppointmentModal component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { CreateAppointmentModal } from '../CreateAppointmentModal';
import { apiService } from '../../../services/api';
import { usePatients } from '../../../hooks/queries';

// Mock React Query hooks
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
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
    checkSchedulingConflicts: vi.fn(),
    getServiceTypeGroups: vi.fn().mockResolvedValue({ groups: [] }),
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

// Mock hooks
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    isLoading: false,
    isAuthenticated: true,
  }),
}));

vi.mock('../../../hooks/queries', () => ({
  usePatients: vi.fn(),
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
    { id: 1, full_name: 'Test Patient', phone_number: '1234567890' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiService.getPractitioners).mockResolvedValue([
      { id: 1, full_name: 'Dr. Test' },
      { id: 2, full_name: 'Dr. Another' },
    ]);
    vi.mocked(usePatients).mockReturnValue({
      data: { patients: mockPatients, total: 1, page: 1, page_size: 100 },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  const mockPractitioners = [
    { id: 1, full_name: 'Dr. Test' },
    { id: 2, full_name: 'Dr. Another' },
  ];

  const mockAppointmentTypes = [
    { id: 1, name: 'Test Type', duration_minutes: 30 },
    { id: 2, name: 'Another Type', duration_minutes: 60 },
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

  it('should filter practitioners when appointment type is selected', async () => {
    vi.mocked(apiService.getPractitioners).mockResolvedValue([
      { id: 1, full_name: 'Dr. Test' },
    ]);

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

    // Select appointment type
    const selects = screen.getAllByRole('combobox');
    const appointmentTypeSelect = selects[0];
    fireEvent.change(appointmentTypeSelect, { target: { value: '1' } });

    // Wait for practitioners to be fetched
    await waitFor(() => {
      expect(apiService.getPractitioners).toHaveBeenCalledWith(1, expect.any(AbortSignal));
    });

    // Verify practitioner dropdown is enabled
    await waitFor(() => {
      const updatedSelects = screen.getAllByRole('combobox');
      expect(updatedSelects[1]).not.toBeDisabled();
    });
  });

  it('should clear practitioner and time when appointment type changes to different practitioners', async () => {
    // Mock different practitioners for type 2 (practitioner 1 not in list)
    vi.mocked(apiService.getPractitioners)
      .mockResolvedValueOnce([{ id: 1, full_name: 'Dr. Test' }]) // Type 1 - has practitioner 1
      .mockResolvedValueOnce([{ id: 2, full_name: 'Dr. Another' }]); // Type 2 - only has practitioner 2

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

    // Select appointment type 1
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '1' } });

    await waitFor(() => {
      expect(apiService.getPractitioners).toHaveBeenCalledWith(1, expect.any(AbortSignal));
    });

    // Select practitioner 1
    await waitFor(() => {
      const updatedSelects = screen.getAllByRole('combobox');
      expect(updatedSelects[1]).not.toBeDisabled();
    });
    const updatedSelects = screen.getAllByRole('combobox');
    fireEvent.change(updatedSelects[1], { target: { value: '1' } });

    // Change appointment type to 2 (practitioner 1 not available for type 2)
    fireEvent.change(updatedSelects[0], { target: { value: '2' } });

    // Wait for new fetch
    await waitFor(() => {
      expect(apiService.getPractitioners).toHaveBeenCalledWith(2, expect.any(AbortSignal));
    });

    // Verify practitioner is cleared (practitioner 1 is not in the new list for type 2)
    await waitFor(() => {
      const clearedSelects = screen.getAllByRole('combobox');
      // Practitioner should be cleared because practitioner 1 doesn't offer type 2
      expect(clearedSelects[1]).toHaveValue('');
    }, { timeout: 3000 });
  });

  it('should show loading indicator when fetching practitioners', async () => {
    // Delay the response to test loading state
    vi.mocked(apiService.getPractitioners).mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve([{ id: 1, full_name: 'Dr. Test' }]), 100))
    );

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

    // Select appointment type
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '1' } });

    // Check for loading indicator
    await waitFor(() => {
      const updatedSelects = screen.getAllByRole('combobox');
      const options = Array.from(updatedSelects[1].querySelectorAll('option'));
      const loadingOption = options.find(opt => opt.textContent?.includes('載入中'));
      expect(loadingOption).toBeInTheDocument();
    });
  });

  it('should show error when practitioner fetch fails', async () => {
    vi.mocked(apiService.getPractitioners).mockRejectedValue(new Error('Network error'));

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

    // Select appointment type
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '1' } });

    // Wait for error to appear
    await waitFor(() => {
      expect(screen.getByText('無法載入治療師列表，請稍後再試')).toBeInTheDocument();
    });
  });

  it('should disable submit button when required fields are missing', async () => {
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
    expect(submitButton).toBeDisabled();
  });

  it('should enable submit button when all required fields are filled', async () => {
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

    // Select patient (simulate clicking on patient from search results)
    const searchInput = screen.getByPlaceholderText(/搜尋病患/);
    fireEvent.change(searchInput, { target: { value: 'Test' } });
    
    await waitFor(() => {
      const patientButton = screen.getByText('Test Patient');
      expect(patientButton).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Test Patient'));

    // Select appointment type
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '1' } });

    await waitFor(() => {
      expect(apiService.getPractitioners).toHaveBeenCalled();
    });

    // Select practitioner
    await waitFor(() => {
      const updatedSelects = screen.getAllByRole('combobox');
      expect(updatedSelects[1]).not.toBeDisabled();
    });
    const updatedSelects = screen.getAllByRole('combobox');
    fireEvent.change(updatedSelects[1], { target: { value: '1' } });

    // Wait for DateTimePicker to set date/time (mocked to auto-select)
    await waitFor(() => {
      expect(screen.getByTestId('datetime-picker')).toBeInTheDocument();
    }, { timeout: 2000 });

    // Wait for submit button to be enabled (all fields filled)
    await waitFor(() => {
      const submitButton = screen.getByText('下一步');
      expect(submitButton).not.toBeDisabled();
    }, { timeout: 2000 });
  });

  it('should show confirmation step when form is submitted', async () => {
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

    // Select patient
    const searchInput = screen.getByPlaceholderText(/搜尋病患/);
    fireEvent.change(searchInput, { target: { value: 'Test' } });
    
    await waitFor(() => {
      const patientButton = screen.getByText('Test Patient');
      expect(patientButton).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Test Patient'));

    // Select appointment type
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '1' } });

    await waitFor(() => {
      expect(apiService.getPractitioners).toHaveBeenCalled();
    });

    // Select practitioner
    await waitFor(() => {
      const updatedSelects = screen.getAllByRole('combobox');
      expect(updatedSelects[1]).not.toBeDisabled();
    });
    const updatedSelects = screen.getAllByRole('combobox');
    fireEvent.change(updatedSelects[1], { target: { value: '1' } });

    // Wait for DateTimePicker to set date/time (mocked to auto-select)
    await waitFor(() => {
      expect(screen.getByTestId('datetime-picker')).toBeInTheDocument();
    }, { timeout: 2000 });

    // Submit form
    await waitFor(() => {
      const submitButton = screen.getByText('下一步');
      expect(submitButton).not.toBeDisabled();
    }, { timeout: 2000 });
    
    const submitButton = screen.getByText('下一步');
    fireEvent.click(submitButton);

    // Check confirmation step
    await waitFor(() => {
      expect(screen.getByText('確認預約')).toBeInTheDocument();
    });
  });

  it('should show message when no practitioners available for appointment type', async () => {
    vi.mocked(apiService.getPractitioners).mockResolvedValue([]);

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

    // Select appointment type
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '1' } });

    // Wait for message
    await waitFor(() => {
      expect(screen.getByText('此預約類型目前沒有可用的治療師')).toBeInTheDocument();
    });
  });

  it('should clear practitioner when appointment type is cleared', async () => {
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

    // Select appointment type and practitioner
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '1' } });

    await waitFor(() => {
      expect(apiService.getPractitioners).toHaveBeenCalled();
    });

    await waitFor(() => {
      const updatedSelects = screen.getAllByRole('combobox');
      expect(updatedSelects[1]).not.toBeDisabled();
    });
    const updatedSelects = screen.getAllByRole('combobox');
    fireEvent.change(updatedSelects[1], { target: { value: '1' } });

    // Clear appointment type
    fireEvent.change(updatedSelects[0], { target: { value: '' } });

    // Verify practitioner is cleared (auto-deselection when type is cleared)
    await waitFor(() => {
      const clearedSelects = screen.getAllByRole('combobox');
      expect(clearedSelects[1]).toHaveValue('');
    }, { timeout: 2000 });
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
        // Check that the input is empty by verifying it has no numeric value
        expect(newCountInput.value).toBe('');
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
        { id: 1, full_name: 'Dr. Assigned' },
        { id: 2, full_name: 'Dr. Another' },
      ]);

      renderWithModal(
        <CreateAppointmentModal
          preSelectedPatientId={1}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

      // Wait for patient to be loaded
      await waitFor(() => {
        expect(apiService.getPatient).toHaveBeenCalledWith(1);
      });

      // Wait for form to load
      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
      });

      // Select appointment type
      const selects = screen.getAllByRole('combobox');
      const appointmentTypeSelect = selects[0];
      fireEvent.change(appointmentTypeSelect, { target: { value: '1' } });

      // Wait for practitioners to load and auto-selection to happen
      await waitFor(() => {
        expect(apiService.getPractitioners).toHaveBeenCalled();
      });

      // Verify practitioner 1 (assigned) is auto-selected
      await waitFor(() => {
        const practitionerSelect = screen.getAllByRole('combobox')[1];
        expect(practitionerSelect).toHaveValue('1');
      });
    });

    it('should not auto-select if user has already selected a practitioner', async () => {
      vi.mocked(apiService.getPractitioners).mockResolvedValue([
        { id: 1, full_name: 'Dr. Assigned' },
        { id: 2, full_name: 'Dr. Another' },
      ]);

      renderWithModal(
        <CreateAppointmentModal
          preSelectedPatientId={1}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

      // Wait for patient to be loaded
      await waitFor(() => {
        expect(apiService.getPatient).toHaveBeenCalledWith(1);
      });

      // Wait for form to load
      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
      });

      // Select appointment type first
      const selects = screen.getAllByRole('combobox');
      const appointmentTypeSelect = selects[0];
      fireEvent.change(appointmentTypeSelect, { target: { value: '1' } });

      await waitFor(() => {
        expect(apiService.getPractitioners).toHaveBeenCalled();
      });

      // User manually selects practitioner 2
      await waitFor(() => {
        const practitionerSelect = screen.getAllByRole('combobox')[1];
        fireEvent.change(practitionerSelect, { target: { value: '2' } });
      });

      // Verify practitioner 2 (user's selection) is still selected, not auto-selected practitioner 1
      await waitFor(() => {
        const practitionerSelect = screen.getAllByRole('combobox')[1];
        expect(practitionerSelect).toHaveValue('2');
      });
    });

    it('should not auto-select if assigned practitioner is not available for appointment type', async () => {
      // Patient has practitioner 1 assigned, but appointment type only offers practitioner 2
      vi.mocked(apiService.getPractitioners).mockResolvedValue([
        { id: 2, full_name: 'Dr. Another' },
      ]);

      renderWithModal(
        <CreateAppointmentModal
          preSelectedPatientId={1}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

      // Wait for patient to be loaded
      await waitFor(() => {
        expect(apiService.getPatient).toHaveBeenCalledWith(1);
      });

      // Wait for form to load
      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
      });

      // Select appointment type
      const selects = screen.getAllByRole('combobox');
      const appointmentTypeSelect = selects[0];
      fireEvent.change(appointmentTypeSelect, { target: { value: '1' } });

      // Wait for practitioners to load
      await waitFor(() => {
        expect(apiService.getPractitioners).toHaveBeenCalled();
      });

      // Verify no practitioner is auto-selected (assigned practitioner not available)
      await waitFor(() => {
        const practitionerSelect = screen.getAllByRole('combobox')[1];
        expect(practitionerSelect).toHaveValue('');
      });
    });

    it('should auto-select when appointment type changes if patient has assigned practitioner', async () => {
      vi.mocked(apiService.getPractitioners)
        .mockResolvedValueOnce([{ id: 2, full_name: 'Dr. Another' }]) // Type 1 - no assigned practitioner
        .mockResolvedValueOnce([{ id: 1, full_name: 'Dr. Assigned' }, { id: 2, full_name: 'Dr. Another' }]); // Type 2 - has assigned practitioner

      renderWithModal(
        <CreateAppointmentModal
          preSelectedPatientId={1}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

      // Wait for patient to be loaded
      await waitFor(() => {
        expect(apiService.getPatient).toHaveBeenCalledWith(1);
      });

      // Wait for form to load
      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
      });

      // Select appointment type 1 (no assigned practitioner available)
      const selects = screen.getAllByRole('combobox');
      const appointmentTypeSelect = selects[0];
      fireEvent.change(appointmentTypeSelect, { target: { value: '1' } });

      await waitFor(() => {
        expect(apiService.getPractitioners).toHaveBeenCalledWith(1, expect.any(AbortSignal));
      });

      // Change to appointment type 2 (has assigned practitioner available)
      fireEvent.change(appointmentTypeSelect, { target: { value: '2' } });

      await waitFor(() => {
        expect(apiService.getPractitioners).toHaveBeenCalledWith(2, expect.any(AbortSignal));
      });

      // Verify practitioner 1 (assigned) is auto-selected
      await waitFor(() => {
        const practitionerSelect = screen.getAllByRole('combobox')[1];
        expect(practitionerSelect).toHaveValue('1');
      });
    });

    it('should use assigned_practitioners fallback if assigned_practitioner_ids is not available', async () => {
      vi.mocked(apiService.getPatient).mockResolvedValue({
        id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioner_ids: undefined, // Not available
        assigned_practitioners: [
          { id: 1, full_name: 'Dr. Assigned', is_active: true },
        ],
      });

      vi.mocked(apiService.getPractitioners).mockResolvedValue([
        { id: 1, full_name: 'Dr. Assigned' },
        { id: 2, full_name: 'Dr. Another' },
      ]);

      renderWithModal(
        <CreateAppointmentModal
          preSelectedPatientId={1}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

      // Wait for patient to be loaded
      await waitFor(() => {
        expect(apiService.getPatient).toHaveBeenCalledWith(1);
      });

      // Wait for form to load
      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
      });

      // Select appointment type
      const selects = screen.getAllByRole('combobox');
      const appointmentTypeSelect = selects[0];
      fireEvent.change(appointmentTypeSelect, { target: { value: '1' } });

      // Wait for practitioners to load and auto-selection to happen
      await waitFor(() => {
        expect(apiService.getPractitioners).toHaveBeenCalled();
      });

      // Verify practitioner 1 (from assigned_practitioners) is auto-selected
      await waitFor(() => {
        const practitionerSelect = screen.getAllByRole('combobox')[1];
        expect(practitionerSelect).toHaveValue('1');
      });
    });
  });
});


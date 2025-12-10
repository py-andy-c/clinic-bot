/**
 * Unit tests for CreateAppointmentModal component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { CreateAppointmentModal } from '../CreateAppointmentModal';
import { apiService } from '../../../services/api';
import { useApiData } from '../../../hooks/useApiData';

// Mock createPortal to render directly
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

// Mock apiService
vi.mock('../../../services/api', () => ({
  apiService: {
    getPatients: vi.fn(),
    getPractitioners: vi.fn(),
    createPatient: vi.fn(),
  },
}));

// Mock DateTimePicker
vi.mock('../DateTimePicker', () => ({
  DateTimePicker: ({ onHasAvailableSlotsChange, onDateSelect, onTimeSelect, selectedPractitionerId }: any) => {
    React.useEffect(() => {
      if (selectedPractitionerId) {
        setTimeout(() => {
          if (onHasAvailableSlotsChange) onHasAvailableSlotsChange(true);
          // Auto-select date/time for testing
          if (onDateSelect) onDateSelect('2024-01-15');
          if (onTimeSelect) onTimeSelect('09:00');
        }, 0);
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

vi.mock('../../../hooks/useApiData');

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
    vi.mocked(useApiData).mockReturnValue({
      data: { patients: mockPatients, total: 1, page: 1, page_size: 100 },
      loading: false,
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

  it('should render form step by default', () => {
    render(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    expect(screen.getByText('建立預約')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/搜尋病患/)).toBeInTheDocument();
  });

  it('should show appointment type dropdown', () => {
    render(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    // Find appointment type dropdown by role (combobox)
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThan(0);
    const appointmentTypeSelect = selects[0];
    expect(appointmentTypeSelect).toBeInTheDocument();
    expect(appointmentTypeSelect).toHaveValue('');
  });

  it('should accept duplicate props without crashing', () => {
    // Test that component accepts all pre-fill props for duplication feature
    // The actual pre-filling behavior is tested through integration tests
    render(
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

    // Verify component renders successfully with duplicate props
    expect(screen.getByText('建立預約')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/診所內部備注/i)).toBeInTheDocument();
  });

  it('should filter practitioners when appointment type is selected', async () => {
    vi.mocked(apiService.getPractitioners).mockResolvedValue([
      { id: 1, full_name: 'Dr. Test' },
    ]);

    render(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    // Select appointment type
    const selects = screen.getAllByRole('combobox');
    const appointmentTypeSelect = selects[0];
    fireEvent.change(appointmentTypeSelect, { target: { value: '1' } });

    // Wait for practitioners to be fetched
    await waitFor(() => {
      expect(apiService.getPractitioners).toHaveBeenCalledWith(1);
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

    render(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    // Select appointment type 1
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '1' } });

    await waitFor(() => {
      expect(apiService.getPractitioners).toHaveBeenCalledWith(1);
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
      expect(apiService.getPractitioners).toHaveBeenCalledWith(2);
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

    render(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

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

    render(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    // Select appointment type
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '1' } });

    // Wait for error to appear
    await waitFor(() => {
      expect(screen.getByText('無法載入治療師列表，請稍後再試')).toBeInTheDocument();
    });
  });

  it('should disable submit button when required fields are missing', () => {
    render(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    const submitButton = screen.getByText('下一步');
    expect(submitButton).toBeDisabled();
  });

  it('should enable submit button when all required fields are filled', async () => {
    render(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

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
    render(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

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

    render(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    // Select appointment type
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '1' } });

    // Wait for message
    await waitFor(() => {
      expect(screen.getByText('此預約類型目前沒有可用的治療師')).toBeInTheDocument();
    });
  });

  it('should clear practitioner when appointment type is cleared', async () => {
    render(
      <CreateAppointmentModal
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

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
      render(
        <CreateAppointmentModal
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

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
      render(
        <CreateAppointmentModal
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

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
      render(
        <CreateAppointmentModal
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

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
      render(
        <CreateAppointmentModal
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

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
        // Also verify placeholder is shown when empty
        expect(newCountInput).toHaveAttribute('placeholder', '次數');
      });
    });
  });
});


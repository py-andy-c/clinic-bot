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
});


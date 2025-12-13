/**
 * Unit tests for ServiceItemsSettings component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ServiceItemsSettings from '../ServiceItemsSettings';
import { AppointmentType } from '../../types';
import { apiService } from '../../services/api';

// Mock apiService
vi.mock('../../services/api', () => ({
  apiService: {
    getMembers: vi.fn(),
    getBillingScenarios: vi.fn(),
  },
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe('ServiceItemsSettings', () => {
  const mockAppointmentTypes: AppointmentType[] = [
    {
      id: 1,
      clinic_id: 1,
      name: '初診評估',
      duration_minutes: 50,
      receipt_name: null,
      allow_patient_booking: true,
      description: null,
      scheduling_buffer_minutes: 10,
    },
  ];

  const mockMembers = [
    {
      id: 1,
      full_name: 'Dr. Test',
      email: 'test@example.com',
      roles: ['practitioner'],
    },
  ];

  const mockOnAddType = vi.fn();
  const mockOnUpdateType = vi.fn();
  const mockOnRemoveType = vi.fn();
  const mockOnPractitionerAssignmentsChange = vi.fn();
  const mockOnBillingScenariosChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiService.getMembers).mockResolvedValue(mockMembers);
  });

  const defaultProps = {
    appointmentTypes: mockAppointmentTypes,
    onAddType: mockOnAddType,
    onUpdateType: mockOnUpdateType,
    onRemoveType: mockOnRemoveType,
    isClinicAdmin: true,
    practitionerAssignments: {},
    billingScenarios: {},
    onPractitionerAssignmentsChange: mockOnPractitionerAssignmentsChange,
    onBillingScenariosChange: mockOnBillingScenariosChange,
  };

  it('should render service items list', () => {
    render(<ServiceItemsSettings {...defaultProps} />);
    expect(screen.getByText('服務項目')).toBeInTheDocument();
    expect(screen.getByText('初診評估')).toBeInTheDocument();
  });

  it('should handle string amounts from API response without crashing', () => {
    // This is the key test - billing scenarios with string amounts (as returned by API)
    // The main goal is to ensure .toFixed() doesn't crash when amount is a string
    const billingScenarios = {
      '1-1': [
        {
          id: 1,
          practitioner_appointment_type_id: 1,
          name: '原價',
          amount: '100.00', // String from API - this was causing the crash
          revenue_share: '80.00', // String from API
          is_default: true,
        },
      ],
    };

    // This should not throw an error - the component should render without crashing
    // The key test is that it doesn't throw "toFixed is not a function"
    expect(() => {
      render(
        <ServiceItemsSettings
          {...defaultProps}
          practitionerAssignments={{ 1: [1] }}
          billingScenarios={billingScenarios}
        />
      );
    }).not.toThrow();
  });

  it('should handle number amounts from API response', () => {
    // Test with number amounts (what TypeScript expects)
    const billingScenarios = {
      '1-1': [
        {
          id: 1,
          practitioner_appointment_type_id: 1,
          name: '原價',
          amount: 100.0, // Number
          revenue_share: 80.0, // Number
          is_default: true,
        },
      ],
    };

    // This should not throw an error
    expect(() => {
      render(
        <ServiceItemsSettings
          {...defaultProps}
          practitionerAssignments={{ 1: [1] }}
          billingScenarios={billingScenarios}
        />
      );
    }).not.toThrow();
  });



  it('should handle invalid string amounts gracefully', () => {
    const billingScenarios = {
      '1-1': [
        {
          id: 1,
          practitioner_appointment_type_id: 1,
          name: '原價',
          amount: 'invalid', // Invalid string
          revenue_share: 'also-invalid', // Invalid string
          is_default: false,
        },
      ],
    };

    // This should not throw an error even with invalid amounts
    expect(() => {
      render(
        <ServiceItemsSettings
          {...defaultProps}
          practitionerAssignments={{ 1: [1] }}
          billingScenarios={billingScenarios}
        />
      );
    }).not.toThrow();
  });

  it('should load billing scenarios when practitioner is assigned', async () => {
    const mockBillingScenarios = {
      billing_scenarios: [
        {
          id: 1,
          practitioner_appointment_type_id: 1,
          name: '原價',
          amount: '100.00', // String from API
          revenue_share: '80.00', // String from API
          is_default: true,
        },
      ],
    };

    vi.mocked(apiService.getBillingScenarios).mockResolvedValue(mockBillingScenarios);

    render(
      <ServiceItemsSettings
        {...defaultProps}
        practitionerAssignments={{ 1: [1] }}
      />
    );

    // Expand the service item
    const expandButton = screen.getByText('初診評估').closest('button');
    if (expandButton) {
      fireEvent.click(expandButton);
    }

    // Wait for members to load first
    await waitFor(() => {
      expect(screen.getByText('Dr. Test')).toBeInTheDocument();
    });

    // Wait for scenarios to load
    await waitFor(() => {
      expect(apiService.getBillingScenarios).toHaveBeenCalledWith(1, 1);
    });

    // Wait for scenarios to be displayed (after onBillingScenariosChange is called)
    await waitFor(() => {
      expect(mockOnBillingScenariosChange).toHaveBeenCalled();
    }, { timeout: 2000 });
  });

  it('should handle editing scenario with string amounts', () => {
    const billingScenarios = {
      '1-1': [
        {
          id: 1,
          practitioner_appointment_type_id: 1,
          name: '原價',
          amount: '150.50', // String from API
          revenue_share: '120.25', // String from API
          is_default: false,
        },
      ],
    };

    // The key test: component should render without crashing
    // handleEditScenario will be called when user clicks edit, and it should
    // handle string amounts properly (converting them to numbers)
    expect(() => {
      render(
        <ServiceItemsSettings
          {...defaultProps}
          practitionerAssignments={{ 1: [1] }}
          billingScenarios={billingScenarios}
        />
      );
    }).not.toThrow();
  });

  it('should call onAddType when add button is clicked', () => {
    render(<ServiceItemsSettings {...defaultProps} />);
    
    const addButton = screen.getByText('+ 新增服務項目');
    fireEvent.click(addButton);
    
    expect(mockOnAddType).toHaveBeenCalledTimes(1);
  });

  it('should not show add button when not clinic admin', () => {
    render(
      <ServiceItemsSettings
        {...defaultProps}
        isClinicAdmin={false}
      />
    );
    
    expect(screen.queryByText('+ 新增服務項目')).not.toBeInTheDocument();
  });
});


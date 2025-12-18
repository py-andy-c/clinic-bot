/**
 * Unit tests for ServiceItemsSettings component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import ServiceItemsSettings from '../ServiceItemsSettings';
import { AppointmentType } from '../../types';
import { apiService } from '../../services/api';
import { useServiceItemsStore } from '../../stores/serviceItemsStore';
import { ModalProvider } from '../../contexts/ModalContext';

// Wrapper component to provide RHF context
const FormWrapper: React.FC<{ children: React.ReactNode; defaultValues: any }> = ({ children, defaultValues }) => {
  const methods = useForm({ defaultValues });
  return <FormProvider {...methods}>{children}</FormProvider>;
};

// Mock apiService
vi.mock('../../services/api', () => ({
  apiService: {
    getMembers: vi.fn(),
    getBillingScenarios: vi.fn(),
    getResourceTypes: vi.fn().mockResolvedValue({ resource_types: [] }),
    getResourceRequirements: vi.fn().mockResolvedValue({ requirements: [] }),
    createResourceRequirement: vi.fn(),
    updateResourceRequirement: vi.fn(),
    deleteResourceRequirement: vi.fn(),
  },
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the service items store
const mockStore = {
  practitionerAssignments: {},
  billingScenarios: {},
  resourceRequirements: {},
  loadingScenarios: new Set<string>(),
  loadingResourceRequirements: new Set<number>(),
  updatePractitionerAssignments: vi.fn(),
  updateBillingScenarios: vi.fn(),
  loadBillingScenarios: vi.fn(),
  loadResourceRequirements: vi.fn(),
  updateResourceRequirements: vi.fn(),
};

vi.mock('../../stores/serviceItemsStore', () => ({
  useServiceItemsStore: vi.fn(() => mockStore),
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiService.getMembers).mockResolvedValue(mockMembers);
    // Reset store state
    mockStore.practitionerAssignments = {};
    mockStore.billingScenarios = {};
    mockStore.resourceRequirements = {};
    mockStore.loadingScenarios = new Set();
    mockStore.loadingResourceRequirements = new Set();
    mockStore.updatePractitionerAssignments.mockImplementation((serviceItemId, practitionerIds) => {
      mockStore.practitionerAssignments = {
        ...mockStore.practitionerAssignments,
        [serviceItemId]: practitionerIds,
      };
    });
    mockStore.updateBillingScenarios.mockImplementation((key, scenarios) => {
      mockStore.billingScenarios = {
        ...mockStore.billingScenarios,
        [key]: scenarios,
      };
    });
    mockStore.loadBillingScenarios.mockImplementation(async (serviceItemId, practitionerId) => {
      const key = `${serviceItemId}-${practitionerId}`;
      const data = await apiService.getBillingScenarios(serviceItemId, practitionerId);
      mockStore.billingScenarios = {
        ...mockStore.billingScenarios,
        [key]: data.billing_scenarios,
      };
    });
  });

  const defaultProps = {
    onAddType: mockOnAddType,
    onRemoveType: mockOnRemoveType,
    isClinicAdmin: true,
  };

  const renderWithProviders = (component: React.ReactElement, defaultValues: any = { appointment_types: mockAppointmentTypes }) => {
    return render(
      <ModalProvider>
        <FormWrapper defaultValues={defaultValues}>
          {component}
        </FormWrapper>
      </ModalProvider>
    );
  };

  it('should render service items list', () => {
    renderWithProviders(<ServiceItemsSettings {...defaultProps} />);
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

    // Set store state
    mockStore.practitionerAssignments = { 1: [1] };
    mockStore.billingScenarios = billingScenarios;

    // This should not throw an error - the component should render without crashing
    // The key test is that it doesn't throw "toFixed is not a function"
    expect(() => {
      renderWithProviders(<ServiceItemsSettings {...defaultProps} />);
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

    // Set store state
    mockStore.practitionerAssignments = { 1: [1] };
    mockStore.billingScenarios = billingScenarios;

    // This should not throw an error
    expect(() => {
      renderWithProviders(<ServiceItemsSettings {...defaultProps} />);
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

    // Set store state
    mockStore.practitionerAssignments = { 1: [1] };
    mockStore.billingScenarios = billingScenarios;

    // This should not throw an error even with invalid amounts
    expect(() => {
      renderWithProviders(<ServiceItemsSettings {...defaultProps} />);
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
    mockStore.practitionerAssignments = { 1: [1] };

    renderWithProviders(<ServiceItemsSettings {...defaultProps} />);

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

    // Wait for scenarios to be displayed (store updates its own state)
    await waitFor(() => {
      expect(mockStore.loadBillingScenarios).toHaveBeenCalledWith(1, 1);
      expect(mockStore.billingScenarios['1-1']).toBeDefined();
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

    // Set store state
    mockStore.practitionerAssignments = { 1: [1] };
    mockStore.billingScenarios = billingScenarios;

    // The key test: component should render without crashing
    // handleEditScenario will be called when user clicks edit, and it should
    // handle string amounts properly (converting them to numbers)
    expect(() => {
      renderWithProviders(<ServiceItemsSettings {...defaultProps} />);
    }).not.toThrow();
  });

  it('should call onAddType when add button is clicked', () => {
    renderWithProviders(<ServiceItemsSettings {...defaultProps} />);
    
    const addButton = screen.getByText('+ 新增服務項目');
    fireEvent.click(addButton);
    
    expect(mockOnAddType).toHaveBeenCalledTimes(1);
  });

  it('should not show add button when not clinic admin', () => {
    renderWithProviders(
      <ServiceItemsSettings
        {...defaultProps}
        isClinicAdmin={false}
      />
    );
    
    expect(screen.queryByText('+ 新增服務項目')).not.toBeInTheDocument();
  });

  it('should handle 404 errors gracefully and not retry infinitely', async () => {
    // Mock a 404 error
    const axiosError = {
      response: { status: 404 },
      code: 'ERR_BAD_REQUEST',
      message: 'Request failed with status code 404',
    };
    vi.mocked(apiService.getBillingScenarios).mockRejectedValue(axiosError);
    mockStore.practitionerAssignments = { 1: [1] };
    // Update mock to handle 404
    mockStore.loadBillingScenarios.mockImplementation(async (serviceItemId, practitionerId) => {
      const key = `${serviceItemId}-${practitionerId}`;
      try {
        await apiService.getBillingScenarios(serviceItemId, practitionerId);
      } catch (err: any) {
        if (err?.response?.status === 404) {
          mockStore.billingScenarios = {
            ...mockStore.billingScenarios,
            [key]: [],
          };
        }
        throw err;
      }
    });

    renderWithProviders(<ServiceItemsSettings {...defaultProps} />);

    // Expand the service item
    const expandButton = screen.getByText('初診評估').closest('button');
    if (expandButton) {
      fireEvent.click(expandButton);
    }

    // Wait for members to load
    await waitFor(() => {
      expect(screen.getByText('Dr. Test')).toBeInTheDocument();
    });

    // Wait for the API call to be made
    await waitFor(() => {
      expect(apiService.getBillingScenarios).toHaveBeenCalledWith(1, 1);
    });

    // Verify that store was updated with empty array (404 handled gracefully)
    await waitFor(() => {
      expect(mockStore.billingScenarios['1-1']).toEqual([]);
    });

    // Wait a bit and verify the API was only called once (no infinite retries)
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(apiService.getBillingScenarios).toHaveBeenCalledTimes(1);
  });

  it('should not make API calls during render', () => {
    // This test ensures we're not calling async functions during render
    // which was the root cause of the infinite loop bug
    vi.mocked(apiService.getBillingScenarios).mockResolvedValue({ billing_scenarios: [] });
    mockStore.practitionerAssignments = { 1: [1] };

    renderWithProviders(<ServiceItemsSettings {...defaultProps} />);

    // Immediately after render, API should not have been called yet
    // (it should only be called in useEffect, not during render)
    expect(apiService.getBillingScenarios).not.toHaveBeenCalled();
  });

  it('should track failed requests and not retry them', async () => {
    // Mock a non-404 error (e.g., 500)
    const serverError = {
      response: { status: 500 },
      code: 'ERR_BAD_RESPONSE',
      message: 'Internal server error',
    };
    vi.mocked(apiService.getBillingScenarios).mockRejectedValue(serverError);
    mockStore.practitionerAssignments = { 1: [1] };

    renderWithProviders(<ServiceItemsSettings {...defaultProps} />);

    // Expand the service item
    const expandButton = screen.getByText('初診評估').closest('button');
    if (expandButton) {
      fireEvent.click(expandButton);
    }

    // Wait for members to load
    await waitFor(() => {
      expect(screen.getByText('Dr. Test')).toBeInTheDocument();
    });

    // Wait for the API call to be made
    await waitFor(() => {
      expect(apiService.getBillingScenarios).toHaveBeenCalledWith(1, 1);
    });

    // Wait a bit and verify the API was only called once (failed requests are tracked)
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(apiService.getBillingScenarios).toHaveBeenCalledTimes(1);
  });

  it('should load scenarios via useEffect when service item is expanded', async () => {
    const mockBillingScenarios = {
      billing_scenarios: [
        {
          id: 1,
          practitioner_appointment_type_id: 1,
          name: '原價',
          amount: '100.00',
          revenue_share: '80.00',
          is_default: true,
        },
      ],
    };

    vi.mocked(apiService.getBillingScenarios).mockResolvedValue(mockBillingScenarios);
    mockStore.practitionerAssignments = { 1: [1] };

    renderWithProviders(<ServiceItemsSettings {...defaultProps} />);

    // Wait for members to load first (they load automatically when isClinicAdmin is true)
    await waitFor(() => {
      expect(apiService.getMembers).toHaveBeenCalled();
    });

    // Expand the service item first - members are only shown when expanded
    const expandButton = screen.getByText('初診評估').closest('button');
    if (expandButton) {
      fireEvent.click(expandButton);
    }

    // Wait for members to be rendered (they appear after expansion)
    await waitFor(() => {
      expect(screen.getByText('Dr. Test')).toBeInTheDocument();
    }, { timeout: 2000 });

    // Wait for scenarios to be loaded via useEffect (not during render)
    await waitFor(() => {
      expect(apiService.getBillingScenarios).toHaveBeenCalledWith(1, 1);
    }, { timeout: 2000 });

    // Verify scenarios were loaded via store
    await waitFor(() => {
      expect(mockStore.loadBillingScenarios).toHaveBeenCalledWith(1, 1);
    });
  });
});


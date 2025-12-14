/**
 * Unit tests for CheckoutModal component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CheckoutModal } from '../CheckoutModal';
import { apiService } from '../../../services/api';
import { CalendarEvent } from '../../../utils/calendarDataAdapter';

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
    getPractitioners: vi.fn(),
    getBillingScenarios: vi.fn(),
    checkoutAppointment: vi.fn(),
  },
}));

// Mock logger
vi.mock('../../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe('CheckoutModal', () => {
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();

  const mockAppointmentTypes = [
    { id: 1, name: 'Massage', receipt_name: '按摩' },
    { id: 2, name: 'Acupuncture', receipt_name: '針灸' },
  ];

  const mockPractitioners = [
    { id: 1, full_name: 'Dr. Smith' },
    { id: 2, full_name: 'Dr. Jones' },
  ];

  const mockEvent: CalendarEvent = {
    resource: {
      appointment_id: 1,
      appointment_type_id: 1,
      practitioner_id: 1,
      patient_id: 1,
      start_time: '2024-01-15T09:00:00Z',
      end_time: '2024-01-15T10:00:00Z',
      status: 'confirmed',
    },
    title: 'Test Appointment',
    start: new Date('2024-01-15T09:00:00Z'),
    end: new Date('2024-01-15T10:00:00Z'),
  };

  const mockBillingScenarios = [
    { id: 1, name: 'Regular', amount: 1000, revenue_share: 500, is_default: true },
    { id: 2, name: 'Discount', amount: 800, revenue_share: 400, is_default: false },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiService.getPractitioners).mockResolvedValue(mockPractitioners);
    vi.mocked(apiService.getBillingScenarios).mockResolvedValue({
      billing_scenarios: mockBillingScenarios,
    });
    vi.mocked(apiService.checkoutAppointment).mockResolvedValue({} as any);
  });

  it('should render checkout modal', () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    // Check for the heading (more specific than button)
    expect(screen.getByRole('heading', { name: '結帳' })).toBeInTheDocument();
    // Check for the checkout button
    expect(screen.getByRole('button', { name: '結帳' })).toBeInTheDocument();
  });

  it('should initialize first item from appointment context', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      expect(apiService.getPractitioners).toHaveBeenCalledWith(1);
      expect(apiService.getBillingScenarios).toHaveBeenCalledWith(1, 1);
    });

    // Check that service item is selected
    const serviceSelect = screen.getByLabelText('服務項目');
    expect(serviceSelect).toHaveValue('1');
  });

  it('should show service item dropdown for all items', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText('服務項目')).toBeInTheDocument();
    });

    // Add a new item
    const addButton = screen.getByText('+ 新增項目');
    fireEvent.click(addButton);

    // Wait for the new item to be added
    await waitFor(() => {
      const serviceSelects = screen.getAllByLabelText('服務項目');
      expect(serviceSelects.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('should show "其他" option in service item dropdown', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      const serviceSelect = screen.getByLabelText('服務項目');
      const options = Array.from(serviceSelect.querySelectorAll('option'));
      const otherOption = options.find(opt => opt.textContent === '其他');
      expect(otherOption).toBeInTheDocument();
    });
  });

  it('should show custom name field when "其他" is selected', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      const serviceSelect = screen.getByLabelText('服務項目');
      fireEvent.change(serviceSelect, { target: { value: 'other' } });
    });

    await waitFor(() => {
      expect(screen.getByLabelText('自訂項目名稱')).toBeInTheDocument();
    });
  });

  it('should hide billing scenario dropdown when "其他" service is selected', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      const serviceSelect = screen.getByLabelText('服務項目');
      fireEvent.change(serviceSelect, { target: { value: 'other' } });
    });

    await waitFor(() => {
      expect(screen.queryByLabelText('計費方案')).not.toBeInTheDocument();
    });
  });

  it('should show practitioner dropdown when service item is selected', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText('治療師')).toBeInTheDocument();
    });
  });

  it('should show all practitioners when "其他" service is selected', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      const serviceSelect = screen.getByLabelText('服務項目');
      expect(serviceSelect).toBeInTheDocument();
    });

    const serviceSelect = screen.getByLabelText('服務項目');
    fireEvent.change(serviceSelect, { target: { value: 'other' } });

    // Wait for practitioner dropdown to appear
    await waitFor(() => {
      expect(screen.getByLabelText('治療師')).toBeInTheDocument();
    }, { timeout: 2000 });

    const practitionerSelect = screen.getByLabelText('治療師');
    const options = Array.from(practitionerSelect.querySelectorAll('option'));
    // Should have "無" + all practitioners
    expect(options.length).toBeGreaterThanOrEqual(mockPractitioners.length + 1);
  });

  it('should filter practitioners by service item', async () => {
    // Mock different practitioners for different services
    vi.mocked(apiService.getPractitioners)
      .mockResolvedValueOnce([mockPractitioners[0]]) // Service 1 has only Dr. Smith
      .mockResolvedValueOnce([mockPractitioners[1]]); // Service 2 has only Dr. Jones

    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      expect(apiService.getPractitioners).toHaveBeenCalledWith(1);
    });

    const practitionerSelect = screen.getByLabelText('治療師');
    const options = Array.from(practitionerSelect.querySelectorAll('option'));
    const practitionerNames = options.map(opt => opt.textContent);
    expect(practitionerNames).toContain('Dr. Smith');
  });

  it('should set practitioner to "無" when service item changes and practitioner does not offer new service', async () => {
    // First service has practitioner 1, second service does not
    // Reset and set up mocks for this specific test
    vi.mocked(apiService.getPractitioners).mockReset();
    vi.mocked(apiService.getPractitioners)
      .mockResolvedValueOnce([mockPractitioners[0]]) // Service 1 - has practitioner 1
      .mockResolvedValueOnce([mockPractitioners[1]]); // Service 2 - has practitioner 2 (not practitioner 1)

    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    // Wait for initial API calls to complete
    await waitFor(() => {
      expect(apiService.getPractitioners).toHaveBeenCalledWith(1);
      expect(apiService.getBillingScenarios).toHaveBeenCalledWith(1, 1);
    });

    // Wait for the component to initialize: items state set, practitionersByServiceItem populated, DOM updated
    // We check for the practitioner option to exist first, then check the value
    await waitFor(() => {
      const initialPractitionerSelect = screen.getByLabelText('治療師');
      // Check that the dropdown exists and has options populated
      const options = Array.from(initialPractitionerSelect.querySelectorAll('option'));
      expect(options.length).toBeGreaterThan(1); // At least "無" + practitioners
      // Check that practitioner 1 is selected
      expect(initialPractitionerSelect).toHaveValue('1');
    }, { timeout: 5000 });

    const serviceSelect = screen.getByLabelText('服務項目');
    // Change to service 2
    fireEvent.change(serviceSelect, { target: { value: '2' } });

    // Wait for practitioners to load for service 2
    await waitFor(() => {
      expect(apiService.getPractitioners).toHaveBeenCalledWith(2);
    });

    // Wait for practitioner to be cleared (practitioner 1 doesn't offer service 2)
    await waitFor(() => {
      const practitionerSelect = screen.getByLabelText('治療師') as HTMLSelectElement;
      // Practitioner should be cleared to "無" (empty value)
      expect(practitionerSelect.value).toBe('');
    }, { timeout: 5000 });
  });

  it('should show billing scenario dropdown when service and practitioner are selected', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText('計費方案')).toBeInTheDocument();
    });
  });

  it('should hide billing scenario dropdown when practitioner is "無"', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      const practitionerSelect = screen.getByLabelText('治療師');
      fireEvent.change(practitionerSelect, { target: { value: '' } }); // Select "無"
    });

    await waitFor(() => {
      expect(screen.queryByLabelText('計費方案')).not.toBeInTheDocument();
    });
  });

  it('should auto-select default billing scenario when practitioner is selected', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      expect(apiService.getBillingScenarios).toHaveBeenCalledWith(1, 1);
    });

    // Default scenario should be selected
    const scenarioSelect = screen.getByLabelText('計費方案');
    expect(scenarioSelect).toHaveValue('1'); // Default scenario ID
  });

  it('should show editable amount/revenue_share when billing scenario is "其他"', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      const scenarioSelect = screen.getByLabelText('計費方案');
      // Select "其他"
      const options = Array.from(scenarioSelect.querySelectorAll('option'));
      const otherOption = options.find(opt => opt.textContent === '其他');
      if (otherOption) {
        fireEvent.change(scenarioSelect, { target: { value: '' } });
      }
    });

    await waitFor(() => {
      const amountInput = screen.getByLabelText('金額');
      expect(amountInput).not.toBeDisabled();
    });
  });

  it('should show read-only amount/revenue_share when billing scenario is selected', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      // Amount and revenue share should be read-only (displayed as div, not input)
      const amountFields = screen.getAllByText(/金額|診所分潤/);
      expect(amountFields.length).toBeGreaterThan(0);
    });
  });

  it('should reset amount/revenue_share to 0 when switching from read-only to editable', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      const scenarioSelect = screen.getByLabelText('計費方案');
      // Select "其他" to make fields editable
      fireEvent.change(scenarioSelect, { target: { value: '' } });
    });

    await waitFor(() => {
      const amountInput = screen.getByLabelText('金額') as HTMLInputElement;
      expect(amountInput.value).toBe('0');
    });
  });

  it('should reset amount/revenue_share to 0 when service type changes and practitioner has no billing scenarios', async () => {
    // Mock: Service 1 has billing scenarios, Service 2 does not (but same practitioner supports both)
    vi.mocked(apiService.getPractitioners)
      .mockResolvedValueOnce([mockPractitioners[0]]) // Service 1
      .mockResolvedValueOnce([mockPractitioners[0]]); // Service 2 (same practitioner)
    
    vi.mocked(apiService.getBillingScenarios)
      .mockResolvedValueOnce({
        billing_scenarios: mockBillingScenarios, // Service 1 has scenarios
      })
      .mockResolvedValueOnce({
        billing_scenarios: [], // Service 2 has no scenarios
      });

    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    // Wait for initial load with billing scenarios
    await waitFor(() => {
      expect(apiService.getBillingScenarios).toHaveBeenCalledWith(1, 1);
    });

    // Verify initial state has values from scenario
    await waitFor(() => {
      const amountDisplay = screen.getByLabelText('金額');
      expect(amountDisplay.textContent).toContain('$1,000');
    });

    // Change service type to service 2
    const serviceSelect = screen.getByLabelText('服務項目') as HTMLSelectElement;
    fireEvent.change(serviceSelect, { target: { value: '2' } });

    // Wait for billing scenarios to load for service 2
    await waitFor(() => {
      expect(apiService.getBillingScenarios).toHaveBeenCalledWith(2, 1);
    });

    // Verify that amount and revenue_share are reset to 0 and fields are editable
    await waitFor(() => {
      const amountInput = screen.getByLabelText('金額') as HTMLInputElement;
      const revenueShareInput = screen.getByLabelText('診所分潤') as HTMLInputElement;
      
      // Fields should be editable (input, not read-only div)
      expect(amountInput).toBeInTheDocument();
      expect(revenueShareInput).toBeInTheDocument();
      
      // Values should be reset to 0
      expect(amountInput.value).toBe('0');
      expect(revenueShareInput.value).toBe('0');
      
      // Billing scenario dropdown should not be visible (no scenarios)
      const scenarioSelect = screen.queryByLabelText('計費方案');
      expect(scenarioSelect).not.toBeInTheDocument();
    });
  });

  it('should set amount/revenue_share from billing scenario when selected', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      const scenarioSelect = screen.getByLabelText('計費方案') as HTMLSelectElement;
      expect(scenarioSelect).toBeInTheDocument();
    });

    // First, select "其他" to make fields editable
    const scenarioSelect = screen.getByLabelText('計費方案') as HTMLSelectElement;
    fireEvent.change(scenarioSelect, { target: { value: '' } });

    await waitFor(() => {
      const amountInput = screen.getByLabelText('金額') as HTMLInputElement;
      const revenueShareInput = screen.getByLabelText('診所分潤') as HTMLInputElement;
      
      // Set some custom values
      fireEvent.change(amountInput, { target: { value: '100' } });
      fireEvent.change(revenueShareInput, { target: { value: '50' } });
      
      expect(amountInput.value).toBe('100');
      expect(revenueShareInput.value).toBe('50');
    });

    // Now select a billing scenario (ID 1, which has amount: 1000, revenue_share: 500)
    fireEvent.change(scenarioSelect, { target: { value: '1' } });

    // Amount and revenue_share should be set from scenario values and displayed as read-only
    await waitFor(() => {
      // Fields should be read-only (displayed as div, not input)
      const amountDisplay = screen.getByLabelText('金額');
      const revenueShareDisplay = screen.getByLabelText('診所分潤');
      
      expect(amountDisplay).toBeInTheDocument();
      expect(revenueShareDisplay).toBeInTheDocument();
      
      // Check that the values come from the scenario (1000 and 500, formatted as currency)
      expect(amountDisplay.textContent).toContain('$1,000');
      expect(revenueShareDisplay.textContent).toContain('$500');
    });
  });

  it('should add new item with appointment context', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('項目 1')).toBeInTheDocument();
    });

    const addButton = screen.getByText('+ 新增項目');
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(screen.getByText('項目 2')).toBeInTheDocument();
      // New item should have service item from appointment context
      const serviceSelects = screen.getAllByLabelText('服務項目');
      expect(serviceSelects[1]).toHaveValue('1');
    });
  });

  it('should remove item when remove button is clicked', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('項目 1')).toBeInTheDocument();
    });

    // Add a second item
    const addButton = screen.getByText('+ 新增項目');
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(screen.getByText('項目 2')).toBeInTheDocument();
    });

    // Remove the second item
    const removeButtons = screen.getAllByText('移除');
    fireEvent.click(removeButtons[0]);

    await waitFor(() => {
      expect(screen.queryByText('項目 2')).not.toBeInTheDocument();
    });
  });

  it('should validate custom name is required when service item is "其他"', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      const serviceSelect = screen.getByLabelText('服務項目');
      fireEvent.change(serviceSelect, { target: { value: 'other' } });
    });

    // Try to checkout without custom name
    const checkoutButton = screen.getByRole('button', { name: '結帳' });
    fireEvent.click(checkoutButton);

    await waitFor(() => {
      expect(screen.getByText(/請選擇服務項目或輸入自訂項目名稱/)).toBeInTheDocument();
    });
  });

  it('should validate revenue share is not greater than amount', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      const serviceSelect = screen.getByLabelText('服務項目');
      fireEvent.change(serviceSelect, { target: { value: 'other' } });
    });

    await waitFor(() => {
      const customNameInput = screen.getByLabelText('自訂項目名稱');
      fireEvent.change(customNameInput, { target: { value: 'Test Service' } });
    });

    // Set amount and revenue share
    await waitFor(() => {
      const amountInput = screen.getByLabelText('金額') as HTMLInputElement;
      const revenueShareInput = screen.getByLabelText('診所分潤') as HTMLInputElement;
      
      fireEvent.change(amountInput, { target: { value: '100' } });
      fireEvent.change(revenueShareInput, { target: { value: '200' } }); // Greater than amount
    });

    const checkoutButton = screen.getByRole('button', { name: '結帳' });
    fireEvent.click(checkoutButton);

    await waitFor(() => {
      expect(screen.getByText(/診所分潤必須 <= 金額/)).toBeInTheDocument();
    });
  });

  it('should call checkoutAppointment with correct data', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '結帳' })).toBeInTheDocument();
    });

    const checkoutButton = screen.getByRole('button', { name: '結帳' });
    fireEvent.click(checkoutButton);

    await waitFor(() => {
      expect(apiService.checkoutAppointment).toHaveBeenCalledWith(
        1, // appointment_id
        expect.arrayContaining([
          expect.objectContaining({
            item_type: 'service_item',
            service_item_id: 1,
            practitioner_id: 1,
            billing_scenario_id: 1,
            amount: 1000,
            revenue_share: 500,
            quantity: 1,
            display_order: 0,
          }),
        ]),
        'cash' // payment method
      );
    });
  });

  it('should send "other" type item when service item is "其他"', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      const serviceSelect = screen.getByLabelText('服務項目');
      fireEvent.change(serviceSelect, { target: { value: 'other' } });
    });

    await waitFor(() => {
      const customNameInput = screen.getByLabelText('自訂項目名稱');
      fireEvent.change(customNameInput, { target: { value: 'Custom Service' } });
    });

    await waitFor(() => {
      const amountInput = screen.getByLabelText('金額') as HTMLInputElement;
      fireEvent.change(amountInput, { target: { value: '500' } });
    });

    const checkoutButton = screen.getByRole('button', { name: '結帳' });
    fireEvent.click(checkoutButton);

    await waitFor(() => {
      expect(apiService.checkoutAppointment).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({
            item_type: 'other',
            item_name: 'Custom Service',
            amount: 500,
            revenue_share: 0,
            quantity: 1,
            display_order: 0,
          }),
        ]),
        'cash'
      );
    });
  });

  it('should omit null practitioner_id from API request', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '結帳' })).toBeInTheDocument();
    });

    // Set practitioner to "無" (null)
    const practitionerSelect = screen.getByLabelText('治療師');
    fireEvent.change(practitionerSelect, { target: { value: '' } });

    const checkoutButton = screen.getByRole('button', { name: '結帳' });
    fireEvent.click(checkoutButton);

    await waitFor(() => {
      expect(apiService.checkoutAppointment).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({
            item_type: 'service_item',
            service_item_id: 1,
            amount: expect.any(Number),
            revenue_share: expect.any(Number),
            quantity: 1,
            display_order: 0,
          }),
        ]),
        'cash'
      );
      // Verify practitioner_id is NOT in the request
      const callArgs = vi.mocked(apiService.checkoutAppointment).mock.calls[0];
      const items = callArgs[1] as any[];
      expect(items[0]).not.toHaveProperty('practitioner_id');
    });
  });

  it('should omit null billing_scenario_id from API request', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '結帳' })).toBeInTheDocument();
    });

    // Set billing scenario to "其他" (null)
    const billingScenarioSelect = screen.getByLabelText('計費方案');
    fireEvent.change(billingScenarioSelect, { target: { value: '' } });

    const checkoutButton = screen.getByRole('button', { name: '結帳' });
    fireEvent.click(checkoutButton);

    await waitFor(() => {
      expect(apiService.checkoutAppointment).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({
            item_type: 'service_item',
            service_item_id: 1,
            practitioner_id: 1,
            amount: expect.any(Number),
            revenue_share: expect.any(Number),
            quantity: 1,
            display_order: 0,
          }),
        ]),
        'cash'
      );
      // Verify billing_scenario_id is NOT in the request
      const callArgs = vi.mocked(apiService.checkoutAppointment).mock.calls[0];
      const items = callArgs[1] as any[];
      expect(items[0]).not.toHaveProperty('billing_scenario_id');
    });
  });

  it('should call onSuccess and onClose after successful checkout', async () => {
    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      expect(apiService.getPractitioners).toHaveBeenCalled();
    });

    const checkoutButton = screen.getByRole('button', { name: '結帳' });
    fireEvent.click(checkoutButton);

    await waitFor(() => {
      expect(apiService.checkoutAppointment).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    }, { timeout: 3000 });
  });

  it('should show error message when checkout fails', async () => {
    const error = new Error('Checkout failed');
    vi.mocked(apiService.checkoutAppointment).mockRejectedValue(error);

    render(
      <CheckoutModal
        event={mockEvent}
        appointmentTypes={mockAppointmentTypes}
        practitioners={mockPractitioners}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    await waitFor(() => {
      expect(apiService.getPractitioners).toHaveBeenCalled();
    });

    const checkoutButton = screen.getByRole('button', { name: '結帳' });
    fireEvent.click(checkoutButton);

    // Wait for the error message to appear (either from getErrorMessage or fallback)
    await waitFor(() => {
      // The error message could be "Checkout failed" (from getErrorMessage) or "結帳失敗，請重試" (fallback)
      const errorText = screen.queryByText(/結帳失敗|Checkout failed/);
      expect(errorText).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});


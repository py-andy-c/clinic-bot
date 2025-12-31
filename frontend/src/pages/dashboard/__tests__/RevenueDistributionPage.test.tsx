/**
 * Unit tests for RevenueDistributionPage component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import RevenueDistributionPage from '../RevenueDistributionPage';
import { useApiData } from '../../../hooks/useApiData';
import { apiService } from '../../../services/api';

// Mock useApiData hook
vi.mock('../../../hooks/useApiData');

// Mock apiService
vi.mock('../../../services/api', () => ({
  apiService: {
    getMembers: vi.fn(),
    getClinicSettings: vi.fn(),
    getRevenueDistribution: vi.fn(),
    getBusinessInsights: vi.fn(),
    getServiceTypeGroups: vi.fn(() => Promise.resolve({ groups: [] })),
    getBatchCalendar: vi.fn(),
  },
}));

// Mock useAuth
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    isClinicAdmin: true,
  }),
}));

// Mock SortableTableHeader
vi.mock('../../../components/dashboard/SortableTableHeader', () => ({
  SortableTableHeader: ({ children, onSort, column, currentSort }: { children: React.ReactNode; onSort: (column: string) => void; column: string; currentSort: { column: string; direction: string } }) => (
    <th onClick={() => onSort(column)} data-testid={`sort-header-${column}`}>
      {children}
      {currentSort.column === column && (
        <span data-testid={`sort-indicator-${column}`}>
          {currentSort.direction === 'asc' ? '↑' : '↓'}
        </span>
      )}
    </th>
  ),
}));

// Mock TimeRangePresets
vi.mock('../../../components/dashboard/TimeRangePresets', () => ({
  TimeRangePresets: ({ onSelect }: { onSelect: (preset: string) => void }) => (
    <div data-testid="time-range-presets">
      <button onClick={() => onSelect('month')}>本月</button>
    </div>
  ),
  getDateRangeForPreset: vi.fn((preset: string) => ({
    startDate: '2024-01-01',
    endDate: '2024-01-31',
  })),
  detectPresetFromDates: vi.fn(() => 'month'),
}));

// Mock FilterDropdown
vi.mock('../../../components/dashboard/FilterDropdown', () => ({
  FilterDropdown: ({ type, value, onChange }: { type: string; value: string; onChange: (value: string) => void }) => (
    <select
      data-testid={`filter-${type}`}
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">全部</option>
      <option value="1">Option 1</option>
    </select>
  ),
}));

// Mock DashboardFilters
vi.mock('../../../components/dashboard/DashboardFilters', () => ({
  DashboardFilters: ({ 
    practitionerId, 
    hasGroups,
    groupId, 
    serviceItemId, 
    onPractitionerChange, 
    onGroupChange, 
    onServiceItemChange,
    onApplyFilters,
    checkbox,
  }: { practitionerId?: string | null; hasGroups?: boolean; groupId?: string | null; serviceItemId?: string | null; onPractitionerChange?: (value: string | null) => void; onGroupChange?: (value: string | null) => void; onServiceItemChange?: (value: string | null) => void; onApplyFilters?: () => void; checkbox?: React.ReactNode }) => (
    <div data-testid="dashboard-filters">
      <select
        data-testid="filter-practitioner"
        value={practitionerId || ''}
        onChange={(e) => onPractitionerChange(e.target.value || null)}
      >
        <option value="">全部</option>
        <option value="1">Option 1</option>
      </select>
      {hasGroups && (
        <select
          data-testid="filter-group"
          value={groupId || ''}
          onChange={(e) => onGroupChange(e.target.value || null)}
        >
          <option value="">全部</option>
          <option value="1">Option 1</option>
        </select>
      )}
      {(!hasGroups || groupId) && (
        <select
          data-testid="filter-service"
          value={serviceItemId || ''}
          onChange={(e) => onServiceItemChange(e.target.value || null)}
        >
          <option value="">全部</option>
          <option value="1">Option 1</option>
        </select>
      )}
      {checkbox && (
        <input
          type="checkbox"
          data-testid="filter-checkbox"
          checked={checkbox.checked}
          onChange={(e) => checkbox.onChange(e.target.checked)}
        />
      )}
      <button data-testid="apply-filters-button" onClick={onApplyFilters}>
        套用篩選
      </button>
    </div>
  ),
}));

// Mock ReceiptViewModal
vi.mock('../../../components/calendar/ReceiptViewModal', () => ({
  ReceiptViewModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="receipt-modal">
        <button onClick={onClose}>Close Receipt</button>
      </div>
    ) : null,
}));

// Mock EventModal
vi.mock('../../../components/calendar/EventModal', () => ({
  EventModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="appointment-modal">
        <button onClick={onClose}>Close Appointment</button>
      </div>
    ) : null,
}));

// Mock shared components
vi.mock('../../../components/shared', () => ({
  LoadingSpinner: ({ size }: { size?: string }) => <div data-testid="loading-spinner">Loading {size}</div>,
  ErrorMessage: ({ message }: { message: string }) => <div data-testid="error-message">{message}</div>,
  InfoButton: ({ onClick, ariaLabel }: { onClick: () => void; ariaLabel?: string }) => (
    <button data-testid="info-button" onClick={onClick} aria-label={ariaLabel}>
      ℹ️
    </button>
  ),
  InfoModal: ({ isOpen, onClose, title, children }: { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }) =>
    isOpen ? (
      <div data-testid="info-modal">
        <h2>{title}</h2>
        {children}
        <button onClick={onClose}>Close</button>
      </div>
    ) : null,
}));

// Mock calendar utilities
vi.mock('../../../utils/calendarDataAdapter', () => ({
  transformToCalendarEvents: vi.fn((events: unknown[]) => events),
  formatEventTimeRange: vi.fn(() => '10:00 AM - 11:00 AM'),
}));

const mockUseApiData = vi.mocked(useApiData);

describe('RevenueDistributionPage', () => {
  const renderWithRouter = (component: React.ReactElement) => {
    return render(<BrowserRouter>{component}</BrowserRouter>);
  };
  const mockMembers = [
    { id: 1, full_name: '王醫師', roles: ['practitioner'] },
  ];

  const mockSettings = {
    appointment_types: [
      { id: 1, name: '初診評估', receipt_name: '初診評估' },
    ],
  };

  const mockRevenueDistribution = {
    summary: {
      total_revenue: 100000,
      total_clinic_share: 30000,
      receipt_item_count: 50,
    },
    items: [
      {
        receipt_id: 1,
        receipt_number: 'R2024-001',
        date: '2024-01-15',
        patient_name: '張三',
        service_item_id: 1,
        service_item_name: '初診評估',
        receipt_name: '初診評估',
        is_custom: false,
        quantity: 1,
        practitioner_id: 1,
        practitioner_name: '王醫師',
        billing_scenario: '原價',
        amount: 3000,
        revenue_share: 900,
        appointment_id: 100,
      },
      {
        receipt_id: 2,
        receipt_number: 'R2024-002',
        date: '2024-01-16',
        patient_name: '李四',
        service_item_id: null,
        service_item_name: '特殊檢查',
        receipt_name: '特殊檢查',
        is_custom: true,
        quantity: 1,
        practitioner_id: 1,
        practitioner_name: '王醫師',
        billing_scenario: '其他',
        amount: 2500,
        revenue_share: 750,
        appointment_id: 101,
      },
    ],
    total: 2,
    page: 1,
    page_size: 20,
  };

  const mockBusinessInsights = {
    summary: {
      total_revenue: 100000,
      valid_receipt_count: 50,
      service_item_count: 5,
      active_patients: 30,
      average_transaction_amount: 2000,
    },
    revenue_trend: [],
    by_service: [
      {
        service_item_id: null,
        service_item_name: '特殊檢查',
        receipt_name: '特殊檢查',
        is_custom: true,
        total_revenue: 5000,
        item_count: 5,
        percentage: 5,
      },
    ],
    by_practitioner: [],
  };

  const setupDefaultMocks = (groups: Array<{ id: number; name: string; [key: string]: unknown }> = []) => {
    let callIndex = 0;
    mockUseApiData.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) {
        return {
          data: mockMembers,
          loading: false,
          error: null,
          refetch: vi.fn(),
          clearError: vi.fn(),
          setData: vi.fn(),
        };
      }
      if (callIndex === 2) {
        return {
          data: mockSettings,
          loading: false,
          error: null,
          refetch: vi.fn(),
          clearError: vi.fn(),
          setData: vi.fn(),
        };
      }
      if (callIndex === 3) {
        // getServiceTypeGroups
        return {
          data: { groups },
          loading: false,
          error: null,
          refetch: vi.fn(),
          clearError: vi.fn(),
          setData: vi.fn(),
        };
      }
      if (callIndex === 4) {
        // Unfiltered business insights for custom items extraction
        return {
          data: mockBusinessInsights,
          loading: false,
          error: null,
          refetch: vi.fn(),
          clearError: vi.fn(),
          setData: vi.fn(),
        };
      }
      // Filtered revenue distribution for display (callIndex === 5)
      return {
        data: mockRevenueDistribution,
        loading: false,
        error: null,
        refetch: vi.fn(),
        clearError: vi.fn(),
        setData: vi.fn(),
      };
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('renders loading state correctly', () => {
    let callIndex = 0;
    mockUseApiData.mockImplementation(() => {
      callIndex++;
      if (callIndex <= 4) {
        return {
          data: null,
          loading: false,
          error: null,
          refetch: vi.fn(),
          clearError: vi.fn(),
          setData: vi.fn(),
        };
      }
      return {
        data: null,
        loading: true,
        error: null,
        refetch: vi.fn(),
        clearError: vi.fn(),
        setData: vi.fn(),
      };
    });

    renderWithRouter(<RevenueDistributionPage />);
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('renders error state correctly', () => {
    let callIndex = 0;
    mockUseApiData.mockImplementation(() => {
      callIndex++;
      if (callIndex <= 4) {
        return {
          data: null,
          loading: false,
          error: null,
          refetch: vi.fn(),
          clearError: vi.fn(),
          setData: vi.fn(),
        };
      }
      return {
        data: null,
        loading: false,
        error: 'Failed to load data',
        refetch: vi.fn(),
        clearError: vi.fn(),
        setData: vi.fn(),
      };
    });

    renderWithRouter(<RevenueDistributionPage />);
    expect(screen.getByTestId('error-message')).toBeInTheDocument();
  });

  it('renders revenue distribution data correctly', async () => {
    renderWithRouter(<RevenueDistributionPage />);

    await waitFor(() => {
      expect(screen.getByText('診所分潤審核')).toBeInTheDocument();
    });

    // Check summary cards
    await waitFor(() => {
      expect(screen.getByText('總營收')).toBeInTheDocument();
    });
    expect(screen.getByText('總診所分潤')).toBeInTheDocument();
    expect(screen.getByText('收據項目數')).toBeInTheDocument();

    // Check table headers - wait for table to render
    await waitFor(() => {
      expect(screen.getByText('收據編號')).toBeInTheDocument();
      expect(screen.getByText('預約日期')).toBeInTheDocument();
      expect(screen.getByText('病患')).toBeInTheDocument();
    });

    // Check table data
    await waitFor(() => {
      expect(screen.getByText('R2024-001')).toBeInTheDocument();
      expect(screen.getByText('張三')).toBeInTheDocument();
    });
  });

  it('highlights overwritten items with yellow background', async () => {
    renderWithRouter(<RevenueDistributionPage />);

    await waitFor(() => {
      const rows = screen.getAllByText('R2024-002');
      expect(rows.length).toBeGreaterThan(0);
    });

    // Find the row with overwritten item (billing_scenario = '其他')
    const overwrittenRow = screen.getByText('特殊檢查').closest('tr');
    expect(overwrittenRow).toHaveClass('bg-yellow-100');
  });

  it('handles empty state correctly', async () => {
    const emptyData = {
      ...mockRevenueDistribution,
      items: [],
      total: 0,
    };

    let callIndex = 0;
    mockUseApiData.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) {
        return {
          data: mockMembers,
          loading: false,
          error: null,
          refetch: vi.fn(),
          clearError: vi.fn(),
          setData: vi.fn(),
        };
      }
      if (callIndex === 2) {
        return {
          data: mockSettings,
          loading: false,
          error: null,
          refetch: vi.fn(),
          clearError: vi.fn(),
          setData: vi.fn(),
        };
      }
      if (callIndex === 3) {
        // getServiceTypeGroups
        return {
          data: { groups: [] },
          loading: false,
          error: null,
          refetch: vi.fn(),
          clearError: vi.fn(),
          setData: vi.fn(),
        };
      }
      if (callIndex === 4) {
        // Unfiltered business insights for custom items extraction
        return {
          data: mockBusinessInsights,
          loading: false,
          error: null,
          refetch: vi.fn(),
          clearError: vi.fn(),
          setData: vi.fn(),
        };
      }
      // Filtered revenue distribution for display (callIndex === 5)
      return {
        data: emptyData,
        loading: false,
        error: null,
        refetch: vi.fn(),
        clearError: vi.fn(),
        setData: vi.fn(),
      };
    });

    renderWithRouter(<RevenueDistributionPage />);

    await waitFor(() => {
      expect(screen.getByText('目前沒有符合條件的資料')).toBeInTheDocument();
    });
  });

  it('renders pagination info', async () => {
    const paginatedData = {
      ...mockRevenueDistribution,
      total: 50,
      page: 1,
      page_size: 20,
    };

    let callIndex = 0;
    mockUseApiData.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) {
        return {
          data: mockMembers,
          loading: false,
          error: null,
          refetch: vi.fn(),
          clearError: vi.fn(),
          setData: vi.fn(),
        };
      }
      if (callIndex === 2) {
        return {
          data: mockSettings,
          loading: false,
          error: null,
          refetch: vi.fn(),
          clearError: vi.fn(),
          setData: vi.fn(),
        };
      }
      if (callIndex === 3) {
        // getServiceTypeGroups
        return {
          data: { groups: [] },
          loading: false,
          error: null,
          refetch: vi.fn(),
          clearError: vi.fn(),
          setData: vi.fn(),
        };
      }
      if (callIndex === 4) {
        // Unfiltered business insights for custom items extraction
        return {
          data: mockBusinessInsights,
          loading: false,
          error: null,
          refetch: vi.fn(),
          clearError: vi.fn(),
          setData: vi.fn(),
        };
      }
      // Filtered revenue distribution for display (callIndex === 5)
      return {
        data: paginatedData,
        loading: false,
        error: null,
        refetch: vi.fn(),
        clearError: vi.fn(),
        setData: vi.fn(),
      };
    });

    renderWithRouter(<RevenueDistributionPage />);

    await waitFor(() => {
      expect(screen.getByText(/顯示.*到.*筆/)).toBeInTheDocument();
    });
  });

  it('displays custom service items with italic styling', async () => {
    renderWithRouter(<RevenueDistributionPage />);

    await waitFor(() => {
      const customItem = screen.getByText('特殊檢查');
      expect(customItem).toBeInTheDocument();
      // Check if it's in italic (custom items should have italic class)
      const parent = customItem.closest('td');
      expect(parent).toBeInTheDocument();
    });
  });

  it('displays null practitioner as "無"', async () => {
    const dataWithNullPractitioner = {
      ...mockRevenueDistribution,
      items: [
        {
          ...mockRevenueDistribution.items[0],
          practitioner_id: null,
          practitioner_name: null,
        },
      ],
    };

    let callIndex = 0;
    mockUseApiData.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) {
        return {
          data: mockMembers,
          loading: false,
          error: null,
          refetch: vi.fn(),
          clearError: vi.fn(),
          setData: vi.fn(),
        };
      }
      if (callIndex === 2) {
        return {
          data: mockSettings,
          loading: false,
          error: null,
          refetch: vi.fn(),
          clearError: vi.fn(),
          setData: vi.fn(),
        };
      }
      if (callIndex === 3) {
        // getServiceTypeGroups
        return {
          data: { groups: [] },
          loading: false,
          error: null,
          refetch: vi.fn(),
          clearError: vi.fn(),
          setData: vi.fn(),
        };
      }
      if (callIndex === 4) {
        // Unfiltered business insights for custom items extraction
        return {
          data: mockBusinessInsights,
          loading: false,
          error: null,
          refetch: vi.fn(),
          clearError: vi.fn(),
          setData: vi.fn(),
        };
      }
      // Filtered revenue distribution for display (callIndex === 5)
      return {
        data: dataWithNullPractitioner,
        loading: false,
        error: null,
        refetch: vi.fn(),
        clearError: vi.fn(),
        setData: vi.fn(),
      };
    });

    renderWithRouter(<RevenueDistributionPage />);

    await waitFor(() => {
      expect(screen.getByText('無')).toBeInTheDocument();
    });
  });

  it('hides group filter when no groups exist', async () => {
    setupDefaultMocks([]); // No groups
    renderWithRouter(<RevenueDistributionPage />);

    await waitFor(() => {
      expect(screen.getByText('診所分潤審核')).toBeInTheDocument();
    });

    // Group filter should not be visible
    expect(screen.queryByTestId('filter-group')).not.toBeInTheDocument();
    // Service item filter should be visible (always shown when no groups)
    expect(screen.getByTestId('filter-service')).toBeInTheDocument();
  });

  it('shows group filter when groups exist', async () => {
    const mockGroups = [
      { id: 1, name: '治療群組', display_order: 0 },
      { id: 2, name: '檢查群組', display_order: 1 },
    ];
    setupDefaultMocks(mockGroups);
    renderWithRouter(<RevenueDistributionPage />);

    await waitFor(() => {
      expect(screen.getByText('診所分潤審核')).toBeInTheDocument();
    });

    // Group filter should be visible
    expect(screen.getByTestId('filter-group')).toBeInTheDocument();
    // Service item filter should not be visible initially (only when group is selected)
    expect(screen.queryByTestId('filter-service')).not.toBeInTheDocument();
  });

  it('shows service item filter when group is selected', async () => {
    const mockGroups = [
      { id: 1, name: '治療群組', display_order: 0 },
    ];
    setupDefaultMocks(mockGroups);
    renderWithRouter(<RevenueDistributionPage />);

    await waitFor(() => {
      expect(screen.getByText('診所分潤審核')).toBeInTheDocument();
    });

    // Select a group
    const groupFilter = screen.getByTestId('filter-group');
    fireEvent.change(groupFilter, { target: { value: '1' } });

    await waitFor(() => {
      // Service item filter should appear when group is selected
      expect(screen.getByTestId('filter-service')).toBeInTheDocument();
    });
  });
});

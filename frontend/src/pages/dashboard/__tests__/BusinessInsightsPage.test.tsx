/**
 * Unit tests for BusinessInsightsPage component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import BusinessInsightsPage from '../BusinessInsightsPage';
import { useApiData } from '../../../hooks/useApiData';

// Mock useApiData hook
vi.mock('../../../hooks/useApiData');

// Mock useAuth hook
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { active_clinic_id: 1 },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

// Mock apiService
vi.mock('../../../services/api', () => ({
  apiService: {
    getMembers: vi.fn(),
    getClinicSettings: vi.fn(),
    getBusinessInsights: vi.fn(),
    getServiceTypeGroups: vi.fn(() => Promise.resolve({ groups: [] })),
  },
}));

// Mock RevenueTrendChart
vi.mock('../../../components/dashboard/RevenueTrendChart', () => ({
  RevenueTrendChart: ({ view }: { data: unknown[]; view: string }) => (
    <div data-testid="revenue-trend-chart">
      RevenueTrendChart - View: {view}
    </div>
  ),
}));

// Mock TimeRangePresets
vi.mock('../../../components/dashboard/TimeRangePresets', () => ({
  TimeRangePresets: ({ onSelect }: { onSelect: (_preset: string) => void }) => (
    <div data-testid="time-range-presets">
      <button onClick={() => onSelect('month')}>本月</button>
    </div>
  ),
  getDateRangeForPreset: vi.fn((_preset: string) => ({
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

const mockUseApiData = vi.mocked(useApiData);

describe('BusinessInsightsPage', () => {
  const renderWithRouter = (component: React.ReactElement) => {
    return render(<BrowserRouter>{component}</BrowserRouter>);
  };
  const mockMembers = [
    { id: 1, full_name: '王醫師', roles: ['practitioner'] },
    { id: 2, full_name: '李治療師', roles: ['practitioner'] },
  ];

  const mockSettings = {
    appointment_types: [
      { id: 1, name: '初診評估', receipt_name: '初診評估' },
      { id: 2, name: '復健治療', receipt_name: '復健治療' },
    ],
  };

  const mockBusinessInsights = {
    summary: {
      total_revenue: 100000,
      valid_receipt_count: 50,
      service_item_count: 5,
      active_patients: 30,
      average_transaction_amount: 2000,
    },
    revenue_trend: [
      { date: '2024-01-01', total: 50000, by_service: {}, by_practitioner: {}, by_group: {} },
      { date: '2024-01-02', total: 50000, by_service: {}, by_practitioner: {}, by_group: {} },
    ],
    by_service: [
      {
        service_item_id: 1,
        service_item_name: '初診評估',
        receipt_name: '初診評估',
        is_custom: false,
        total_revenue: 60000,
        item_count: 30,
        percentage: 60,
      },
    ],
    by_practitioner: [
      {
        practitioner_id: 1,
        practitioner_name: '王醫師',
        total_revenue: 70000,
        item_count: 35,
        percentage: 70,
      },
    ],
    by_group: [
      {
        service_type_group_id: 1,
        group_name: '治療群組',
        total_revenue: 80000,
        item_count: 40,
        percentage: 80,
      },
    ],
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
      // Filtered business insights for display (callIndex === 5)
      return {
        data: mockBusinessInsights,
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
    let callCount = 0;
    mockUseApiData.mockImplementation(() => {
      callCount++;
      if (callCount <= 4) {
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

    renderWithRouter(<BusinessInsightsPage />);
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

    renderWithRouter(<BusinessInsightsPage />);
    expect(screen.getByTestId('error-message')).toBeInTheDocument();
    expect(screen.getByText('Failed to load data')).toBeInTheDocument();
  });

  it('renders business insights data correctly', async () => {
    renderWithRouter(<BusinessInsightsPage />);

    await waitFor(() => {
      expect(screen.getByText('業務洞察')).toBeInTheDocument();
    });

    // Check summary cards (use getAllByText for "總營收" since it appears in both card and dropdown)
    expect(screen.getAllByText('總營收').length).toBeGreaterThan(0);
    expect(screen.getByText('有效收據數')).toBeInTheDocument();
    expect(screen.getByText('服務項目數')).toBeInTheDocument();
    expect(screen.getByText('活躍病患')).toBeInTheDocument();
    expect(screen.getByText('平均交易金額')).toBeInTheDocument();

    // Check chart
    expect(screen.getByTestId('revenue-trend-chart')).toBeInTheDocument();

    // Check breakdown tables
    // When no groups exist, "依服務項目" should appear instead of "依群組"
    // "依治療師" always appears
    expect(screen.getAllByText('依服務項目').length).toBeGreaterThan(0);
    expect(screen.getAllByText('依治療師').length).toBeGreaterThan(0);
  });

  it('handles empty breakdown tables', async () => {
    const emptyData = {
      ...mockBusinessInsights,
      by_service: [],
      by_practitioner: [],
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
          data: emptyData,
          loading: false,
          error: null,
          refetch: vi.fn(),
          clearError: vi.fn(),
          setData: vi.fn(),
        };
      }
      // Filtered business insights for display (callIndex === 5)
      return {
        data: emptyData,
        loading: false,
        error: null,
        refetch: vi.fn(),
        clearError: vi.fn(),
        setData: vi.fn(),
      };
    });

    renderWithRouter(<BusinessInsightsPage />);

    await waitFor(() => {
      // Empty message appears in both tables, so use getAllByText
      expect(screen.getAllByText('目前沒有符合條件的資料').length).toBeGreaterThan(0);
    });
  });

  it('renders chart view selector', async () => {
    renderWithRouter(<BusinessInsightsPage />);

    await waitFor(() => {
      expect(screen.getByText('顯示方式：')).toBeInTheDocument();
    });

    const viewSelector = screen.getByDisplayValue('總營收');
    expect(viewSelector).toBeInTheDocument();
  });

  it('handles hooks order correctly (no hooks violation)', async () => {
    // This test ensures hooks are called in consistent order
    // by rendering the component multiple times with different states
    
    // First render with loading
    let callIndex = 0;
    mockUseApiData.mockImplementation(() => {
      callIndex++;
      return {
        data: null,
        loading: callIndex === 5, // Only fifth call (filtered business insights) is loading
        error: null,
        refetch: vi.fn(),
        clearError: vi.fn(),
        setData: vi.fn(),
      };
    });

    const { rerender } = renderWithRouter(<BusinessInsightsPage />);
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();

    // Second render with data
    callIndex = 0;
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
      // Filtered business insights for display (callIndex === 5)
      return {
        data: mockBusinessInsights,
        loading: false,
        error: null,
        refetch: vi.fn(),
        clearError: vi.fn(),
        setData: vi.fn(),
      };
    });

    rerender(<BrowserRouter><BusinessInsightsPage /></BrowserRouter>);

    // If hooks are in wrong order, this will throw an error
    await waitFor(() => {
      expect(screen.getByText('業務洞察')).toBeInTheDocument();
    });
  });

  it('hides group filter when no groups exist', async () => {
    setupDefaultMocks([]); // No groups
    renderWithRouter(<BusinessInsightsPage />);

    await waitFor(() => {
      expect(screen.getByText('業務洞察')).toBeInTheDocument();
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
    renderWithRouter(<BusinessInsightsPage />);

    await waitFor(() => {
      expect(screen.getByText('業務洞察')).toBeInTheDocument();
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
    renderWithRouter(<BusinessInsightsPage />);

    await waitFor(() => {
      expect(screen.getByText('業務洞察')).toBeInTheDocument();
    });

    // Select a group
    const groupFilter = screen.getByTestId('filter-group');
    fireEvent.change(groupFilter, { target: { value: '1' } });

    await waitFor(() => {
      // Service item filter should appear when group is selected
      expect(screen.getByTestId('filter-service')).toBeInTheDocument();
    });
  });

  it('shows service breakdown when no groups exist', async () => {
    setupDefaultMocks([]); // No groups
    renderWithRouter(<BusinessInsightsPage />);

    await waitFor(() => {
      expect(screen.getByText('業務洞察')).toBeInTheDocument();
    });

    // Service breakdown table should be visible (check for table header, not dropdown option)
    const serviceBreakdownHeaders = screen.getAllByText('依服務項目');
    expect(serviceBreakdownHeaders.length).toBeGreaterThan(0);
    // Group breakdown should not be visible
    expect(screen.queryByText('依群組')).not.toBeInTheDocument();
  });

  it('shows group breakdown when groups exist and no group is selected', async () => {
    const mockGroups = [
      { id: 1, name: '治療群組', display_order: 0 },
    ];
    setupDefaultMocks(mockGroups);
    renderWithRouter(<BusinessInsightsPage />);

    await waitFor(() => {
      expect(screen.getByText('業務洞察')).toBeInTheDocument();
    });

    // Group breakdown table should be visible (check for table header, not dropdown option)
    const groupBreakdownHeaders = screen.getAllByText('依群組');
    expect(groupBreakdownHeaders.length).toBeGreaterThan(0);
    // Service breakdown should not be visible (only when group is selected)
    // Note: "依服務項目" may appear in chart dropdown, so check for table header specifically
    const serviceBreakdownTables = screen.queryAllByText('依服務項目').filter(
      el => el.tagName === 'H2'
    );
    expect(serviceBreakdownTables.length).toBe(0);
  });
});

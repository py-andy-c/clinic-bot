/**
 * Unit tests for BusinessInsightsPage component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import BusinessInsightsPage from '../BusinessInsightsPage';
import { useApiData } from '../../../hooks/useApiData';
import { apiService } from '../../../services/api';

// Mock useApiData hook
vi.mock('../../../hooks/useApiData');

// Mock apiService
vi.mock('../../../services/api', () => ({
  apiService: {
    getMembers: vi.fn(),
    getClinicSettings: vi.fn(),
    getBusinessInsights: vi.fn(),
  },
}));

// Mock RevenueTrendChart
vi.mock('../../../components/dashboard/RevenueTrendChart', () => ({
  RevenueTrendChart: ({ data, view }: any) => (
    <div data-testid="revenue-trend-chart">
      RevenueTrendChart - View: {view}
    </div>
  ),
}));

// Mock TimeRangePresets
vi.mock('../../../components/dashboard/TimeRangePresets', () => ({
  TimeRangePresets: ({ onSelect }: any) => (
    <div data-testid="time-range-presets">
      <button onClick={() => onSelect('month')}>本月</button>
    </div>
  ),
  getDateRangeForPreset: vi.fn((preset: string) => ({
    startDate: '2024-01-01',
    endDate: '2024-01-31',
  })),
}));

// Mock FilterDropdown
vi.mock('../../../components/dashboard/FilterDropdown', () => ({
  FilterDropdown: ({ type, value, onChange }: any) => (
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

// Mock shared components
vi.mock('../../../components/shared', () => ({
  LoadingSpinner: ({ size }: any) => <div data-testid="loading-spinner">Loading {size}</div>,
  ErrorMessage: ({ message }: any) => <div data-testid="error-message">{message}</div>,
  InfoButton: ({ onClick, ariaLabel }: any) => (
    <button data-testid="info-button" onClick={onClick} aria-label={ariaLabel}>
      ℹ️
    </button>
  ),
  InfoModal: ({ isOpen, onClose, title, children }: any) =>
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
      { date: '2024-01-01', total: 50000, by_service: {}, by_practitioner: {} },
      { date: '2024-01-02', total: 50000, by_service: {}, by_practitioner: {} },
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
  };

  const setupDefaultMocks = () => {
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
      if (callCount <= 2) {
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

    render(<BusinessInsightsPage />);
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('renders error state correctly', () => {
    let callIndex = 0;
    mockUseApiData.mockImplementation(() => {
      callIndex++;
      if (callIndex <= 2) {
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

    render(<BusinessInsightsPage />);
    expect(screen.getByTestId('error-message')).toBeInTheDocument();
    expect(screen.getByText('Failed to load data')).toBeInTheDocument();
  });

  it('renders business insights data correctly', async () => {
    render(<BusinessInsightsPage />);

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
    // Both "依服務項目" and "依治療師" appear in both dropdown options and table headers
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
      return {
        data: emptyData,
        loading: false,
        error: null,
        refetch: vi.fn(),
        clearError: vi.fn(),
        setData: vi.fn(),
      };
    });

    render(<BusinessInsightsPage />);

    await waitFor(() => {
      // Empty message appears in both tables, so use getAllByText
      expect(screen.getAllByText('目前沒有符合條件的資料').length).toBeGreaterThan(0);
    });
  });

  it('renders chart view selector', async () => {
    render(<BusinessInsightsPage />);

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
        loading: callIndex === 3, // Only third call (business insights) is loading
        error: null,
        refetch: vi.fn(),
        clearError: vi.fn(),
        setData: vi.fn(),
      };
    });

    const { rerender } = render(<BusinessInsightsPage />);
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
      return {
        data: mockBusinessInsights,
        loading: false,
        error: null,
        refetch: vi.fn(),
        clearError: vi.fn(),
        setData: vi.fn(),
      };
    });

    rerender(<BusinessInsightsPage />);

    // If hooks are in wrong order, this will throw an error
    await waitFor(() => {
      expect(screen.getByText('業務洞察')).toBeInTheDocument();
    });
  });
});

import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRevenueDistribution } from '../useRevenueDistribution';
import { apiService } from '../../../services/api';
import { useAuth } from '../../useAuth';

// Mock the API service
vi.mock('../../../services/api', () => ({
  apiService: {
    getRevenueDistribution: vi.fn(),
  },
}));

// Mock useAuth
vi.mock('../../useAuth');

const mockApiService = vi.mocked(apiService);

describe('useRevenueDistribution', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );

  it('should return revenue distribution data when API call succeeds', async () => {
    const mockParams = {
      start_date: '2024-01-01',
      end_date: '2024-01-31',
      page: 1,
      page_size: 20,
    };
    const mockData = {
      data: [
        { practitioner_name: 'Dr. Smith', total_revenue: 10000 },
      ],
      total_count: 1,
      summary: { total_revenue: 10000 },
    };

    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: { active_clinic_id: 1 },
    });

    mockApiService.getRevenueDistribution.mockResolvedValue(mockData);

    const { result } = renderHook(() => useRevenueDistribution(mockParams), { wrapper });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockData);
    expect(result.current.error).toBeNull();
    expect(mockApiService.getRevenueDistribution).toHaveBeenCalledWith(mockParams);
  });

  it('should not fetch when no active clinic ID', () => {
    const mockParams = {
      start_date: '2024-01-01',
      end_date: '2024-01-31',
    };

    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: null,
    });

    const { result } = renderHook(() => useRevenueDistribution(mockParams), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(mockApiService.getRevenueDistribution).not.toHaveBeenCalled();
  });

  it('should handle API errors', async () => {
    const mockParams = {
      start_date: '2024-01-01',
      end_date: '2024-01-31',
    };
    const errorMessage = 'API Error';

    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: { active_clinic_id: 1 },
    });

    mockApiService.getRevenueDistribution.mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(() => useRevenueDistribution(mockParams), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeDefined();
    expect(result.current.data).toBeUndefined();
  });
});

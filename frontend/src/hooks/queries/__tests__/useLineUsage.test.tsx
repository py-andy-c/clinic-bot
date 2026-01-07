import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLineUsage } from '../useLineUsage';
import { apiService } from '../../../services/api';
import { useAuth } from '../../useAuth';

// Mock the API service
vi.mock('../../../services/api', () => ({
  apiService: {
    getDashboardMetrics: vi.fn(),
  },
}));

// Mock useAuth
vi.mock('../../useAuth');

const mockApiService = vi.mocked(apiService);

describe('useLineUsage', () => {
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

  it('should return dashboard metrics data when API call succeeds', async () => {
    const mockData = {
      total_users: 150,
      active_users: 120,
      messages_sent: 2500,
      appointments_booked: 45,
      conversion_rate: 0.18,
    };

    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: { active_clinic_id: 1 },
    });

    mockApiService.getDashboardMetrics.mockResolvedValue(mockData);

    const { result } = renderHook(() => useLineUsage(), { wrapper });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockData);
    expect(result.current.error).toBeNull();
    expect(mockApiService.getDashboardMetrics).toHaveBeenCalledTimes(1);
  });

  it('should not fetch when no active clinic ID', () => {
    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: null,
    });

    const { result } = renderHook(() => useLineUsage(), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(mockApiService.getDashboardMetrics).not.toHaveBeenCalled();
  });

  it('should handle API errors', async () => {
    const errorMessage = 'API Error';

    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: { active_clinic_id: 1 },
    });

    mockApiService.getDashboardMetrics.mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(() => useLineUsage(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeDefined();
    expect(result.current.data).toBeUndefined();
  });
});

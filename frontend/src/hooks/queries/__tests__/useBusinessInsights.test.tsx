import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useBusinessInsights } from '../useBusinessInsights';
import { apiService } from '../../../services/api';
import { useAuth } from '../../useAuth';

// Mock the API service
vi.mock('../../../services/api', () => ({
  apiService: {
    getBusinessInsights: vi.fn(),
  },
}));

// Mock useAuth
vi.mock('../../useAuth');

const mockApiService = vi.mocked(apiService);

describe('useBusinessInsights', () => {
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

  it('should return business insights data when API call succeeds', async () => {
    const mockParams = {
      start_date: '2024-01-01',
      end_date: '2024-01-31',
      practitioner_id: 1,
    };
    const mockData = {
      revenue_by_service: [
        { service_name: 'General Treatment', revenue: 5000, count: 25 },
      ],
      revenue_by_practitioner: [
        { practitioner_name: 'Dr. Smith', revenue: 8000, appointments: 40 },
      ],
      total_revenue: 13000,
      total_appointments: 65,
      average_revenue_per_appointment: 200,
    };

    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: { active_clinic_id: 1 },
    });

    mockApiService.getBusinessInsights.mockResolvedValue(mockData);

    const { result } = renderHook(() => useBusinessInsights(mockParams), { wrapper });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockData);
    expect(result.current.error).toBeNull();
    expect(mockApiService.getBusinessInsights).toHaveBeenCalledWith(mockParams);
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

    const { result } = renderHook(() => useBusinessInsights(mockParams), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(mockApiService.getBusinessInsights).not.toHaveBeenCalled();
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

    mockApiService.getBusinessInsights.mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(() => useBusinessInsights(mockParams), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeDefined();
    expect(result.current.data).toBeUndefined();
  });
});

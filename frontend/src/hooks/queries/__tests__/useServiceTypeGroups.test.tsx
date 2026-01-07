import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useServiceTypeGroups } from '../useServiceTypeGroups';
import { apiService } from '../../../services/api';
import { useAuth } from '../../../hooks/useAuth';

// Mock the API service
vi.mock('../../../services/api', () => ({
  apiService: {
    getServiceTypeGroups: vi.fn(),
  },
}));

// Mock useAuth hook
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

const mockApiService = vi.mocked(apiService);
const mockUseAuth = vi.mocked(useAuth);

describe('useServiceTypeGroups', () => {
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

    // Default mock for useAuth
    mockUseAuth.mockReturnValue({
      user: { active_clinic_id: 1 },
      isAuthenticated: true,
      isLoading: false,
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );

  it('should return service type groups data when API call succeeds', async () => {
    const mockResponse = {
      groups: [
        {
          id: 1,
          clinic_id: 1,
          name: '治療群組',
          display_order: 0,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 2,
          clinic_id: 1,
          name: '檢查群組',
          display_order: 1,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ],
    };

    mockApiService.getServiceTypeGroups.mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useServiceTypeGroups(), { wrapper });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockResponse);
    expect(mockApiService.getServiceTypeGroups).toHaveBeenCalledTimes(1);
  });

  it('should handle API errors', async () => {
    const errorMessage = 'Failed to fetch service type groups';
    mockApiService.getServiceTypeGroups.mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(() => useServiceTypeGroups(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error?.message).toBe(errorMessage);
    expect(result.current.data).toBeUndefined();
  });

  it('should not fetch when clinic ID is not available', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: true,
      isLoading: false,
    });

    const { result } = renderHook(() => useServiceTypeGroups(), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(mockApiService.getServiceTypeGroups).not.toHaveBeenCalled();
  });
});

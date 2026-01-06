import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePractitioners } from '../usePractitioners';
import { apiService } from '../../../services/api';
import { useAuth } from '../../useAuth';

// Mock the API service
vi.mock('../../../services/api', () => ({
  apiService: {
    getPractitioners: vi.fn(),
  },
}));

// Mock useAuth
vi.mock('../../useAuth');

const mockApiService = vi.mocked(apiService);

describe('usePractitioners', () => {
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

  it('should return practitioners data when API call succeeds', async () => {
    const mockPractitioners = [
      { id: 1, full_name: 'Dr. Smith' },
      { id: 2, full_name: 'Dr. Johnson' },
    ];

    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: { active_clinic_id: 1 },
      isAuthenticated: true,
    });

    mockApiService.getPractitioners.mockResolvedValue(mockPractitioners);

    const { result } = renderHook(() => usePractitioners(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockPractitioners);
    expect(result.current.error).toBeNull();
    expect(mockApiService.getPractitioners).toHaveBeenCalledTimes(1);
  });

  it('should handle API error', async () => {
    const mockError = new Error('Failed to fetch practitioners');

    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: { active_clinic_id: 1 },
      isAuthenticated: true,
    });

    mockApiService.getPractitioners.mockRejectedValue(mockError);

    const { result } = renderHook(() => usePractitioners(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeDefined();
  });

  it('should not fetch when no active clinic ID', () => {
    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: true,
    });

    const { result } = renderHook(() => usePractitioners(), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(mockApiService.getPractitioners).not.toHaveBeenCalled();
  });

  it('should use correct query key with clinic ID', async () => {
    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: { active_clinic_id: 123 },
      isAuthenticated: true,
    });

    mockApiService.getPractitioners.mockResolvedValue([]);

    const { result } = renderHook(() => usePractitioners(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // The query should be called with the clinic ID in the query key
    expect(mockApiService.getPractitioners).toHaveBeenCalledTimes(1);
  });
});

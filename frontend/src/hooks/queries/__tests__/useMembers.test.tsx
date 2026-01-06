import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMembers } from '../useMembers';
import { apiService } from '../../../services/api';
import { useAuth } from '../../useAuth';

// Mock the API service
vi.mock('../../../services/api', () => ({
  apiService: {
    getMembers: vi.fn(),
  },
}));

// Mock useAuth
vi.mock('../../useAuth');

const mockApiService = vi.mocked(apiService);

describe('useMembers', () => {
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

  it('should return members data when API call succeeds', async () => {
    const mockMembers = [
      { id: 1, email: 'admin@example.com', full_name: 'Admin User', roles: ['admin'] },
      { id: 2, email: 'practitioner@example.com', full_name: 'Dr. Smith', roles: ['practitioner'] },
    ];

    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: { active_clinic_id: 1 },
      isAuthenticated: true,
    });

    mockApiService.getMembers.mockResolvedValue(mockMembers);

    const { result } = renderHook(() => useMembers(), { wrapper });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockMembers);
    expect(result.current.error).toBeNull();
    expect(mockApiService.getMembers).toHaveBeenCalledTimes(1);
  });

  it('should not fetch when no active clinic ID', () => {
    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: true,
    });

    const { result } = renderHook(() => useMembers(), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(mockApiService.getMembers).not.toHaveBeenCalled();
  });
});

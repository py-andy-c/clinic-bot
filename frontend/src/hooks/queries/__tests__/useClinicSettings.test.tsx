import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useClinicSettings } from '../useClinicSettings';
import { apiService } from '../../../services/api';
import { useAuth } from '../../useAuth';

// Mock the API service
vi.mock('../../../services/api', () => ({
  apiService: {
    getClinicSettings: vi.fn(),
  },
}));

// Mock useAuth
vi.mock('../../useAuth');

const mockApiService = vi.mocked(apiService);

describe('useClinicSettings', () => {
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

  it('should return clinic settings data when API call succeeds', async () => {
    const mockClinicSettings = {
      clinic_name: 'Test Clinic',
      timezone: 'Asia/Taipei',
      appointment_types: [
        { id: 1, name: 'General Treatment', duration_minutes: 60 },
        { id: 2, name: 'Cleaning', duration_minutes: 30 },
      ],
      business_hours: { monday: { open: '09:00', close: '17:00' } },
    };

    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: { active_clinic_id: 1 },
      isAuthenticated: true,
      isLoading: false,
    });

    mockApiService.getClinicSettings.mockResolvedValue(mockClinicSettings);

    const { result } = renderHook(() => useClinicSettings(true), { wrapper });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockClinicSettings);
    expect(result.current.error).toBeNull();
    expect(mockApiService.getClinicSettings).toHaveBeenCalledTimes(1);
  });

  it('should not fetch when enabled is false', () => {
    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: { active_clinic_id: 1 },
      isAuthenticated: true,
      isLoading: false,
    });

    const { result } = renderHook(() => useClinicSettings(false), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(mockApiService.getClinicSettings).not.toHaveBeenCalled();
  });

  it('should not fetch when not authenticated', () => {
    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: { active_clinic_id: 1 },
      isAuthenticated: false,
      isLoading: false,
    });

    const { result } = renderHook(() => useClinicSettings(), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(mockApiService.getClinicSettings).not.toHaveBeenCalled();
  });

  it('should not fetch when auth is loading', () => {
    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: { active_clinic_id: 1 },
      isAuthenticated: true,
      isLoading: true,
    });

    const { result } = renderHook(() => useClinicSettings(), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(mockApiService.getClinicSettings).not.toHaveBeenCalled();
  });

  it('should not fetch when no active clinic ID', () => {
    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: true,
      isLoading: false,
    });

    const { result } = renderHook(() => useClinicSettings(), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(mockApiService.getClinicSettings).not.toHaveBeenCalled();
  });

  it('should handle API errors', async () => {
    const errorMessage = 'API Error';
    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: { active_clinic_id: 1 },
      isAuthenticated: true,
      isLoading: false,
    });

    mockApiService.getClinicSettings.mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(() => useClinicSettings(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeDefined();
    expect(result.current.data).toBeUndefined();
  });
});

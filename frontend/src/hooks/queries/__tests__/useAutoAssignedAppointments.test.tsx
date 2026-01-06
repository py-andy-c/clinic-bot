import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAutoAssignedAppointments } from '../useAutoAssignedAppointments';
import { apiService } from '../../../services/api';
import { useAuth } from '../../useAuth';

// Mock the API service
vi.mock('../../../services/api', () => ({
  apiService: {
    getAutoAssignedAppointments: vi.fn(),
  },
}));

// Mock useAuth
vi.mock('../../useAuth');

const mockApiService = vi.mocked(apiService);

describe('useAutoAssignedAppointments', () => {
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

  it('should return appointments data when API call succeeds', async () => {
    const mockAppointments = {
      appointments: [
        {
          appointment_id: 1,
          calendar_event_id: 1,
          patient_name: 'John Doe',
          patient_id: 1,
          appointment_type_name: 'Regular Checkup',
          scheduled_at: '2024-01-15T10:00:00Z',
          assigned_practitioner_name: 'Dr. Smith',
          assigned_practitioner_id: 1,
        },
      ],
    };

    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: { active_clinic_id: 1 },
      isAuthenticated: true,
    });

    mockApiService.getAutoAssignedAppointments.mockResolvedValue(mockAppointments);

    const { result } = renderHook(() => useAutoAssignedAppointments(), { wrapper });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockAppointments);
    expect(result.current.error).toBeNull();
    expect(mockApiService.getAutoAssignedAppointments).toHaveBeenCalledTimes(1);
  });

  it('should not fetch when no active clinic ID', () => {
    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: true,
    });

    const { result } = renderHook(() => useAutoAssignedAppointments(), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(mockApiService.getAutoAssignedAppointments).not.toHaveBeenCalled();
  });
});

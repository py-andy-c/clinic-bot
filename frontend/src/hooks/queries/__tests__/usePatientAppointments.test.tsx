import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePatientAppointments } from '../usePatientAppointments';
import { useAuth } from '../../useAuth';

// Mock useAuth
vi.mock('../../useAuth');

describe('usePatientAppointments', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    queryClient.clear();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );

  it('should fetch patient appointments successfully', async () => {
    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: { active_clinic_id: 1 },
    });

    const { result } = renderHook(() => usePatientAppointments(1), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toBeDefined();
    expect(Array.isArray(result.current.data?.appointments)).toBe(true);
  });

  it('should not fetch when patientId is undefined', async () => {
    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: { active_clinic_id: 1 },
    });

    const { result } = renderHook(() => usePatientAppointments(undefined), { wrapper });

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
  });
});

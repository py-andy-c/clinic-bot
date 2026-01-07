import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePatientDetail } from '../usePatientDetail';
import { useAuth } from '../../useAuth';

// Mock useAuth
vi.mock('../../useAuth');

describe('usePatientDetail', () => {
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

  it('should fetch patient detail successfully', async () => {
    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: { active_clinic_id: 1 },
    });

    const { result } = renderHook(() => usePatientDetail(1), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toBeDefined();
    expect(result.current.data?.id).toBe(1);
  });

  it('should not fetch when patientId is undefined', async () => {
    const mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: { active_clinic_id: 1 },
    });

    const { result } = renderHook(() => usePatientDetail(undefined), { wrapper });

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
  });
});

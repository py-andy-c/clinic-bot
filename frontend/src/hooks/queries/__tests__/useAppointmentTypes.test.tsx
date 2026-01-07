import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAppointmentTypes } from '../useAppointmentTypes';
import { liffApiService } from '../../../services/liffApi';
import { useAppointmentStore } from '../../../stores/appointmentStore';

// Mock the API service
vi.mock('../../../services/liffApi', () => ({
  liffApiService: {
    getAppointmentTypes: vi.fn(),
  },
}));

// Mock the appointment store
vi.mock('../../../stores/appointmentStore');

const mockLiffApiService = vi.mocked(liffApiService);
const mockUseAppointmentStore = vi.mocked(useAppointmentStore);

describe('useAppointmentTypes', () => {
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

  it('should return appointment types data when API call succeeds', async () => {
    const mockResponse = {
      appointment_types: [
        {
          id: 1,
          name: 'General Treatment',
          duration_minutes: 60,
          receipt_name: 'General',
          allow_patient_booking: true,
          description: 'General dental treatment',
        },
        {
          id: 2,
          name: 'Cleaning',
          duration_minutes: 30,
          receipt_name: 'Cleaning',
          allow_patient_booking: true,
        },
      ],
      appointment_type_instructions: 'Please select your service',
    };

    mockUseAppointmentStore.mockReturnValue({
      clinicId: 1,
    });

    mockLiffApiService.getAppointmentTypes.mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useAppointmentTypes(), { wrapper });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual({
      appointmentTypes: [
        {
          id: 1,
          name: 'General Treatment',
          duration_minutes: 60,
          receipt_name: 'General',
          allow_patient_booking: true,
          description: 'General dental treatment',
          clinic_id: 1,
          is_deleted: false,
        },
        {
          id: 2,
          name: 'Cleaning',
          duration_minutes: 30,
          receipt_name: 'Cleaning',
          allow_patient_booking: true,
          clinic_id: 1,
          is_deleted: false,
        },
      ],
      appointmentTypeInstructions: 'Please select your service',
    });
    expect(result.current.error).toBeNull();
    expect(mockLiffApiService.getAppointmentTypes).toHaveBeenCalledWith(1, undefined);
  });

  it('should pass patientId to API when provided', async () => {
    const mockResponse = {
      appointment_types: [
        {
          id: 1,
          name: 'Existing Patient Treatment',
          duration_minutes: 45,
        },
      ],
      appointment_type_instructions: null,
    };

    mockUseAppointmentStore.mockReturnValue({
      clinicId: 1,
    });

    mockLiffApiService.getAppointmentTypes.mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useAppointmentTypes(123), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockLiffApiService.getAppointmentTypes).toHaveBeenCalledWith(1, 123);
  });

  it('should not fetch when no clinic ID', () => {
    mockUseAppointmentStore.mockReturnValue({
      clinicId: null,
    });

    const { result } = renderHook(() => useAppointmentTypes(), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(mockLiffApiService.getAppointmentTypes).not.toHaveBeenCalled();
  });

  it('should handle API errors', async () => {
    const errorMessage = 'API Error';
    mockUseAppointmentStore.mockReturnValue({
      clinicId: 1,
    });

    mockLiffApiService.getAppointmentTypes.mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(() => useAppointmentTypes(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeDefined();
    expect(result.current.data).toBeUndefined();
  });
});

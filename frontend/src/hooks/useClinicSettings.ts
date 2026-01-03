import { useQuery } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { useAuth } from './useAuth';
import { ClinicSettings } from '../schemas/api';

/**
 * Query key factory for clinic settings queries
 */
export const clinicSettingsKeys = {
  all: ['clinicSettings'] as const,
  detail: (clinicId?: number) => [...clinicSettingsKeys.all, clinicId] as const,
};

/**
 * Hook to fetch clinic settings
 * 
 * Automatically includes clinic ID in query key for proper cache separation
 * when users switch between clinics.
 * 
 * @param enabled - Whether the query should run (default: true)
 */
export function useClinicSettings(enabled: boolean = true) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const queryKey = clinicSettingsKeys.detail(activeClinicId ?? undefined);

  return useQuery<ClinicSettings>({
    queryKey,
    queryFn: async ({ queryKey: qk }) => {
      // Log React Query execution with timestamp (development only)
      const isDevelopment = typeof window !== 'undefined' && process.env.NODE_ENV === 'development';
      if (isDevelopment) {
        const timestamp = new Date().toISOString();
        const stackTrace = new Error().stack;
        const caller = stackTrace?.split('\n')[2]?.trim() || 'unknown';
        console.log(`[${timestamp}] [FRONTEND] [RQ-QUERY] Executing queryFn for ${JSON.stringify(qk)} from: ${caller}`);
      }
      
      try {
        const result = await apiService.getClinicSettings();
        if (isDevelopment) {
          const timestamp = new Date().toISOString();
          console.log(`[${timestamp}] [FRONTEND] [RQ-QUERY] Query ${JSON.stringify(qk)} succeeded`);
        }
        return result;
      } catch (error) {
        if (isDevelopment) {
          const timestamp = new Date().toISOString();
          console.log(`[${timestamp}] [FRONTEND] [RQ-QUERY] Query ${JSON.stringify(qk)} failed:`, error);
        }
        throw error;
      }
    },
    enabled: enabled && !isLoading && isAuthenticated && !!activeClinicId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: (failureCount, error) => {
      // Log React Query retry decisions with timestamp (development only)
      const isDevelopment = typeof window !== 'undefined' && process.env.NODE_ENV === 'development';
      if (isDevelopment) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [FRONTEND] [RQ-RETRY] Query ${JSON.stringify(queryKey)} - failureCount: ${failureCount}, willRetry: ${failureCount < 1}, error:`, error);
      }
      return failureCount < 1; // Retry once (retry: 1)
    },
  });
}


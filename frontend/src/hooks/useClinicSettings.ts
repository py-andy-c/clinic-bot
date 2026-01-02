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

  return useQuery<ClinicSettings>({
    queryKey: clinicSettingsKeys.detail(activeClinicId ?? undefined),
    queryFn: () => apiService.getClinicSettings(),
    enabled: enabled && !isLoading && isAuthenticated && !!activeClinicId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}


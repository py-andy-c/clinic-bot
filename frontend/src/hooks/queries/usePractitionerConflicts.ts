import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';
import { useDebounce } from '../useDebounce';

/**
 * Hook for checking conflicts for a single practitioner
 */
export const usePractitionerConflicts = (
  practitionerId: number | null,
  date: string | null,
  startTime: string | null,
  appointmentTypeId: number | null,
  selectedResourceIds?: number[] | null,
  excludeCalendarEventId?: number | null,
  enabled: boolean = true
) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  // Debounce the parameters to avoid excessive API calls
  const debouncedDate = useDebounce(date, 300);
  const debouncedStartTime = useDebounce(startTime, 300);
  const debouncedAppointmentTypeId = useDebounce(appointmentTypeId, 300);

  return useQuery({
    queryKey: [
      'practitioner-conflicts',
      activeClinicId,
      debouncedDate,
      debouncedStartTime,
      debouncedAppointmentTypeId,
      practitionerId,
      selectedResourceIds?.join(','),
      excludeCalendarEventId
    ],
    queryFn: async () => {
      if (!practitionerId || !debouncedDate || !debouncedStartTime || !debouncedAppointmentTypeId) {
        throw new Error('Missing required parameters');
      }

      // Use batch API with single practitioner for backward compatibility
      const practitioner: { user_id: number; exclude_calendar_event_id?: number } = { user_id: practitionerId };
      if (excludeCalendarEventId != null) {
        practitioner.exclude_calendar_event_id = excludeCalendarEventId;
      }
      const practitioners = [practitioner];

      const result = await apiService.checkBatchPractitionerConflicts({
        practitioners,
        date: debouncedDate,
        start_time: debouncedStartTime,
        appointment_type_id: debouncedAppointmentTypeId,
        ...(selectedResourceIds ? { selected_resource_ids: selectedResourceIds } : {})
      });

      // Extract the single practitioner result from batch response
      const practitionerResult = result.results.find((r: any) => r.practitioner_id === practitionerId);
      if (!practitionerResult) {
        throw new Error('Practitioner not found in batch response');
      }

      return practitionerResult;
    },
    enabled: enabled && !!activeClinicId && !!practitionerId && !!debouncedDate && !!debouncedStartTime && !!debouncedAppointmentTypeId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
};

/**
 * Hook for checking conflicts for multiple practitioners (batch)
 */
export const useBatchPractitionerConflicts = (
  practitioners: Array<{ user_id: number; exclude_calendar_event_id?: number }> | null,
  date: string | null,
  startTime: string | null,
  appointmentTypeId: number | null,
  selectedResourceIds?: number[] | null,
  enabled: boolean = true
) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  // Debounce the parameters to avoid excessive API calls
  const debouncedDate = useDebounce(date, 300);
  const debouncedStartTime = useDebounce(startTime, 300);
  const debouncedAppointmentTypeId = useDebounce(appointmentTypeId, 300);

  return useQuery({
    queryKey: [
      'practitioner-conflicts-batch',
      activeClinicId,
      debouncedDate,
      debouncedStartTime,
      debouncedAppointmentTypeId,
      practitioners?.map(p => `${p.user_id}-${p.exclude_calendar_event_id || 0}`).join(','),
      selectedResourceIds?.join(',')
    ],
    queryFn: () => {
      if (!practitioners || practitioners.length === 0 || !debouncedDate || !debouncedStartTime || !debouncedAppointmentTypeId) {
        return { results: [] };
      }
      return apiService.checkBatchPractitionerConflicts({
        practitioners,
        date: debouncedDate,
        start_time: debouncedStartTime,
        appointment_type_id: debouncedAppointmentTypeId,
        ...(selectedResourceIds ? { selected_resource_ids: selectedResourceIds } : {})
      });
    },
    enabled: enabled && !!activeClinicId && !!practitioners && practitioners.length > 0 && !!debouncedDate && !!debouncedStartTime && !!debouncedAppointmentTypeId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
};

/**
 * Hook for checking resource conflicts
 */
export const useResourceConflicts = (
  appointmentTypeId: number | null,
  startTime: string | null, // ISO datetime string
  endTime: string | null, // ISO datetime string
  selectedResourceIds?: number[] | null,
  excludeCalendarEventId?: number | null,
  enabled: boolean = true
) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  // Debounce the parameters to avoid excessive API calls
  const debouncedAppointmentTypeId = useDebounce(appointmentTypeId, 300);
  const debouncedStartTime = useDebounce(startTime, 300);
  const debouncedEndTime = useDebounce(endTime, 300);

  return useQuery({
    queryKey: [
      'resource-conflicts',
      activeClinicId,
      debouncedStartTime,
      debouncedEndTime,
      debouncedAppointmentTypeId,
      selectedResourceIds?.join(','),
      excludeCalendarEventId
    ],
    queryFn: () => {
      if (!debouncedAppointmentTypeId || !debouncedStartTime || !debouncedEndTime) {
        throw new Error('Missing required parameters');
      }
      const params: {
        appointment_type_id: number;
        start_time: string;
        end_time: string;
        selected_resource_ids?: number[];
        exclude_calendar_event_id?: number;
      } = {
        appointment_type_id: debouncedAppointmentTypeId,
        start_time: debouncedStartTime,
        end_time: debouncedEndTime,
        ...(selectedResourceIds ? { selected_resource_ids: selectedResourceIds } : {})
      };

      if (excludeCalendarEventId) {
        params.exclude_calendar_event_id = excludeCalendarEventId;
      }

      return apiService.checkResourceConflicts(params);
    },
    enabled: enabled && !!activeClinicId && !!debouncedAppointmentTypeId && !!debouncedStartTime && !!debouncedEndTime,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
};
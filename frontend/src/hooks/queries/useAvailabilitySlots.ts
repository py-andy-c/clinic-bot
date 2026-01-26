/**
 * React Query hooks for availability slots management
 * Replaces the manual availability cache system
 */

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';
import { invalidateCalendarEventsForAppointment } from './useCalendarEvents';
import { invalidatePatientAppointments } from '../../utils/reactQueryInvalidation';
import { TimeInterval } from '../../types';
import type { AxiosError } from 'axios';

export interface UseAvailabilitySlotsParams {
  practitionerId: number;
  appointmentTypeId: number;
  date: string;
  excludeCalendarEventId?: number;
}

/**
 * Hook for fetching availability slots for a specific practitioner/date/appointment type
 * Replaces the manual availability cache system
 */
export const useAvailabilitySlots = ({
  practitionerId,
  appointmentTypeId,
  date,
  excludeCalendarEventId,
}: UseAvailabilitySlotsParams) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: ['availability-slots', activeClinicId, practitionerId, appointmentTypeId, date, excludeCalendarEventId],
    queryFn: async (): Promise<TimeInterval[]> => {
      try {
        const response = await apiService.getAvailableSlots(
          practitionerId,
          date,
          appointmentTypeId,
          excludeCalendarEventId
        );
        return response.available_slots || [];
      } catch (error) {
        // Handle 404 errors (practitioner doesn't offer appointment type)
        if ((error as AxiosError)?.response?.status === 404) {
          return [];
        }
        throw error;
      }
    },
    enabled: !!(practitionerId && appointmentTypeId && date),
    staleTime: 30 * 1000, // 30 seconds - short enough for booking decisions
    gcTime: 5 * 60 * 1000, // 5 minutes cache
    refetchInterval: 60 * 1000, // Background refresh every minute
    refetchIntervalInBackground: true, // Keep fresh even when tab inactive
    refetchOnWindowFocus: true, // Refetch when user returns to tab
  });
};

/**
 * Hook for fetching batch availability slots for multiple dates
 * Used by calendar components to show availability across a month
 */
export const useBatchAvailabilitySlots = ({
  practitionerId,
  appointmentTypeId,
  dates,
  excludeCalendarEventId,
  enabled = true,
}: {
  practitionerId: number;
  appointmentTypeId: number;
  dates: string[];
  excludeCalendarEventId?: number | undefined;
  enabled?: boolean;
}) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: ['batch-availability-slots', activeClinicId, practitionerId, appointmentTypeId, dates.sort().join(','), excludeCalendarEventId],
    queryFn: async (): Promise<Record<string, TimeInterval[]>> => {
      if (dates.length === 0) return {};

      try {
        const response = await apiService.getBatchAvailableSlots(
          practitionerId,
          dates,
          appointmentTypeId,
          excludeCalendarEventId
        );

        // Convert array response to date-keyed object
        const result: Record<string, TimeInterval[]> = {};
        response.results.forEach((item) => {
          if (item.date && item.available_slots) {
            result[item.date] = item.available_slots;
          }
        });

        return result;
      } catch (error) {
        // Handle 404 errors (practitioner doesn't offer appointment type)
        // Return empty result instead of throwing - the UI will show appropriate warnings
        if ((error as any)?.response?.status === 404) {
          return {};
        }
        throw error;
      }
    },
    enabled: enabled && !!(practitionerId && appointmentTypeId && dates.length > 0),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });
};

/**
 * Mutation hook for creating appointments with optimistic updates
 * Immediately marks slots as unavailable for instant UI feedback
 */
export const useCreateAppointmentOptimistic = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useMutation({
    mutationFn: async (params: {
      practitionerId: number;
      appointmentTypeId: number;
      date: string;
      startTime: string;
      patientId: number;
      clinicNotes?: string;
      selectedResourceIds?: number[];
    }) => {
      return apiService.createClinicAppointment({
        practitioner_id: params.practitionerId,
        appointment_type_id: params.appointmentTypeId,
        start_time: `${params.date}T${params.startTime}`,
        patient_id: params.patientId,
        selected_resource_ids: params.selectedResourceIds || [],
        ...(params.clinicNotes ? { clinic_notes: params.clinicNotes } : {}),
      });
    },

    // Optimistic update - immediately mark slot as unavailable
    onMutate: async (params) => {
      // Cancel any ongoing queries for this practitioner/type/date combination
      await queryClient.cancelQueries({
        predicate: (query) => {
          const queryKey = query.queryKey as (string | number | undefined)[];
          return queryKey[0] === 'availability-slots' &&
            queryKey[1] === activeClinicId &&
            queryKey[2] === params.practitionerId &&
            queryKey[3] === params.appointmentTypeId &&
            queryKey[4] === params.date;
        }
      });


      // Get current slot data
      const previousSlots = queryClient.getQueryData<TimeInterval[]>([
        'availability-slots',
        activeClinicId,
        params.practitionerId,
        params.appointmentTypeId,
        params.date,
        undefined
      ]);

      // Mark the specific time slot as unavailable immediately
      queryClient.setQueryData<TimeInterval[]>(
        ['availability-slots', activeClinicId, params.practitionerId, params.appointmentTypeId, params.date, undefined],
        (oldSlots) => {
          if (!oldSlots) return oldSlots;
          return oldSlots.filter(slot => slot.start_time !== params.startTime);
        }
      );

      return { previousSlots };
    },

    // Rollback on error - restore the previous state defensively
    onError: (_error, params, context) => {
      if (context?.previousSlots) {
        // Only rollback if we have previous state to restore
        queryClient.setQueryData(
          ['availability-slots', activeClinicId, params.practitionerId, params.appointmentTypeId, params.date, undefined],
          context.previousSlots
        );
      } else {
        // Fallback: invalidate the cache to force a fresh fetch
        // This handles edge cases where context is lost
        queryClient.invalidateQueries({
          predicate: (query) => {
            const queryKey = query.queryKey as (string | number | undefined)[];
            return queryKey[0] === 'availability-slots' &&
              queryKey[1] === activeClinicId &&
              queryKey[2] === params.practitionerId &&
              queryKey[3] === params.appointmentTypeId &&
              queryKey[4] === params.date;
          }
        });
      }

    },

    // Always refetch to ensure server accuracy
    onSettled: (_data, _error, params) => {
      // Invalidate all availability-slots queries for this practitioner/type/date combination
      // regardless of excludeCalendarEventId parameter
      queryClient.invalidateQueries({
        predicate: (query) => {
          const queryKey = query.queryKey as (string | number | undefined)[];
          return queryKey[0] === 'availability-slots' &&
            queryKey[1] === activeClinicId &&
            queryKey[2] === params.practitionerId &&
            queryKey[3] === params.appointmentTypeId &&
            queryKey[4] === params.date;
        }
      });
      // Invalidate calendar events for the clinic to update the calendar display
      invalidateCalendarEventsForAppointment(queryClient, activeClinicId);
      // Invalidate specific patient appointment queries to prevent stale data
      invalidatePatientAppointments(queryClient, activeClinicId, params.patientId);
    }
  });
};
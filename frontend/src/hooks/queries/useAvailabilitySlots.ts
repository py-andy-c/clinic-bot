/**
 * React Query hooks for availability slots management
 * Replaces the manual availability cache system
 */

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiService } from '../../services/api';
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
  return useQuery({
    queryKey: ['availability-slots', practitionerId, appointmentTypeId, date, excludeCalendarEventId],
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
 * Mutation hook for creating appointments with optimistic updates
 * Immediately marks slots as unavailable for instant UI feedback
 */
export const useCreateAppointmentOptimistic = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      practitionerId: number;
      appointmentTypeId: number;
      date: string;
      startTime: string;
      patientId: number;
      clinicNotes?: string;
    }) => {
      return apiService.createClinicAppointment({
        practitioner_id: params.practitionerId,
        appointment_type_id: params.appointmentTypeId,
        start_time: `${params.date}T${params.startTime}`,
        patient_id: params.patientId,
        selected_resource_ids: [],
        ...(params.clinicNotes ? { clinic_notes: params.clinicNotes } : {}),
      });
    },

    // Optimistic update - immediately mark slot as unavailable
    onMutate: async (params) => {
      // Cancel any ongoing queries for this practitioner/type/date combination
      await queryClient.cancelQueries({
        predicate: (query) => {
          const queryKey = query.queryKey as (string | number)[];
          return queryKey.length >= 4 &&
                 queryKey[0] === 'availability-slots' &&
                 queryKey[1] === params.practitionerId &&
                 queryKey[2] === params.appointmentTypeId &&
                 queryKey[3] === params.date;
        }
      });

      // Get current slot data
      const previousSlots = queryClient.getQueryData<TimeInterval[]>([
        'availability-slots',
        params.practitionerId,
        params.appointmentTypeId,
        params.date
      ]);

      // Mark the specific time slot as unavailable immediately
      queryClient.setQueryData<TimeInterval[]>(
        ['availability-slots', params.practitionerId, params.appointmentTypeId, params.date],
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
          ['availability-slots', params.practitionerId, params.appointmentTypeId, params.date],
          context.previousSlots
        );
      } else {
        // Fallback: invalidate the cache to force a fresh fetch
        // This handles edge cases where context is lost
        queryClient.invalidateQueries({
          predicate: (query) => {
            const queryKey = query.queryKey as (string | number)[];
            return queryKey.length >= 4 &&
                   queryKey[0] === 'availability-slots' &&
                   queryKey[1] === params.practitionerId &&
                   queryKey[2] === params.appointmentTypeId &&
                   queryKey[3] === params.date;
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
          const queryKey = query.queryKey as (string | number)[];
          return queryKey.length >= 4 &&
                 queryKey[0] === 'availability-slots' &&
                 queryKey[1] === params.practitionerId &&
                 queryKey[2] === params.appointmentTypeId &&
                 queryKey[3] === params.date;
        }
      });
      // Invalidate related queries to ensure UI consistency
      queryClient.invalidateQueries({
        queryKey: ['calendar-events', params.practitionerId]
      });
      // Invalidate all patient appointment queries to prevent stale data
      // (we don't know the specific patient ID, so invalidate broadly)
      queryClient.invalidateQueries({
        predicate: (query) => {
          const queryKey = query.queryKey as (string | number)[];
          return queryKey.length >= 2 &&
                 queryKey[0] === 'patient-appointments';
        }
      });
    }
  });
};
/**
 * React Query hooks for resource availability management
 * Replaces the manual resourceAvailabilityCache system
 */

import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { ResourceAvailabilityResponse } from '../../types';
import moment from 'moment-timezone';

export interface UseResourceAvailabilityParams {
  appointmentTypeId: number;
  practitionerId: number;
  date: string;
  startTime: string;
  durationMinutes: number;
  excludeCalendarEventId?: number | undefined;
}

/**
 * Hook for fetching resource availability for a specific time slot
 * Replaces manual caching with React Query
 */
export const useResourceAvailability = ({
  appointmentTypeId,
  practitionerId,
  date,
  startTime,
  durationMinutes,
  excludeCalendarEventId,
}: UseResourceAvailabilityParams) => {
  return useQuery({
    queryKey: [
      'resource-availability',
      appointmentTypeId,
      practitionerId,
      date,
      startTime,
      durationMinutes,
      excludeCalendarEventId
    ],
    queryFn: async (): Promise<ResourceAvailabilityResponse> => {
      // Calculate end time from start time and duration
      const startMoment = moment.tz(`${date}T${startTime}`, 'Asia/Taipei');
      const endMoment = startMoment.clone().add(durationMinutes, 'minutes');
      const endTime = endMoment.format('HH:mm');

      return apiService.getResourceAvailability({
        appointment_type_id: appointmentTypeId,
        practitioner_id: practitionerId,
        date,
        start_time: startTime,
        end_time: endTime,
        ...(excludeCalendarEventId ? { exclude_calendar_event_id: excludeCalendarEventId } : {}),
      });
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - resource availability changes less frequently
    gcTime: 10 * 60 * 1000, // 10 minutes
    enabled: !!(appointmentTypeId && practitionerId && date && startTime && durationMinutes),
    retry: (failureCount, error: any) => {
      // Don't retry on auth errors or client errors
      if (error && typeof error === 'object' && 'status' in error) {
        const status = error.status;
        if (status >= 400 && status < 500) {
          return false;
        }
      }
      return failureCount < 2;
    },
  });
};
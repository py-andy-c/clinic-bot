/**
 * React Query Invalidation Utilities
 *
 * Utilities to invalidate React Query caches after appointment edits/deletions,
 * replacing manual cache invalidation with React Query patterns.
 */

import { QueryClient } from '@tanstack/react-query';

/**
 * Invalidate availability slots queries for a specific date, practitioner, and appointment type
 * Replaces invalidateCacheForDate from availabilityCache.ts
 */
export function invalidateAvailabilitySlotsForDate(
  queryClient: QueryClient,
  practitionerId: number | null,
  appointmentTypeId: number | null,
  date: string
): void {
  if (!queryClient) {
    return;
  }

  queryClient.invalidateQueries({
    predicate: (query) => {
      const queryKey = query.queryKey as (string | number | undefined)[];

      // Match availability-slots queries: ['availability-slots', practitionerId, appointmentTypeId, date, excludeCalendarEventId]
      // Handle both queries with and without excludeCalendarEventId (5 elements vs 4 elements)
      if (queryKey.length >= 4 &&
          queryKey[0] === 'availability-slots' &&
          queryKey[1] === practitionerId &&
          queryKey[2] === appointmentTypeId &&
          queryKey[3] === date) {
        return true;
      }

      return false;
    }
  });

  // Note: Calendar events invalidation removed due to complex query key structures
  // Calendar views will refresh naturally via stale time or user navigation
}

/**
 * Invalidate resource availability queries for a specific date, practitioner, and appointment type
 * Replaces invalidateResourceCacheForDate from resourceAvailabilityCache.ts
 */
export function invalidateResourceAvailabilityForDate(
  queryClient: QueryClient,
  practitionerId: number | null,
  appointmentTypeId: number | null,
  date: string
): void {
  if (!queryClient) {
    return;
  }

  queryClient.invalidateQueries({
    predicate: (query) => {
      const queryKey = query.queryKey as (string | number | undefined)[];

      // Match resource-availability queries: ['resource-availability', appointmentTypeId, practitionerId, date, ...]
      // The key structure is: ['resource-availability', appointmentTypeId, practitionerId, date, startTime, durationMinutes, excludeCalendarEventId]
      return queryKey.length >= 4 &&
             queryKey[0] === 'resource-availability' &&
             queryKey[1] === appointmentTypeId &&
             queryKey[2] === practitionerId &&
             queryKey[3] === date;
    }
  });
}

/**
 * Invalidate patient appointments for a specific patient
 * Targeted invalidation instead of global clinic-wide invalidation
 */
export function invalidatePatientAppointments(
  queryClient: QueryClient,
  clinicId: number,
  patientId: number
): void {
  if (!queryClient) {
    return;
  }

  queryClient.invalidateQueries({
    queryKey: ['patient-appointments', clinicId, patientId]
  });
}

/**
 * Invalidate all availability-related queries after appointment operations
 * Comprehensive invalidation for edit/delete operations
 */
export function invalidateAvailabilityAfterAppointmentChange(
  queryClient: QueryClient,
  practitionerId: number | null,
  appointmentTypeId: number | null,
  dates: string[],
  clinicId?: number,
  patientId?: number
): void {
  if (!queryClient) {
    return;
  }

  // Handle null IDs gracefully - don't invalidate if essential IDs are missing
  if (!practitionerId || !appointmentTypeId) {
    return;
  }

  // Invalidate availability slots and resource availability for all specified dates
  dates.forEach(date => {
    invalidateAvailabilitySlotsForDate(queryClient, practitionerId, appointmentTypeId, date);
    invalidateResourceAvailabilityForDate(queryClient, practitionerId, appointmentTypeId, date);
  });

  // Invalidate patient appointments if clinic and patient IDs are provided
  if (clinicId && patientId) {
    invalidatePatientAppointments(queryClient, clinicId, patientId);
  }
}
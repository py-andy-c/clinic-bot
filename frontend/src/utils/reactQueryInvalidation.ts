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
  date: string,
  clinicId?: number | null
): void {
  if (!queryClient) {
    return;
  }

  queryClient.invalidateQueries({
    predicate: (query) => {
      const queryKey = query.queryKey as (string | number | undefined)[];

      // Match availability-slots queries: ['availability-slots', (clinicId?), practitionerId, appointmentTypeId, date, excludeCalendarEventId]
      if (queryKey[0] === 'availability-slots') {
        const hasClinicId = queryKey.length === 6;
        const offset = hasClinicId ? 1 : 0;

        // If clinicId is provided, and the query key has a clinicId, they must match
        if (clinicId !== undefined && hasClinicId && queryKey[1] !== clinicId) {
          return false;
        }

        return queryKey[1 + offset] === practitionerId &&
          queryKey[2 + offset] === appointmentTypeId &&
          queryKey[3 + offset] === date;
      }

      return false;
    }
  });
}

/**
 * Invalidate resource availability queries for a specific date, practitioner, and appointment type
 * Replaces invalidateResourceCacheForDate from resourceAvailabilityCache.ts
 */
export function invalidateResourceAvailabilityForDate(
  queryClient: QueryClient,
  practitionerId: number | null,
  appointmentTypeId: number | null,
  date: string,
  clinicId?: number | null
): void {
  if (!queryClient) {
    return;
  }

  queryClient.invalidateQueries({
    predicate: (query) => {
      const queryKey = query.queryKey as (string | number | undefined)[];

      // Match resource-availability queries: ['resource-availability', (clinicId?), appointmentTypeId, practitionerId, date, ...]
      if (queryKey[0] === 'resource-availability') {
        const hasClinicId = queryKey.length === 8;
        const offset = hasClinicId ? 1 : 0;

        // If clinicId is provided, and the query key has a clinicId, they must match
        if (clinicId !== undefined && hasClinicId && queryKey[1] !== clinicId) {
          return false;
        }

        return queryKey[1 + offset] === appointmentTypeId &&
          queryKey[2 + offset] === practitionerId &&
          queryKey[3 + offset] === date;
      }

      return false;
    }
  });
}

/**
 * Invalidate practitioner conflicts for a specific clinic and date
 */
export function invalidatePractitionerConflicts(
  queryClient: QueryClient,
  clinicId: number | null | undefined,
  date?: string
): void {
  if (!queryClient || clinicId === null || clinicId === undefined) {
    return;
  }

  if (date) {
    // Target specific date conflicts if provided
    queryClient.invalidateQueries({
      predicate: (query) => {
        const queryKey = query.queryKey as (string | number | undefined)[];
        return (queryKey[0] === 'practitioner-conflicts' || queryKey[0] === 'practitioner-conflicts-batch') &&
          queryKey[1] === clinicId &&
          queryKey[2] === date;
      }
    });
  } else {
    // Invalidate all conflicts for the clinic
    queryClient.invalidateQueries({
      queryKey: ['practitioner-conflicts', clinicId]
    });
    queryClient.invalidateQueries({
      queryKey: ['practitioner-conflicts-batch', clinicId]
    });
  }
}

/**
 * Invalidate patient appointments for a specific patient
 * Targeted invalidation instead of global clinic-wide invalidation
 */
export function invalidatePatientAppointments(
  queryClient: QueryClient,
  clinicId: number | null | undefined,
  patientId: number
): void {
  if (!queryClient || clinicId === null || clinicId === undefined) {
    return;
  }

  queryClient.invalidateQueries({
    queryKey: ['patient-appointments', clinicId, patientId]
  });
}

/**
 * Invalidate patient detail query for a specific patient
 */
export function invalidatePatientDetail(
  queryClient: QueryClient,
  clinicId: number | null | undefined,
  patientId: number
): void {
  if (!queryClient) {
    return;
  }

  queryClient.invalidateQueries({
    queryKey: ['patient', clinicId, patientId]
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
  clinicId?: number | null,
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
    invalidateAvailabilitySlotsForDate(queryClient, practitionerId, appointmentTypeId, date, clinicId);
    invalidateResourceAvailabilityForDate(queryClient, practitionerId, appointmentTypeId, date, clinicId);

    // Also invalidate conflicts for these dates
    if (clinicId) {
      invalidatePractitionerConflicts(queryClient, clinicId, date);
    }
  });

  // Invalidate batch availability queries - more broad but safer
  if (clinicId) {
    queryClient.invalidateQueries({
      queryKey: ['batch-availability-slots', clinicId, practitionerId, appointmentTypeId]
    });
  } else {
    queryClient.invalidateQueries({
      queryKey: ['batch-availability-slots']
    });
  }

  // Invalidate patient appointments if clinic and patient IDs are provided
  if (clinicId && patientId) {
    invalidatePatientAppointments(queryClient, clinicId, patientId);
  }
}
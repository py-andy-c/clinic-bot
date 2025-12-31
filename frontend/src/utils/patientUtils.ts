import { Patient } from '../types';

/**
 * Extracts assigned practitioner IDs from a patient object.
 * 
 * Prefers assigned_practitioner_ids (primary source from API) over
 * assigned_practitioners (fallback for backward compatibility).
 * Filters out inactive practitioners when using assigned_practitioners.
 * 
 * @param patient - Patient object (can be null)
 * @returns Array of assigned practitioner IDs
 */
export const getAssignedPractitionerIds = (patient: Patient | null): number[] => {
  if (!patient) return [];
  
  // Prefer assigned_practitioner_ids (primary source from API)
  if (patient.assigned_practitioner_ids && patient.assigned_practitioner_ids.length > 0) {
    return patient.assigned_practitioner_ids;
  }
  
  // Fall back to assigned_practitioners (filter out inactive for backward compatibility)
  if (patient.assigned_practitioners && patient.assigned_practitioners.length > 0) {
    return patient.assigned_practitioners
      .filter((p) => p.is_active !== false)
      .map((p) => p.id);
  }
  
  return [];
};




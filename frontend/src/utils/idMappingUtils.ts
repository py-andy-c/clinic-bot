import { AppointmentType, ServiceTypeGroup } from '../types';
import { isTemporaryServiceItemId, isTemporaryGroupId, isRealId } from './idUtils';

/**
 * Maps temporary IDs to real IDs after backend save operations.
 * Matches staged items/groups with saved items/groups by name and clinic_id.
 * 
 * @param stagedServiceItems - Service items from staging store (may have temporary IDs)
 * @param savedServiceItems - Service items returned from backend (have real IDs)
 * @param stagedGroups - Groups from staging store (may have temporary IDs)
 * @param savedGroups - Groups returned from backend (have real IDs)
 * @returns Mapping of temporary IDs to real IDs for both service items and groups
 */
export async function mapTemporaryIds(
  stagedServiceItems: AppointmentType[],
  savedServiceItems: AppointmentType[],
  stagedGroups: ServiceTypeGroup[],
  savedGroups: ServiceTypeGroup[]
): Promise<{ serviceItemMapping: Record<number, number>; groupMapping: Record<number, number> }> {
  const serviceItemMapping: Record<number, number> = {};
  const groupMapping: Record<number, number> = {};
  
  // Map service items by name + duration + clinic_id (to prevent collisions)
  stagedServiceItems.forEach(stagedItem => {
    if (isTemporaryServiceItemId(stagedItem.id)) {
      const savedItem = savedServiceItems.find(saved =>
        saved.name === stagedItem.name &&
        saved.duration_minutes === stagedItem.duration_minutes &&
        saved.clinic_id === stagedItem.clinic_id &&
        isRealId(saved.id)
      );
      if (savedItem) {
        serviceItemMapping[stagedItem.id] = savedItem.id;
      }
    }
  });
  
  // Map groups by name + clinic_id (to prevent collisions)
  stagedGroups.forEach(stagedGroup => {
    if (isTemporaryGroupId(stagedGroup.id)) {
      const savedGroup = savedGroups.find(saved =>
        saved.name === stagedGroup.name &&
        saved.clinic_id === stagedGroup.clinic_id &&
        isRealId(saved.id)
      );
      if (savedGroup) {
        groupMapping[stagedGroup.id] = savedGroup.id;
      }
    }
  });
  
  return { serviceItemMapping, groupMapping };
}



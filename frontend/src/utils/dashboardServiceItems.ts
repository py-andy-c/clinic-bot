import { AppointmentType } from '../types';
import { ServiceItemOption } from '../components/dashboard/FilterDropdown';

/**
 * Filters appointment types by the selected group.
 * 
 * @param appointmentTypes - All appointment types to filter
 * @param pendingGroupId - The selected group ID (number), '-1' for ungrouped, or null for all
 * @param hasGroups - Whether the clinic has groups configured
 * @returns Filtered appointment types
 */
export function filterAppointmentTypesByGroup(
  appointmentTypes: AppointmentType[],
  pendingGroupId: number | string | null,
  hasGroups: boolean
): AppointmentType[] {
  if (!hasGroups || pendingGroupId === null) {
    return appointmentTypes;
  }

  if (pendingGroupId === '-1') {
    // Show only ungrouped items
    return appointmentTypes.filter((at) => !at.service_type_group_id);
  }

  if (typeof pendingGroupId === 'number') {
    // Show only items in the selected group
    return appointmentTypes.filter((at) => at.service_type_group_id === pendingGroupId);
  }

  // Fallback: return all if groupId is an unexpected type
  return appointmentTypes;
}

/**
 * Determines whether custom items should be shown in the service items dropdown.
 * Custom items are ungrouped, so they should only appear when:
 * - No groups exist, OR
 * - The "ungrouped" group (-1) is selected, OR
 * - No group is selected (showing all items)
 * 
 * @param hasGroups - Whether the clinic has groups configured
 * @param pendingGroupId - The selected group ID
 * @returns Whether custom items should be shown
 */
export function shouldShowCustomItems(
  hasGroups: boolean,
  pendingGroupId: number | string | null
): boolean {
  return !hasGroups || pendingGroupId === '-1' || pendingGroupId === null;
}

/**
 * Converts appointment types to ServiceItemOption format.
 * 
 * @param appointmentTypes - Appointment types to convert
 * @returns Array of ServiceItemOption objects
 */
export function appointmentTypesToServiceItemOptions(
  appointmentTypes: AppointmentType[]
): ServiceItemOption[] {
  return appointmentTypes.map((at) => {
    const item: ServiceItemOption = {
      id: at.id,
      name: at.name,
      is_custom: false,
    };
    if (at.receipt_name !== undefined && at.receipt_name !== null) {
      item.receipt_name = at.receipt_name;
    }
    return item;
  });
}


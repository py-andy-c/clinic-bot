/**
 * Service Items Staging Store
 * 
 * Manages staged changes for service items and groups in a single editing session.
 * All changes are staged locally until "儲存變更" is clicked.
 * 
 * Key features:
 * - Single editing session across all views
 * - Reactive dependencies (new groups available immediately)
 * - Temporary ID management
 * - Change detection
 */

import { create } from 'zustand';
import { AppointmentType, ServiceTypeGroup, ResourceRequirement } from '../types';
import { BillingScenario } from './serviceItemsStore';
import { isTemporaryServiceItemId, isTemporaryGroupId } from '../utils/idUtils';

/**
 * Associations that can be passed to initialize() to preserve them during initialization
 */
export type ServiceItemAssociations = {
  practitionerAssignments?: Record<number, number[]>;
  billingScenarios?: Record<string, BillingScenario[]>;
  resourceRequirements?: Record<number, ResourceRequirement[]>;
};

interface ServiceItemsStagingState {
  // Service items (existing + new with temporary IDs)
  serviceItems: AppointmentType[];
  originalServiceItems: AppointmentType[];
  
  // Groups (existing + new with temporary IDs)
  groups: ServiceTypeGroup[];
  originalGroups: ServiceTypeGroup[];
  
  // Associations (keyed by service item ID, including temporary IDs)
  practitionerAssignments: Record<number, number[]>;
  billingScenarios: Record<string, BillingScenario[]>; // key: `${serviceItemId}-${practitionerId}`
  resourceRequirements: Record<number, ResourceRequirement[]>;
  
  // Original associations for change detection
  originalPractitionerAssignments: Record<number, number[]>;
  originalBillingScenarios: Record<string, BillingScenario[]>;
  originalResourceRequirements: Record<number, ResourceRequirement[]>;
  
  // Actions
  initialize: (serviceItems: AppointmentType[], groups: ServiceTypeGroup[], associations?: ServiceItemAssociations) => void;
  
  // Service items
  addServiceItem: (item: AppointmentType) => void;
  updateServiceItem: (id: number, updates: Partial<AppointmentType>) => void;
  deleteServiceItem: (id: number) => void;
  reorderServiceItems: (orderedIds: number[]) => void;
  
  // Groups
  addGroup: (group: ServiceTypeGroup) => void;
  updateGroup: (id: number, updates: Partial<ServiceTypeGroup>) => void;
  deleteGroup: (id: number) => void;
  reorderGroups: (orderedIds: number[]) => void;
  
  // Associations
  updatePractitionerAssignments: (serviceItemId: number, practitionerIds: number[]) => void;
  updateBillingScenarios: (key: string, scenarios: BillingScenario[]) => void;
  updateResourceRequirements: (serviceItemId: number, requirements: ResourceRequirement[]) => void;
  
  // Computed values
  getAvailableGroups: () => ServiceTypeGroup[];
  getGroupCount: (groupId: number | null) => number;
  
  // Change detection
  hasUnsavedChanges: () => boolean;
  
  // Reset
  reset: () => void;
  discardChanges: () => void;
  
  // Sync originals with current state (after successful save)
  syncOriginals: () => void;
}

export const useServiceItemsStagingStore = create<ServiceItemsStagingState>((set, get) => ({
  // Initial state
  serviceItems: [],
  originalServiceItems: [],
  groups: [],
  originalGroups: [],
  practitionerAssignments: {},
  billingScenarios: {},
  resourceRequirements: {},
  originalPractitionerAssignments: {},
  originalBillingScenarios: {},
  originalResourceRequirements: {},

  /**
   * Initialize the store with data from the server
   * 
   * @param serviceItems - Service items to initialize
   * @param groups - Groups to initialize
   * @param associations - Optional associations to preserve. If not provided, existing associations are preserved.
   *                      If provided, only the specified association types are updated.
   * 
   * @example
   * // Full initialization (clears associations)
   * initialize(serviceItems, groups);
   * 
   * @example
   * // Preserve existing associations
   * initialize(serviceItems, groups); // associations omitted = preserves existing
   * 
   * @example
   * // Update with new associations
   * initialize(serviceItems, groups, { practitionerAssignments: {...} });
   */
  initialize: (serviceItems, groups, associations) => {
    const state = get();
    set({
      serviceItems: JSON.parse(JSON.stringify(serviceItems)), // Deep clone
      originalServiceItems: JSON.parse(JSON.stringify(serviceItems)),
      groups: JSON.parse(JSON.stringify(groups)), // Deep clone
      originalGroups: JSON.parse(JSON.stringify(groups)),
      // Explicit preservation: use provided or keep existing (use ?? not || to handle null vs undefined)
      practitionerAssignments: associations?.practitionerAssignments ?? state.practitionerAssignments,
      billingScenarios: associations?.billingScenarios ?? state.billingScenarios,
      resourceRequirements: associations?.resourceRequirements ?? state.resourceRequirements,
      // Same for originals - deep clone if provided, otherwise preserve existing
      originalPractitionerAssignments: associations?.practitionerAssignments 
        ? JSON.parse(JSON.stringify(associations.practitionerAssignments))
        : state.originalPractitionerAssignments,
      originalBillingScenarios: associations?.billingScenarios
        ? JSON.parse(JSON.stringify(associations.billingScenarios))
        : state.originalBillingScenarios,
      originalResourceRequirements: associations?.resourceRequirements
        ? JSON.parse(JSON.stringify(associations.resourceRequirements))
        : state.originalResourceRequirements,
    });
  },

  /**
   * Add a new service item with temporary ID
   * Note: The item should already have a temporary ID assigned (from the caller)
   */
  addServiceItem: (item) => {
    const state = get();
    const maxOrder = state.serviceItems.length > 0
      ? Math.max(...state.serviceItems.map(at => at.display_order || 0))
      : -1;
    
    // Preserve the ID that was passed in (should be a temporary ID from caller)
    const newItem: AppointmentType = {
      ...item,
      id: item.id, // Use the ID from the item (don't overwrite it)
      display_order: (item.display_order ?? maxOrder + 1),
    };
    
    set({
      serviceItems: [...state.serviceItems, newItem],
    });
  },

  /**
   * Update an existing service item
   */
  updateServiceItem: (id, updates) => {
    const state = get();
    const updatedItems = state.serviceItems.map(item =>
      item.id === id ? { ...item, ...updates } : item
    );
    set({
      serviceItems: updatedItems,
    });
  },

  /**
   * Delete a service item (also removes associations)
   */
  deleteServiceItem: (id) => {
    const state = get();
    
    // Remove associations for this item
    const newPractitionerAssignments = { ...state.practitionerAssignments };
    delete newPractitionerAssignments[id];
    
    const newBillingScenarios = { ...state.billingScenarios };
    Object.keys(newBillingScenarios).forEach(key => {
      if (key.startsWith(`${id}-`)) {
        delete newBillingScenarios[key];
      }
    });
    
    const newResourceRequirements = { ...state.resourceRequirements };
    delete newResourceRequirements[id];
    
    set({
      serviceItems: state.serviceItems.filter(item => item.id !== id),
      practitionerAssignments: newPractitionerAssignments,
      billingScenarios: newBillingScenarios,
      resourceRequirements: newResourceRequirements,
    });
  },

  /**
   * Reorder service items
   */
  reorderServiceItems: (orderedIds) => {
    const state = get();
    const orderedItems: AppointmentType[] = [];
    orderedIds.forEach((id, index) => {
      const item = state.serviceItems.find(item => item.id === id);
      if (item) {
        const updatedItem: AppointmentType = {
          ...item,
          display_order: index,
        };
        orderedItems.push(updatedItem);
      }
    });
    
    // Keep items not in orderedIds at the end
    const remainingItems: AppointmentType[] = state.serviceItems
      .filter(item => !orderedIds.includes(item.id))
      .map((item, index): AppointmentType => ({
        ...item,
        display_order: orderedIds.length + index,
      }));
    
    set({
      serviceItems: [...orderedItems, ...remainingItems].sort((a, b) => {
        const orderA = a.display_order ?? 0;
        const orderB = b.display_order ?? 0;
        return orderA - orderB;
      }),
    });
  },

  /**
   * Add a new group with temporary ID
   */
  addGroup: (group) => {
    const state = get();
    const maxOrder = state.groups.length > 0
      ? Math.max(...state.groups.map(g => g.display_order || 0))
      : -1;
    
    const newGroup: ServiceTypeGroup = {
      ...group,
      id: -Date.now(), // Negative temporary ID
      display_order: (group.display_order ?? maxOrder + 1),
    };
    
    set({
      groups: [...state.groups, newGroup],
    });
  },

  /**
   * Update an existing group
   */
  updateGroup: (id, updates) => {
    const state = get();
    set({
      groups: state.groups.map(group =>
        group.id === id ? { ...group, ...updates } : group
      ),
    });
  },

  /**
   * Delete a group (auto-unassigns service items)
   */
  deleteGroup: (id) => {
    const state = get();
    
    // Auto-unassign service items from this group
    const updatedServiceItems = state.serviceItems.map(item =>
      item.service_type_group_id === id
        ? { ...item, service_type_group_id: null }
        : item
    );
    
    set({
      groups: state.groups.filter(group => group.id !== id),
      serviceItems: updatedServiceItems,
    });
  },

  /**
   * Reorder groups
   */
  reorderGroups: (orderedIds) => {
    const state = get();
    const orderedGroups = orderedIds.map((id, index) => {
      const group = state.groups.find(g => g.id === id);
      return group ? { ...group, display_order: index } : null;
    }).filter((g): g is ServiceTypeGroup => g !== null);
    
    // Keep groups not in orderedIds at the end
    const remainingGroups = state.groups
      .filter(g => !orderedIds.includes(g.id))
      .map((g, index) => ({ ...g, display_order: orderedIds.length + index }));
    
    set({
      groups: [...orderedGroups, ...remainingGroups].sort((a, b) => 
        (a.display_order || 0) - (b.display_order || 0)
      ),
    });
  },

  /**
   * Update practitioner assignments for a service item
   */
  updatePractitionerAssignments: (serviceItemId, practitionerIds) => {
    const state = get();
    set({
      practitionerAssignments: {
        ...state.practitionerAssignments,
        [serviceItemId]: practitionerIds,
      },
    });
  },

  /**
   * Update billing scenarios for a service item-practitioner combination
   */
  updateBillingScenarios: (key, scenarios) => {
    const state = get();
    set({
      billingScenarios: {
        ...state.billingScenarios,
        [key]: scenarios,
      },
    });
  },

  /**
   * Update resource requirements for a service item
   */
  updateResourceRequirements: (serviceItemId, requirements) => {
    const state = get();
    set({
      resourceRequirements: {
        ...state.resourceRequirements,
        [serviceItemId]: requirements,
      },
    });
  },

  /**
   * Get all available groups (including temporary ones)
   */
  getAvailableGroups: () => {
    const state = get();
    return [...state.groups].sort((a, b) => 
      (a.display_order || 0) - (b.display_order || 0)
    );
  },

  /**
   * Get count of service items in a group (reactive)
   */
  getGroupCount: (groupId) => {
    const state = get();
    return state.serviceItems.filter(
      item => item.service_type_group_id === groupId
    ).length;
  },

  /**
   * Check if there are unsaved changes
   */
  hasUnsavedChanges: () => {
    const state = get();
    
    // Check service items
    const serviceItemsChanged = JSON.stringify(state.serviceItems) !== JSON.stringify(state.originalServiceItems);
    
    // Check groups
    const groupsChanged = JSON.stringify(state.groups) !== JSON.stringify(state.originalGroups);
    
    // Check associations
    const assignmentsChanged = JSON.stringify(state.practitionerAssignments) !== JSON.stringify(state.originalPractitionerAssignments);
    const scenariosChanged = JSON.stringify(state.billingScenarios) !== JSON.stringify(state.originalBillingScenarios);
    const requirementsChanged = JSON.stringify(state.resourceRequirements) !== JSON.stringify(state.originalResourceRequirements);
    
    // Check for temporary IDs
    const hasTemporaryServiceItems = state.serviceItems.some(item => isTemporaryServiceItemId(item.id));
    const hasTemporaryGroups = state.groups.some(group => isTemporaryGroupId(group.id));
    
    return serviceItemsChanged || groupsChanged || assignmentsChanged || scenariosChanged || requirementsChanged || hasTemporaryServiceItems || hasTemporaryGroups;
  },

  /**
   * Reset to original state (discard all changes)
   */
  discardChanges: () => {
    const state = get();
    set({
      serviceItems: JSON.parse(JSON.stringify(state.originalServiceItems)),
      groups: JSON.parse(JSON.stringify(state.originalGroups)),
      practitionerAssignments: JSON.parse(JSON.stringify(state.originalPractitionerAssignments)),
      billingScenarios: JSON.parse(JSON.stringify(state.originalBillingScenarios)),
      resourceRequirements: JSON.parse(JSON.stringify(state.originalResourceRequirements)),
    });
  },

  /**
   * Reset store (clear all data)
   */
  reset: () => {
    set({
      serviceItems: [],
      originalServiceItems: [],
      groups: [],
      originalGroups: [],
      practitionerAssignments: {},
      billingScenarios: {},
      resourceRequirements: {},
      originalPractitionerAssignments: {},
      originalBillingScenarios: {},
      originalResourceRequirements: {},
    });
  },

  /**
   * Sync originals with current state (call after successful save)
   * This marks all current changes as saved, so hasUnsavedChanges() will return false
   */
  syncOriginals: () => {
    const state = get();
    set({
      originalServiceItems: JSON.parse(JSON.stringify(state.serviceItems)),
      originalGroups: JSON.parse(JSON.stringify(state.groups)),
      originalPractitionerAssignments: JSON.parse(JSON.stringify(state.practitionerAssignments)),
      originalBillingScenarios: JSON.parse(JSON.stringify(state.billingScenarios)),
      originalResourceRequirements: JSON.parse(JSON.stringify(state.resourceRequirements)),
    });
  },
}));


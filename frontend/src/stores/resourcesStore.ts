import { create } from 'zustand';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { ResourceType, Resource } from '../types';

interface AssociatedServiceItem {
  id: number;
  name: string;
  required_quantity: number;
}

// Temporary IDs are generated using Date.now(), which produces large timestamps
// Real IDs from the backend are small integers, so we use this threshold to distinguish them
const TEMPORARY_ID_THRESHOLD = 1000000000000;

interface ResourcesState {
  // Data
  resourceTypes: ResourceType[];
  originalResourceTypes: ResourceType[];
  resourcesByType: Record<number, Resource[]>;
  originalResourcesByType: Record<number, Resource[]>;
  associatedServiceItems: Record<number, AssociatedServiceItem[]>;
  
  // Loading states
  loading: boolean;
  saving: boolean;
  loadingResources: Set<number>;
  
  // Error state
  error: string | null;
  
  // Actions
  loadData: () => Promise<void>;
  loadResources: (typeId: number) => Promise<void>;
  loadAssociatedServiceItems: (typeId: number) => Promise<void>;
  
  // Local Actions (for similar experience to service items)
  addResourceType: () => void;
  updateResourceTypeLocal: (typeId: number, name: string) => void;
  removeResourceTypeLocal: (typeId: number) => void;
  
  addResourceLocal: (typeId: number) => void;
  updateResourceLocal: (resourceId: number, name: string, description?: string) => void;
  removeResourceLocal: (typeId: number, resourceId: number) => void;
  
  // Global Save
  saveAll: () => Promise<boolean>;
  
  // Sync from RHF
  syncFromRHF: (data: { resourceTypes: any[] }) => void;
  
  // Reset/Clear
  reset: () => void;
  clear: () => void;
  
  // Change detection
  hasUnsavedChanges: () => boolean;
}

export const useResourcesStore = create<ResourcesState>((set, get) => ({
  // Initial state
  resourceTypes: [],
  originalResourceTypes: [],
  resourcesByType: {},
  originalResourcesByType: {},
  associatedServiceItems: {},
  loading: false,
  saving: false,
  loadingResources: new Set(),
  error: null,

  /**
   * Load all resource types and their resources.
   */
  loadData: async () => {
    try {
      set({ loading: true, error: null });
      const response = await apiService.getResourceTypes();
      const types = response.resource_types;
      
      // Load resources and service items for each type sequentially to avoid overloading
      const resourcesMap: Record<number, Resource[]> = {};
      const serviceItemsMap: Record<number, AssociatedServiceItem[]> = {};
      
      for (const type of types) {
        // Load resources
        try {
          const resourcesResponse = await apiService.getResources(type.id);
          resourcesMap[type.id] = resourcesResponse.resources;
        } catch (err) {
          logger.error(`Failed to load resources for type ${type.id}:`, err);
          resourcesMap[type.id] = [];
        }

        // Load associated service items
        try {
          const serviceItemsResponse = await apiService.getAppointmentTypesByResourceType(type.id);
          serviceItemsMap[type.id] = serviceItemsResponse.appointment_types;
        } catch (err) {
          logger.error(`Failed to load service items for type ${type.id}:`, err);
          serviceItemsMap[type.id] = [];
        }
      }
      
      set({ 
        resourceTypes: types,
        originalResourceTypes: JSON.parse(JSON.stringify(types)),
        resourcesByType: resourcesMap,
        originalResourcesByType: JSON.parse(JSON.stringify(resourcesMap)),
        associatedServiceItems: serviceItemsMap,
        loading: false 
      });
    } catch (err) {
      logger.error('Failed to load resource types:', err);
      set({ 
        loading: false, 
        error: err instanceof Error ? err.message : '載入資源類型失敗' 
      });
    }
  },

  /**
   * Load resources for a specific type.
   */
  loadResources: async (typeId: number) => {
    if (get().loadingResources.has(typeId)) return;

    try {
      set((state) => ({
        loadingResources: new Set(state.loadingResources).add(typeId),
      }));

      const response = await apiService.getResources(typeId);
      
      set((state) => ({
        resourcesByType: {
          ...state.resourcesByType,
          [typeId]: response.resources,
        },
        originalResourcesByType: {
          ...state.originalResourcesByType,
          [typeId]: JSON.parse(JSON.stringify(response.resources)),
        },
        loadingResources: (() => {
          const newSet = new Set(state.loadingResources);
          newSet.delete(typeId);
          return newSet;
        })(),
      }));
    } catch (err) {
      logger.error(`Failed to load resources for type ${typeId}:`, err);
      set((state) => {
        const newLoading = new Set(state.loadingResources);
        newLoading.delete(typeId);
        return { loadingResources: newLoading };
      });
    }
  },

  /**
   * Load service items associated with a resource type.
   */
  loadAssociatedServiceItems: async (typeId: number) => {
    try {
      const response = await apiService.getAppointmentTypesByResourceType(typeId);
      set((state) => ({
        associatedServiceItems: {
          ...state.associatedServiceItems,
          [typeId]: response.appointment_types,
        },
      }));
    } catch (err) {
      logger.error(`Failed to load associated service items for type ${typeId}:`, err);
      set((state) => ({
        associatedServiceItems: {
          ...state.associatedServiceItems,
          [typeId]: [],
        },
      }));
    }
  },

  /**
   * Local actions for Resource Types
   */
  addResourceType: () => {
    const newType: ResourceType = {
      id: Date.now(), // Temporary ID
      name: '',
      clinic_id: 0, // Will be set by backend
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    set((state) => ({
      resourceTypes: [...state.resourceTypes, newType],
      resourcesByType: { ...state.resourcesByType, [newType.id]: [] },
    }));
  },

  updateResourceTypeLocal: (typeId: number, name: string) => {
    set((state) => ({
      resourceTypes: state.resourceTypes.map(t => t.id === typeId ? { ...t, name } : t),
    }));
  },

  removeResourceTypeLocal: (typeId: number) => {
    set((state) => {
      const newResourcesByType = { ...state.resourcesByType };
      delete newResourcesByType[typeId];
      return {
        resourceTypes: state.resourceTypes.filter(t => t.id !== typeId),
        resourcesByType: newResourcesByType,
      };
    });
  },

  /**
   * Local actions for Resources
   */
  addResourceLocal: (typeId: number) => {
    const state = get();
    const type = state.resourceTypes.find(t => t.id === typeId);
    const typeName = type?.name || '資源';
    
    // Auto-generate name: {TypeName}{Number}
    const existingResources = state.resourcesByType[typeId] || [];
    
    // Find the highest number used in names starting with typeName
    let maxNum = 0;
    const escapedTypeName = typeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const namePattern = new RegExp(`^${escapedTypeName}(\\d+)$`);
    
    existingResources.forEach(r => {
      const match = r.name.match(namePattern);
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });
    
    const newName = `${typeName}${maxNum + 1}`;

    const newResource: Resource = {
      id: -Date.now() - Math.floor(Math.random() * 1000), // More unique temp ID
      resource_type_id: typeId,
      clinic_id: 0, // Will be set by backend
      name: newName,
      description: '',
      is_deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    set((state) => ({
      resourcesByType: {
        ...state.resourcesByType,
        [typeId]: [...(state.resourcesByType[typeId] || []), newResource],
      },
    }));
  },

  updateResourceLocal: (resourceId: number, name: string, description?: string) => {
    set((state) => {
      const newResourcesByType = { ...state.resourcesByType };
      for (const typeId in newResourcesByType) {
        const tid = parseInt(typeId);
        const resources = newResourcesByType[tid];
        if (resources) {
          newResourcesByType[tid] = resources.map(r => 
            r.id === resourceId ? { ...r, name, description: description || null } : r
          );
        }
      }
      return { resourcesByType: newResourcesByType };
    });
  },

  removeResourceLocal: (typeId: number, resourceId: number) => {
    set((state) => ({
      resourcesByType: {
        ...state.resourcesByType,
        [typeId]: (state.resourcesByType[typeId] || []).filter(r => r.id !== resourceId),
      },
    }));
  },

  /**
   * Global save: Syncs all local changes to the backend.
   */
  saveAll: async () => {
    const state = get();
    set({ saving: true, error: null });
    const errors: string[] = [];

    try {
      // 1. Handle Resource Types deletions
      const originalTypeIds = new Set(state.originalResourceTypes.map(t => t.id));
      const currentTypeIds = new Set(state.resourceTypes.map(t => t.id));
      
      for (const typeId of originalTypeIds) {
        if (!currentTypeIds.has(typeId)) {
          try {
            await apiService.deleteResourceType(typeId);
          } catch (err) {
            errors.push(`刪除資源類型失敗: ${err instanceof Error ? err.message : '未知錯誤'}`);
          }
        }
      }

      // 2. Handle Resource Type additions and updates
      const typeIdMapping: Record<number, number> = {}; // tempId -> realId

      for (const type of state.resourceTypes) {
        let realTypeId = type.id;
        if (type.id > TEMPORARY_ID_THRESHOLD) {
          // New resource type
          try {
            const created = await apiService.createResourceType({ name: type.name.trim() });
            realTypeId = created.id;
            typeIdMapping[type.id] = realTypeId;
          } catch (err) {
            errors.push(`建立資源類型「${type.name}」失敗: ${err instanceof Error ? err.message : '未知錯誤'}`);
            continue; // Skip resources for this failed type
          }
        } else {
          // Existing resource type - check for name change
          const original = state.originalResourceTypes.find(t => t.id === type.id);
          if (original && original.name !== type.name) {
            try {
              await apiService.updateResourceType(type.id, { name: type.name.trim() });
            } catch (err) {
              errors.push(`更新資源類型「${type.name}」失敗: ${err instanceof Error ? err.message : '未知錯誤'}`);
            }
          }
        }

        // 3. Handle Resource deletions for this type
        const originalResources = state.originalResourcesByType[type.id] || [];
        const currentResources = state.resourcesByType[type.id] || [];
        const currentResIds = new Set(currentResources.map(r => r.id));

        for (const res of originalResources) {
          if (!currentResIds.has(res.id)) {
            try {
              await apiService.deleteResource(res.id);
            } catch (err) {
              errors.push(`刪除資源「${res.name}」失敗: ${err instanceof Error ? err.message : '未知錯誤'}`);
            }
          }
        }

        // 4. Handle Resource additions and updates
        for (const res of currentResources) {
          if (res.id < 0) {
            // New resource (negative temp ID)
            try {
              const createData: { name?: string; description?: string } = {
                name: res.name.trim()
              };
              if (res.description) {
                createData.description = res.description.trim();
              }
              await apiService.createResource(realTypeId, createData);
            } catch (err) {
              errors.push(`建立資源「${res.name}」失敗: ${err instanceof Error ? err.message : '未知錯誤'}`);
            }
          } else {
            // Existing resource - check for changes
            const original = originalResources.find(or => or.id === res.id);
            if (original && (original.name !== res.name || original.description !== res.description)) {
              try {
                const updateData: { name: string; description?: string } = {
                  name: res.name.trim()
                };
                if (res.description) {
                  updateData.description = res.description.trim();
                }
                await apiService.updateResource(res.id, updateData);
              } catch (err) {
                errors.push(`更新資源「${res.name}」失敗: ${err instanceof Error ? err.message : '未知錯誤'}`);
              }
            }
          }
        }
      }

      if (errors.length > 0) {
        set({ error: errors.join('\n'), saving: false });
        return false;
      }

      // Successful save - reload data to get fresh state and real IDs
      await get().loadData();
      set({ saving: false });
      return true;
    } catch (err) {
      logger.error('Failed to save resources:', err);
      set({ 
        saving: false, 
        error: err instanceof Error ? err.message : '儲存資源設定失敗' 
      });
      return false;
    }
  },

  /**
   * Sync data from RHF state to the store.
   */
  syncFromRHF: (data: { resourceTypes: any[] }) => {
    const resourceTypes = data.resourceTypes.map(({ resources, ...type }) => type);
    const resourcesByType: Record<number, Resource[]> = {};
    data.resourceTypes.forEach(type => {
      resourcesByType[type.id] = type.resources;
    });

    set({
      resourceTypes,
      resourcesByType,
    });
  },

  /**
   * Reset to original data.
   */
  reset: () => {
    const state = get();
    set({
      resourceTypes: JSON.parse(JSON.stringify(state.originalResourceTypes)),
      resourcesByType: JSON.parse(JSON.stringify(state.originalResourcesByType)),
      error: null,
    });
  },

  /**
   * Clear all data (used when clinic changes).
   */
  clear: () => {
    set({
      resourceTypes: [],
      originalResourceTypes: [],
      resourcesByType: {},
      originalResourcesByType: {},
      associatedServiceItems: {},
      loading: false,
      saving: false,
      loadingResources: new Set(),
      error: null,
    });
  },

  /**
   * Check if there are unsaved changes.
   */
  hasUnsavedChanges: () => {
    const state = get();
    const typesChanged = JSON.stringify(state.resourceTypes) !== JSON.stringify(state.originalResourceTypes);
    const resourcesChanged = JSON.stringify(state.resourcesByType) !== JSON.stringify(state.originalResourcesByType);
    return typesChanged || resourcesChanged;
  },
}));


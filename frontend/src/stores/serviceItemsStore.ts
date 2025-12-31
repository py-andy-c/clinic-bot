/**
 * Service Items Store
 * 
 * Manages practitioner assignments and billing scenarios for service items (appointment types).
 * This store is independent from SettingsContext to prevent unintended state clearing.
 * 
 * Key features:
 * - Explicit loading (no reactive effects)
 * - Lazy loading of billing scenarios
 * - Temporary ID mapping support
 * - Change detection
 */

import { create } from 'zustand';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { AppointmentType, ResourceRequirement } from '../types';

// Temporary IDs are generated using Date.now(), which produces large timestamps
// Real IDs from the backend are small integers, so we use this threshold to distinguish them
const TEMPORARY_ID_THRESHOLD = 1000000000000;

export interface BillingScenario {
  id: number;
  practitioner_id: number;
  appointment_type_id: number;
  clinic_id: number;
  name: string;
  amount: number;
  revenue_share: number;
  is_default: boolean;
}

interface ServiceItemsState {
  // Practitioner assignments: service_item_id -> practitioner_ids[]
  practitionerAssignments: Record<number, number[]>;
  originalPractitionerAssignments: Record<number, number[]>;
  
  // Billing scenarios: key "service_item_id-practitioner_id" -> BillingScenario[]
  billingScenarios: Record<string, BillingScenario[]>;
  originalBillingScenarios: Record<string, BillingScenario[]>;
  
  // Resource requirements: service_item_id -> ResourceRequirement[]
  resourceRequirements: Record<number, ResourceRequirement[]>;
  originalResourceRequirements: Record<number, ResourceRequirement[]>;
  
  // Loading states
  loadingAssignments: boolean;
  loadingScenarios: Set<string>; // Set of keys being loaded
  loadingResourceRequirements: Set<number>; // Set of service item IDs being loaded
  
  // Error states
  error: string | null;
  
  // Actions
  loadPractitionerAssignments: (appointmentTypes: AppointmentType[]) => Promise<void>;
  updatePractitionerAssignments: (serviceItemId: number, practitionerIds: number[]) => void;
  
  loadBillingScenarios: (serviceItemId: number, practitionerId: number) => Promise<void>;
  updateBillingScenarios: (key: string, scenarios: BillingScenario[]) => void;
  
  loadResourceRequirements: (serviceItemId: number) => Promise<void>;
  updateResourceRequirements: (serviceItemId: number, requirements: ResourceRequirement[]) => void;
  
  // Save operations
  savePractitionerAssignments: (idMapping?: Record<number, number>) => Promise<{ success: boolean; errors: string[] }>;
  saveBillingScenarios: (idMapping?: Record<number, number>) => Promise<{ success: boolean; errors: string[] }>;
  saveResourceRequirements: (idMapping?: Record<number, number>) => Promise<{ success: boolean; errors: string[] }>;
  
  // ID mapping helpers
  applyIdMapping: (idMapping: Record<number, number>) => void;
  
  // Reset
  reset: () => void;
  
  // Clear all data (used when clinic changes)
  clear: () => void;
  
  // Change detection
  hasUnsavedChanges: () => boolean;
}

export const useServiceItemsStore = create<ServiceItemsState>((set, get) => ({
  // Initial state
  practitionerAssignments: {},
  originalPractitionerAssignments: {},
  billingScenarios: {},
  originalBillingScenarios: {},
  resourceRequirements: {},
  originalResourceRequirements: {},
  loadingAssignments: false,
  loadingScenarios: new Set(),
  loadingResourceRequirements: new Set(),
  error: null,

  /**
   * Load practitioner assignments for all appointment types.
   * This should be called explicitly when appointment types are loaded.
   */
  loadPractitionerAssignments: async (appointmentTypes: AppointmentType[]) => {
    if (appointmentTypes.length === 0) {
      set({
        practitionerAssignments: {},
        originalPractitionerAssignments: {},
      });
      return;
    }

    try {
      set({ loadingAssignments: true, error: null });

      // Load members (practitioners)
      const membersData = await apiService.getMembers();
      const practitioners = membersData.filter(m => m.roles.includes('practitioner'));

      if (practitioners.length === 0) {
        set({
          practitionerAssignments: {},
          originalPractitionerAssignments: {},
          loadingAssignments: false,
        });
        return;
      }

      // Load practitioner assignments
      const assignments: Record<number, number[]> = {};
      for (const practitioner of practitioners) {
        try {
          const data = await apiService.getPractitionerAppointmentTypes(practitioner.id);
          const appointmentTypes = data?.appointment_types;
          if (appointmentTypes && Array.isArray(appointmentTypes)) {
            for (const at of appointmentTypes) {
              if (at?.id) {
                const typeId = at.id;
                if (!assignments[typeId]) {
                  assignments[typeId] = [];
                }
                assignments[typeId].push(practitioner.id);
              }
            }
          }
        } catch (err) {
          logger.error(`Error loading assignments for practitioner ${practitioner.id}:`, err);
        }
      }

      set({
        practitionerAssignments: assignments,
        originalPractitionerAssignments: JSON.parse(JSON.stringify(assignments)), // Deep clone
        loadingAssignments: false,
      });
    } catch (err) {
      logger.error('Error loading practitioner assignments:', err);
      set({
        loadingAssignments: false,
        error: err instanceof Error ? err.message : '無法載入治療師指派',
      });
    }
  },

  /**
   * Update practitioner assignments for a service item.
   */
  updatePractitionerAssignments: (serviceItemId: number, practitionerIds: number[]) => {
    set((state) => ({
      practitionerAssignments: {
        ...state.practitionerAssignments,
        [serviceItemId]: practitionerIds,
      },
    }));
  },

  /**
   * Load billing scenarios for a specific service item-practitioner combination.
   * This is called lazily when a service item is expanded.
   */
  loadBillingScenarios: async (serviceItemId: number, practitionerId: number) => {
    const key = `${serviceItemId}-${practitionerId}`;
    
    // Skip if service item ID is temporary (not yet saved)
    if (serviceItemId > TEMPORARY_ID_THRESHOLD) {
      // Temporary IDs will be loaded after appointment type is saved
      return;
    }

    // Prevent duplicate loads
    const state = get();
    if (state.loadingScenarios.has(key) || state.billingScenarios[key]) {
      return;
    }

    try {
      set((state) => ({
        loadingScenarios: new Set(state.loadingScenarios).add(key),
        error: null,
      }));

      const response = await apiService.getBillingScenarios(serviceItemId, practitionerId);
      
      const scenarios: BillingScenario[] = (response.billing_scenarios || []).map((s: BillingScenario) => ({
        id: s.id,
        practitioner_id: s.practitioner_id,
        appointment_type_id: s.appointment_type_id,
        clinic_id: s.clinic_id,
        name: s.name,
        amount: typeof s.amount === 'string' ? parseFloat(s.amount) : s.amount,
        revenue_share: typeof s.revenue_share === 'string' ? parseFloat(s.revenue_share) : s.revenue_share,
        is_default: s.is_default,
      }));

      set((state) => {
        const newScenarios = { ...state.billingScenarios, [key]: scenarios };
        const newOriginalScenarios = { ...state.originalBillingScenarios, [key]: scenarios };
        const newLoadingScenarios = new Set(state.loadingScenarios);
        newLoadingScenarios.delete(key);

        return {
          billingScenarios: newScenarios,
          originalBillingScenarios: newOriginalScenarios,
          loadingScenarios: newLoadingScenarios,
        };
      });
    } catch (err: unknown) {
      logger.error(`Error loading billing scenarios for ${key}:`, err);
      
      // Handle 404 gracefully (no scenarios exist yet)
      if (err?.response?.status === 404) {
        set((state) => {
          const newScenarios = { ...state.billingScenarios, [key]: [] };
          const newOriginalScenarios = { ...state.originalBillingScenarios, [key]: [] };
          const newLoadingScenarios = new Set(state.loadingScenarios);
          newLoadingScenarios.delete(key);

          return {
            billingScenarios: newScenarios,
            originalBillingScenarios: newOriginalScenarios,
            loadingScenarios: newLoadingScenarios,
          };
        });
      } else {
        set((state) => {
          const newLoadingScenarios = new Set(state.loadingScenarios);
          newLoadingScenarios.delete(key);
          return {
            loadingScenarios: newLoadingScenarios,
            error: err instanceof Error ? err.message : '無法載入計費方案',
          };
        });
      }
    }
  },

  /**
   * Update billing scenarios for a specific key.
   */
  updateBillingScenarios: (key: string, scenarios: BillingScenario[]) => {
    set((state) => ({
      billingScenarios: {
        ...state.billingScenarios,
        [key]: scenarios,
      },
    }));
  },

  /**
   * Save practitioner assignments.
   * @param idMapping Optional mapping from temporary IDs to real IDs
   */
  savePractitionerAssignments: async (idMapping?: Record<number, number>) => {
    const state = get();
    const assignmentsToUse = idMapping && Object.keys(idMapping).length > 0
      ? applyIdMappingToAssignments(state.practitionerAssignments, idMapping)
      : state.practitionerAssignments;

    // Calculate changes
    const assignmentChanges: Record<number, number[]> = {};
    const allServiceItemIds = new Set([
      ...Object.keys(assignmentsToUse).map(Number),
      ...Object.keys(state.originalPractitionerAssignments).map(Number),
    ]);

    for (const serviceItemId of allServiceItemIds) {
      const current = assignmentsToUse[serviceItemId] || [];
      const original = state.originalPractitionerAssignments[serviceItemId] || [];
      if (JSON.stringify(current.sort()) !== JSON.stringify(original.sort())) {
        assignmentChanges[serviceItemId] = current;
      }
    }

    if (Object.keys(assignmentChanges).length === 0) {
      return { success: true, errors: [] };
    }

    const errors: string[] = [];
    
    try {
      // Get all practitioners
      const membersData = await apiService.getMembers();
      const practitioners = membersData.filter(m => m.roles.includes('practitioner'));

      // For each practitioner, determine their new appointment type IDs
      for (const practitioner of practitioners) {
        const newTypeIds: number[] = [];
        for (const [serviceItemId, practitionerIds] of Object.entries(assignmentsToUse)) {
          if (practitionerIds.includes(practitioner.id)) {
            newTypeIds.push(parseInt(serviceItemId));
          }
        }

        // Get original assignment for this practitioner
        const originalTypeIds: number[] = [];
        for (const [serviceItemId, practitionerIds] of Object.entries(state.originalPractitionerAssignments)) {
          if (practitionerIds.includes(practitioner.id)) {
            originalTypeIds.push(parseInt(serviceItemId));
          }
        }

        // Only update if changed
        if (JSON.stringify(newTypeIds.sort()) !== JSON.stringify(originalTypeIds.sort())) {
          try {
            await apiService.updatePractitionerAppointmentTypes(practitioner.id, newTypeIds);
          } catch (err) {
            const errorMsg = `更新治療師「${practitioner.full_name}」的服務項目指派失敗：${err instanceof Error ? err.message : '未知錯誤'}`;
            logger.error(`Error updating practitioner assignments for ${practitioner.id}:`, err);
            errors.push(errorMsg);
          }
        }
      }

      // Update state with mapped IDs if mapping was applied
      if (idMapping && Object.keys(idMapping).length > 0) {
        set({
          practitionerAssignments: assignmentsToUse,
        });
      }

      // Update original data after successful save
      set({
        originalPractitionerAssignments: JSON.parse(JSON.stringify(assignmentsToUse)),
      });

      return {
        success: errors.length === 0,
        errors,
      };
    } catch (err) {
      const errorMsg = `儲存治療師指派失敗：${err instanceof Error ? err.message : '未知錯誤'}`;
      logger.error('Error saving practitioner assignments:', err);
      return {
        success: false,
        errors: [errorMsg],
      };
    }
  },

  /**
   * Save billing scenarios.
   * @param idMapping Optional mapping from temporary IDs to real IDs
   */
  saveBillingScenarios: async (idMapping?: Record<number, number>) => {
    const state = get();
    const scenariosToUse = idMapping && Object.keys(idMapping).length > 0
      ? applyIdMappingToScenarios(state.billingScenarios, idMapping)
      : state.billingScenarios;

    // Calculate changes
    const scenarioChanges: Record<string, BillingScenario[]> = {};
    const allKeys = new Set([
      ...Object.keys(scenariosToUse),
      ...Object.keys(state.originalBillingScenarios),
    ]);

    for (const key of allKeys) {
      const current = scenariosToUse[key] || [];
      const original = state.originalBillingScenarios[key] || [];
      if (JSON.stringify(current) !== JSON.stringify(original)) {
        scenarioChanges[key] = current;
      }
    }

    if (Object.keys(scenarioChanges).length === 0) {
      return { success: true, errors: [] };
    }

    const errors: string[] = [];
    const createdScenarios: Array<{ key: string; tempId: number; realId: number }> = [];

    for (const [key, scenarios] of Object.entries(scenarioChanges)) {
      const parts = key.split('-');
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        logger.error(`Invalid billing scenario key format: ${key}`);
        continue;
      }
      const serviceItemId = parseInt(parts[0], 10);
      const practitionerId = parseInt(parts[1], 10);

      // If we have a mapping, use the real ID instead of temporary ID
      const realServiceItemId = idMapping?.[serviceItemId] || serviceItemId;

      if (isNaN(serviceItemId) || isNaN(practitionerId)) {
        logger.error(`Invalid billing scenario key values: ${key}`);
        continue;
      }

      const originalKey = key;
      const originalScenarios = state.originalBillingScenarios[originalKey] || [];

      // Determine what needs to be created, updated, or deleted
      const originalIds = new Set(originalScenarios.map(s => s.id));
      const currentIds = new Set(scenarios.map(s => s.id));

      // Delete scenarios that are explicitly removed from current state
      // IMPORTANT: Billing scenarios are independent of PAT assignment - they should persist even when PAT is unchecked
      // Only delete if the key exists in scenariosToUse (scenarios were loaded/managed)
      // If key doesn't exist, scenarios weren't loaded (e.g., PAT unchecked) - don't delete them
      if (key in scenariosToUse) {
        // Key exists in current state - scenarios were explicitly managed
        // Delete scenarios that are no longer present (explicitly removed by user)
        for (const originalScenario of originalScenarios) {
          if (!currentIds.has(originalScenario.id)) {
            try {
              await apiService.deleteBillingScenario(realServiceItemId, practitionerId, originalScenario.id);
            } catch (err: unknown) {
              // Handle 404 gracefully - scenario might already be deleted
              if (err?.response?.status === 404) {
                // Don't add to errors - it's already deleted, which is what we want
              } else {
                const errorMsg = `刪除計費方案「${originalScenario.name}」失敗：${err instanceof Error ? err.message : '未知錯誤'}`;
                logger.error(`Error deleting billing scenario ${originalScenario.id}:`, err);
                errors.push(errorMsg);
              }
            }
          }
        }
      }
      // If key doesn't exist in current state, scenarios weren't loaded/managed
      // This typically happens when PAT is unchecked. Don't delete - scenarios should persist independently.

      // Create or update scenarios
      for (const scenario of scenarios) {
        const isTemporaryId = scenario.id < 0;

        if (!isTemporaryId && originalIds.has(scenario.id)) {
          // Update existing (real ID from backend)
          try {
            const normalizedAmount = typeof scenario.amount === 'string' ? parseFloat(scenario.amount) : scenario.amount;
            const normalizedRevenueShare = typeof scenario.revenue_share === 'string' ? parseFloat(scenario.revenue_share) : scenario.revenue_share;
            await apiService.updateBillingScenario(realServiceItemId, practitionerId, scenario.id, {
              name: scenario.name,
              amount: normalizedAmount,
              revenue_share: normalizedRevenueShare,
              is_default: scenario.is_default,
            });
          } catch (err) {
            const errorMsg = `更新計費方案「${scenario.name}」失敗：${err instanceof Error ? err.message : '未知錯誤'}`;
            logger.error(`Error updating billing scenario ${scenario.id}:`, err);
            errors.push(errorMsg);
          }
        } else {
          // Create new (either temporary ID or not in original)
          try {
            const normalizedAmount = typeof scenario.amount === 'string' ? parseFloat(scenario.amount) : scenario.amount;
            const normalizedRevenueShare = typeof scenario.revenue_share === 'string' ? parseFloat(scenario.revenue_share) : scenario.revenue_share;
            const response = await apiService.createBillingScenario(realServiceItemId, practitionerId, {
              name: scenario.name,
              amount: normalizedAmount,
              revenue_share: normalizedRevenueShare,
              is_default: scenario.is_default,
            });
            // Track created scenarios to update state after all operations
            createdScenarios.push({
              key,
              tempId: scenario.id,
              realId: response.id,
            });
          } catch (err) {
            const errorMsg = `建立計費方案「${scenario.name}」失敗：${err instanceof Error ? err.message : '未知錯誤'}`;
            logger.error(`Error creating billing scenario:`, err);
            errors.push(errorMsg);
          }
        }
      }
    }

    // Update billing scenarios with real IDs from backend (only if no errors)
    let finalBillingScenarios = scenariosToUse;
    if (createdScenarios.length > 0) {
      finalBillingScenarios = { ...scenariosToUse };
      for (const { key, tempId, realId } of createdScenarios) {
        const currentScenarios = finalBillingScenarios[key] || [];
        finalBillingScenarios[key] = currentScenarios.map(s =>
          s.id === tempId
            ? { ...s, id: realId }
            : s
        );
      }
    }

    // Update state with mapped IDs if mapping was applied
    if (idMapping && Object.keys(idMapping).length > 0) {
      set({
        billingScenarios: finalBillingScenarios,
      });
    } else if (createdScenarios.length > 0) {
      set({
        billingScenarios: finalBillingScenarios,
      });
    }

    // Update original data after successful save
    set({
      originalBillingScenarios: JSON.parse(JSON.stringify(finalBillingScenarios)),
    });

    return {
      success: errors.length === 0,
      errors,
    };
  },

  /**
   * Apply ID mapping to update temporary IDs to real IDs in state.
   */
  applyIdMapping: (idMapping: Record<number, number>) => {
    const state = get();
    
    // Update practitioner assignments
    const updatedAssignments = applyIdMappingToAssignments(state.practitionerAssignments, idMapping);
    
    // Update billing scenarios
    const updatedScenarios = applyIdMappingToScenarios(state.billingScenarios, idMapping);
    
    // Update resource requirements
    const updatedRequirements = applyIdMappingToResourceRequirements(state.resourceRequirements, idMapping);
    
    set({
      practitionerAssignments: updatedAssignments,
      billingScenarios: updatedScenarios,
      resourceRequirements: updatedRequirements,
    });
  },

  /**
   * Reset to original data.
   */
  reset: () => {
    const state = get();
    set({
      practitionerAssignments: JSON.parse(JSON.stringify(state.originalPractitionerAssignments)),
      billingScenarios: JSON.parse(JSON.stringify(state.originalBillingScenarios)),
      resourceRequirements: JSON.parse(JSON.stringify(state.originalResourceRequirements)),
      error: null,
    });
  },

  /**
   * Load resource requirements for a service item.
   */
  loadResourceRequirements: async (serviceItemId: number) => {
    // Skip if already loading or loaded
    const state = get();
    if (state.loadingResourceRequirements.has(serviceItemId) || state.resourceRequirements[serviceItemId]) {
      return;
    }

    try {
      set((state) => {
        const newLoading = new Set(state.loadingResourceRequirements);
        newLoading.add(serviceItemId);
        return { loadingResourceRequirements: newLoading };
      });

      const response = await apiService.getResourceRequirements(serviceItemId);
      
      set((state) => {
        const newRequirements = { ...state.resourceRequirements, [serviceItemId]: response.requirements };
        const newOriginalRequirements = { ...state.originalResourceRequirements, [serviceItemId]: JSON.parse(JSON.stringify(response.requirements)) };
        const newLoading = new Set(state.loadingResourceRequirements);
        newLoading.delete(serviceItemId);

        return {
          resourceRequirements: newRequirements,
          originalResourceRequirements: newOriginalRequirements,
          loadingResourceRequirements: newLoading,
        };
      });
    } catch (err: unknown) {
      logger.error(`Error loading resource requirements for ${serviceItemId}:`, err);
      
      // Handle 404 gracefully (no requirements exist yet)
      if (err?.response?.status === 404) {
        set((state) => {
          const newRequirements = { ...state.resourceRequirements, [serviceItemId]: [] };
          const newOriginalRequirements = { ...state.originalResourceRequirements, [serviceItemId]: [] };
          const newLoading = new Set(state.loadingResourceRequirements);
          newLoading.delete(serviceItemId);

          return {
            resourceRequirements: newRequirements,
            originalResourceRequirements: newOriginalRequirements,
            loadingResourceRequirements: newLoading,
          };
        });
      } else {
        set((state) => {
          const newLoading = new Set(state.loadingResourceRequirements);
          newLoading.delete(serviceItemId);
          return {
            loadingResourceRequirements: newLoading,
            error: err instanceof Error ? err.message : '無法載入資源需求',
          };
        });
      }
    }
  },

  /**
   * Update resource requirements for a specific service item.
   */
  updateResourceRequirements: (serviceItemId: number, requirements: ResourceRequirement[]) => {
    set((state) => ({
      resourceRequirements: {
        ...state.resourceRequirements,
        [serviceItemId]: requirements,
      },
    }));
  },

  /**
   * Save resource requirements.
   * @param idMapping Optional mapping from temporary IDs to real IDs
   */
  saveResourceRequirements: async (idMapping?: Record<number, number>) => {
    const state = get();
    const requirementsToUse = idMapping && Object.keys(idMapping).length > 0
      ? applyIdMappingToResourceRequirements(state.resourceRequirements, idMapping)
      : state.resourceRequirements;

    // Calculate changes
    const requirementChanges: Record<number, ResourceRequirement[]> = {};
    const allServiceItemIds = new Set([
      ...Object.keys(requirementsToUse).map(Number),
      ...Object.keys(state.originalResourceRequirements).map(Number),
    ]);

    for (const serviceItemId of allServiceItemIds) {
      const current = requirementsToUse[serviceItemId] || [];
      const original = state.originalResourceRequirements[serviceItemId] || [];
      if (JSON.stringify(current.sort((a, b) => a.id - b.id)) !== JSON.stringify(original.sort((a, b) => a.id - b.id))) {
        requirementChanges[serviceItemId] = current;
      }
    }

    if (Object.keys(requirementChanges).length === 0) {
      return { success: true, errors: [] };
    }

    const errors: string[] = [];

    // For each service item with changes, sync requirements
    for (const [serviceItemIdStr, requirements] of Object.entries(requirementChanges)) {
      const serviceItemId = parseInt(serviceItemIdStr, 10);
      const realServiceItemId = idMapping?.[serviceItemId] || serviceItemId;
      const originalRequirements = state.originalResourceRequirements[serviceItemId] || [];

      // Determine what needs to be created, updated, or deleted
      const originalIds = new Set(originalRequirements.map(r => r.id));
      const currentIds = new Set(requirements.map(r => r.id));

      // Delete requirements that are no longer present
      for (const originalReq of originalRequirements) {
        if (!currentIds.has(originalReq.id)) {
          try {
            await apiService.deleteResourceRequirement(realServiceItemId, originalReq.id);
          } catch (err: unknown) {
            // Handle 404 gracefully - requirement might already be deleted
            const axiosError = err as { response?: { status?: number } };
            if (axiosError?.response?.status === 404) {
              // Don't add to errors - it's already deleted, which is what we want
            } else {
              const errorMsg = `刪除資源需求失敗：${err instanceof Error ? err.message : '未知錯誤'}`;
              logger.error(`Error deleting resource requirement ${originalReq.id}:`, err);
              errors.push(errorMsg);
            }
          }
        }
      }

      // Create or update requirements
      for (const requirement of requirements) {
        if (originalIds.has(requirement.id)) {
          // Update existing
          try {
            await apiService.updateResourceRequirement(realServiceItemId, requirement.id, {
              quantity: requirement.quantity,
            });
          } catch (err) {
            const errorMsg = `更新資源需求失敗：${err instanceof Error ? err.message : '未知錯誤'}`;
            logger.error(`Error updating resource requirement ${requirement.id}:`, err);
            errors.push(errorMsg);
          }
        } else {
          // Create new (temporary ID or not in original)
          try {
            await apiService.createResourceRequirement(realServiceItemId, {
              resource_type_id: requirement.resource_type_id,
              quantity: requirement.quantity,
            });
          } catch (err) {
            const errorMsg = `建立資源需求失敗：${err instanceof Error ? err.message : '未知錯誤'}`;
            logger.error(`Error creating resource requirement:`, err);
            errors.push(errorMsg);
          }
        }
      }
    }

    // Reload requirements to get real IDs from backend
    for (const serviceItemIdStr of Object.keys(requirementChanges)) {
      const serviceItemId = parseInt(serviceItemIdStr, 10);
      const realServiceItemId = idMapping?.[serviceItemId] || serviceItemId;
      try {
        const response = await apiService.getResourceRequirements(realServiceItemId);
        set((state) => ({
          resourceRequirements: {
            ...state.resourceRequirements,
            [realServiceItemId]: response.requirements,
          },
          originalResourceRequirements: {
            ...state.originalResourceRequirements,
            [realServiceItemId]: JSON.parse(JSON.stringify(response.requirements)),
          },
        }));
      } catch (err) {
        logger.error(`Error reloading resource requirements for ${realServiceItemId}:`, err);
      }
    }

    return {
      success: errors.length === 0,
      errors,
    };
  },

  /**
   * Clear all data (used when clinic changes).
   */
  clear: () => {
    set({
      practitionerAssignments: {},
      originalPractitionerAssignments: {},
      billingScenarios: {},
      originalBillingScenarios: {},
      resourceRequirements: {},
      originalResourceRequirements: {},
      loadingAssignments: false,
      loadingScenarios: new Set(),
      loadingResourceRequirements: new Set(),
      error: null,
    });
  },

  /**
   * Check if there are unsaved changes.
   */
  hasUnsavedChanges: () => {
    const state = get();
    const assignmentsChanged = JSON.stringify(state.practitionerAssignments) !== JSON.stringify(state.originalPractitionerAssignments);
    const scenariosChanged = JSON.stringify(state.billingScenarios) !== JSON.stringify(state.originalBillingScenarios);
    const requirementsChanged = JSON.stringify(state.resourceRequirements) !== JSON.stringify(state.originalResourceRequirements);
    return assignmentsChanged || scenariosChanged || requirementsChanged;
  },
}));

/**
 * Helper: Apply ID mapping to practitioner assignments.
 */
function applyIdMappingToAssignments(
  assignments: Record<number, number[]>,
  mapping: Record<number, number>
): Record<number, number[]> {
  const updated: Record<number, number[]> = {};
  for (const [tempId, practitionerIds] of Object.entries(assignments)) {
    const tempIdNum = parseInt(tempId, 10);
    const realId = mapping[tempIdNum];
    if (realId) {
      updated[realId] = practitionerIds;
    } else {
      updated[tempIdNum] = practitionerIds;
    }
  }
  return updated;
}

/**
 * Helper: Apply ID mapping to billing scenarios keys.
 */
function applyIdMappingToScenarios(
  scenarios: Record<string, BillingScenario[]>,
  mapping: Record<number, number>
): Record<string, BillingScenario[]> {
  const updated: Record<string, BillingScenario[]> = {};
  for (const [key, scenarioList] of Object.entries(scenarios)) {
    const parts = key.split('-');
    if (parts.length === 2 && parts[0] && parts[1]) {
      const tempServiceItemId = parseInt(parts[0], 10);
      const practitionerId = parseInt(parts[1], 10);
      const realServiceItemId = mapping[tempServiceItemId];

      if (realServiceItemId) {
        const newKey = `${realServiceItemId}-${practitionerId}`;
        updated[newKey] = scenarioList;
      } else {
        updated[key] = scenarioList;
      }
    } else {
      updated[key] = scenarioList;
    }
  }
  return updated;
}

/**
 * Helper: Apply ID mapping to resource requirements.
 */
function applyIdMappingToResourceRequirements(
  requirements: Record<number, ResourceRequirement[]>,
  mapping: Record<number, number>
): Record<number, ResourceRequirement[]> {
  const updated: Record<number, ResourceRequirement[]> = {};
  for (const [tempId, reqList] of Object.entries(requirements)) {
    const tempIdNum = parseInt(tempId, 10);
    const realId = mapping[tempIdNum];
    if (realId) {
      updated[realId] = reqList;
    } else {
      updated[tempIdNum] = reqList;
    }
  }
  return updated;
}


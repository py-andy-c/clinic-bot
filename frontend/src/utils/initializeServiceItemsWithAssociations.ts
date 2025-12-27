/**
 * Helper function to safely initialize service items with all associations.
 * 
 * This function ensures that all associations (practitioner assignments, billing scenarios,
 * and resource requirements) are loaded before initializing the staging store, preventing
 * timing gaps where the UI renders with empty data.
 * 
 * This pattern must be used in:
 * - Initial page load
 * - After save (to reload with real IDs)
 * - After discard (to restore original state)
 * 
 * @param serviceItems - Service items to initialize
 * @param groups - Groups to initialize
 * @param options - Optional configuration
 * @param options.loadResourceRequirements - Whether to load resource requirements (default: true)
 * @param options.loadBillingScenarios - Whether to load billing scenarios (default: true)
 * @param options.loadPractitionerAssignments - Whether to load practitioner assignments (default: true)
 * 
 * @example
 * // Initial page load
 * await initializeServiceItemsWithAssociations(serviceItems, groups);
 * 
 * @example
 * // After save (with real IDs from store)
 * const { billingScenarios, resourceRequirements } = useServiceItemsStore.getState();
 * await initializeServiceItemsWithAssociations(serviceItems, groups, {
 *   // Use saved data from store (has real IDs)
 *   useSavedAssociations: { billingScenarios, resourceRequirements }
 * });
 */
import { AppointmentType, ServiceTypeGroup } from '../types';
import { BillingScenario, useServiceItemsStore } from '../stores/serviceItemsStore';
import { useServiceItemsStagingStore, ServiceItemAssociations } from '../stores/serviceItemsStagingStore';
import { ResourceRequirement } from '../types';
import { logger } from './logger';
import { isTemporaryServiceItemId } from './idUtils';

interface InitializeOptions {
  /**
   * Whether to load resource requirements.
   * Set to false if you want to skip loading (e.g., for performance).
   * Default: true
   */
  loadResourceRequirements?: boolean;
  
  /**
   * Whether to load billing scenarios.
   * Set to false if you want to skip loading (e.g., for performance).
   * Default: true
   */
  loadBillingScenarios?: boolean;
  
  /**
   * Whether to load practitioner assignments.
   * Set to false if you want to skip loading (e.g., for performance).
   * Default: true
   */
  loadPractitionerAssignments?: boolean;
  
  /**
   * Use saved associations from store instead of loading from API.
   * Useful after save when store has real IDs.
   */
  useSavedAssociations?: {
    billingScenarios?: Record<string, BillingScenario[]>;
    resourceRequirements?: Record<number, ResourceRequirement[]>;
  };
}

export async function initializeServiceItemsWithAssociations(
  serviceItems: AppointmentType[],
  groups: ServiceTypeGroup[],
  options: InitializeOptions = {}
): Promise<void> {
  const {
    loadResourceRequirements: shouldLoadResourceRequirements = true,
    loadBillingScenarios: shouldLoadBillingScenarios = true,
    loadPractitionerAssignments: shouldLoadPractitionerAssignments = true,
    useSavedAssociations,
  } = options;

  const associations: ServiceItemAssociations = {};

  // Load associations if service items exist
  if (serviceItems.length > 0) {
    const {
      loadPractitionerAssignments,
      loadBillingScenarios,
      loadResourceRequirements,
    } = useServiceItemsStore.getState();

    // Load practitioner assignments
    if (shouldLoadPractitionerAssignments) {
      try {
        await loadPractitionerAssignments(serviceItems);
        const { practitionerAssignments } = useServiceItemsStore.getState();
        associations.practitionerAssignments = practitionerAssignments;
      } catch (err) {
        logger.warn('Failed to load practitioner assignments, continuing without them', err);
        // Continue - billing scenarios can still be loaded if we have cached assignments
      }
    }

    // Load billing scenarios for all practitioner-service combinations
    if (shouldLoadBillingScenarios) {
      if (useSavedAssociations?.billingScenarios) {
        // Use saved associations from store (has real IDs)
        associations.billingScenarios = useSavedAssociations.billingScenarios;
      } else {
        try {
          // Try to get practitioner assignments (from loaded or cached)
          const practitionerAssignments = associations.practitionerAssignments || 
            useServiceItemsStore.getState().practitionerAssignments;
          
          if (Object.keys(practitionerAssignments).length > 0) {
            const billingScenariosPromises: Promise<void>[] = [];
            const failedLoads: Array<{ serviceItemId: number; practitionerId: number }> = [];
            
            for (const appointmentType of serviceItems) {
              const practitionerIds = practitionerAssignments[appointmentType.id];
              if (practitionerIds && practitionerIds.length > 0) {
                for (const practitionerId of practitionerIds) {
                  billingScenariosPromises.push(
                    loadBillingScenarios(appointmentType.id, practitionerId).catch((err) => {
                      failedLoads.push({ serviceItemId: appointmentType.id, practitionerId });
                      logger.warn(
                        `Failed to load billing scenarios for service ${appointmentType.id}, practitioner ${practitionerId}`,
                        err
                      );
                      // Don't throw - allow other scenarios to load
                    })
                  );
                }
              }
            }
            await Promise.all(billingScenariosPromises);
            const { billingScenarios } = useServiceItemsStore.getState();
            associations.billingScenarios = billingScenarios;
            
            if (failedLoads.length > 0) {
              logger.warn(
                `Failed to load billing scenarios for ${failedLoads.length} practitioner-service combinations, continuing with available data`
              );
            }
          } else {
            logger.warn('No practitioner assignments available, skipping billing scenarios load');
          }
        } catch (err) {
          logger.warn('Failed to load billing scenarios, continuing without them', err);
          // Continue - other associations can still be loaded
        }
      }
    }

    // Load resource requirements
    if (shouldLoadResourceRequirements) {
      if (useSavedAssociations?.resourceRequirements) {
        // Use saved associations from store (has real IDs)
        associations.resourceRequirements = useSavedAssociations.resourceRequirements;
      } else {
        try {
          // Load from API
          const resourceRequirementsPromises: Promise<void>[] = [];
          for (const appointmentType of serviceItems) {
            // Skip temporary IDs (will be loaded after save)
            if (!isTemporaryServiceItemId(appointmentType.id)) {
              resourceRequirementsPromises.push(
                loadResourceRequirements(appointmentType.id)
              );
            }
          }
          await Promise.all(resourceRequirementsPromises);
          const { resourceRequirements } = useServiceItemsStore.getState();
          associations.resourceRequirements = resourceRequirements;
        } catch (err) {
          logger.warn('Failed to load resource requirements, continuing without them', err);
          // Continue - other associations are still available
        }
      }
    }
  }

  // Initialize staging store atomically with all associations
  const { initialize } = useServiceItemsStagingStore.getState();
  initialize(serviceItems, groups, associations);
}


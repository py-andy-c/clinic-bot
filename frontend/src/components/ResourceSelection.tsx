import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ResourceAvailabilityResponse, Resource, ResourceType } from '../types';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../types/api';
import {
  getResourceCacheKey,
  getCachedResourceAvailability,
  setCachedResourceAvailability,
} from '../utils/resourceAvailabilityCache';
import moment from 'moment-timezone';

interface ResourceSelectionProps {
  appointmentTypeId: number | null;
  practitionerId: number | null;
  date: string | null;
  startTime: string;
  durationMinutes: number;
  excludeCalendarEventId?: number;
  selectedResourceIds: number[];
  onSelectionChange: (resourceIds: number[]) => void;
  onResourcesFound?: (resources: Resource[]) => void;
  skipInitialDebounce?: boolean;
  initialResources?: Array<{ id: number; resource_type_id: number; resource_type_name?: string; name: string }>; // Resources loaded from appointment (for edit mode)
  initialAvailability?: ResourceAvailabilityResponse | null; // Pre-fetched availability (for edit mode)
}

export const ResourceSelection: React.FC<ResourceSelectionProps> = ({
  appointmentTypeId,
  practitionerId,
  date,
  startTime,
  durationMinutes,
  excludeCalendarEventId,
  selectedResourceIds,
  onSelectionChange,
  onResourcesFound,
  skipInitialDebounce = false,
  initialResources = [],
  initialAvailability: initialAvailabilityProp = null,
}) => {
  const [loading, setLoading] = useState(false);
  // Initialize availability from initialAvailabilityProp if provided (for immediate use in useMemo)
  const [availability, setAvailability] = useState<ResourceAvailabilityResponse | null>(initialAvailabilityProp || null);
  const [error, setError] = useState<string | null>(null);
  const lastAutoSelectedSlotRef = useRef<string>('');
  const lastSelectedRef = useRef<number[]>([]);
  const isUpdatingSelectionRef = useRef(false);
  const isInitialMountRef = useRef(true);
  
  // Collapsible state
  const [isExpanded, setIsExpanded] = useState(false);
  // Use refs to preserve state across remounts (when time/date clears)
  const expandedSectionsRef = useRef<Set<number>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const additionalResourceTypesRef = useRef<number[]>([]);
  // Manually added types (user clicks "Add Resource Type") - persisted in state
  const [manuallyAddedResourceTypes, setManuallyAddedResourceTypes] = useState<number[]>(() => additionalResourceTypesRef.current);
  const additionalResourcesRef = useRef<Record<number, Resource[]>>({});
  const [additionalResources, setAdditionalResources] = useState<Record<number, Resource[]>>({});
  // Track newly added resource types for auto-selection
  const newlyAddedResourceTypesRef = useRef<Set<number>>(new Set());
  
  // Sync refs with state to preserve across remounts (when time/date clears)
  useEffect(() => {
    additionalResourceTypesRef.current = manuallyAddedResourceTypes;
    expandedSectionsRef.current = expandedSections;
    additionalResourcesRef.current = additionalResources;
  }, [manuallyAddedResourceTypes, expandedSections, additionalResources]);
  
  // Restore manually added resource types from refs on mount (to preserve across remounts)
  // Do NOT restore expandedSections - they should be determined fresh based on current conditions
  useEffect(() => {
    const hasRefData = additionalResourceTypesRef.current.length > 0 || 
                       Object.keys(additionalResourcesRef.current).length > 0;
    const hasStateData = manuallyAddedResourceTypes.length > 0 || 
                         Object.keys(additionalResources).length > 0;
    
    if (hasRefData && !hasStateData) {
      setManuallyAddedResourceTypes(additionalResourceTypesRef.current);
      setAdditionalResources(additionalResourcesRef.current);
      if (additionalResourceTypesRef.current.length > 0) {
        setIsExpanded(true);
      }
    }
  }, [additionalResources, manuallyAddedResourceTypes.length]); // Only run on mount
  
  const [loadingResourceTypes, setLoadingResourceTypes] = useState(false);
  const [allResourceTypes, setAllResourceTypes] = useState<ResourceType[]>([]);
  const [showAddResourceTypeMenu, setShowAddResourceTypeMenu] = useState(false);

  // Create a map of resource_type_id -> resource_type_name from initialResources
  // This allows us to get resource type names immediately without fetching allResourceTypes
  const resourceTypeNamesFromInitial = useMemo(() => {
    const map = new Map<number, string>();
    initialResources.forEach(resource => {
      if (resource.resource_type_name) {
        map.set(resource.resource_type_id, resource.resource_type_name);
      }
    });
    return map;
  }, [initialResources]);

  // Single source of truth for availability (prioritize pre-fetched prop)
  const currentAvailability = useMemo(() => initialAvailabilityProp || availability, [initialAvailabilityProp, availability]);

  // Compute additional resource types from initialResources synchronously (during render)
  const additionalResourceTypesFromInitial = useMemo(() => {
    if (!currentAvailability || initialResources.length === 0) {
      return [];
    }

    const requiredResourceTypeIds = new Set(
      currentAvailability.requirements.map(req => req.resource_type_id)
    );

    const additionalResourceTypeIds = new Set<number>();
    initialResources.forEach(resource => {
      if (!requiredResourceTypeIds.has(resource.resource_type_id)) {
        additionalResourceTypeIds.add(resource.resource_type_id);
      }
    });

    return Array.from(additionalResourceTypeIds);
  }, [currentAvailability, initialResources]);

  // Merge additional types from initialResources with manually added types
  // This is computed synchronously during render, so both appear immediately
  const additionalResourceTypes = useMemo(() => {
    const merged = [...additionalResourceTypesFromInitial, ...manuallyAddedResourceTypes];
    return Array.from(new Set(merged)); // Remove duplicates
  }, [additionalResourceTypesFromInitial, manuallyAddedResourceTypes]);

  // Notify parent about all resources found
  useEffect(() => {
    if (!onResourcesFound) return;

    const resourcesList: Resource[] = [];

    // Include resources from availability (required resource types)
    if (currentAvailability) {
      const availabilityResources = currentAvailability.requirements.flatMap(req => 
        req.available_resources.map(r => ({
          id: r.id,
          name: r.name,
          resource_type_id: req.resource_type_id,
          clinic_id: 0,
          is_deleted: false,
          created_at: '',
          updated_at: '',
        }))
      );
      resourcesList.push(...availabilityResources);
    }

    // Include initial resources (for edit mode - eliminates flickering)
    const initialResourcesList = initialResources.map(r => ({
      id: r.id,
      name: r.name,
      resource_type_id: r.resource_type_id,
      clinic_id: 0,
      is_deleted: false,
      created_at: '',
      updated_at: '',
    }));
    resourcesList.push(...initialResourcesList);

    // Include additional resources (from manually added resource types)
    const additionalResourcesList = Object.values(additionalResources).flat();
    resourcesList.push(...additionalResourcesList);

    // Remove duplicates
    const uniqueResources = Array.from(
      new Map(resourcesList.map(r => [r.id, r])).values()
    );

    if (uniqueResources.length > 0) {
      onResourcesFound(uniqueResources);
    }
  }, [currentAvailability, onResourcesFound, initialResources, additionalResources]);

  // Helper function to get available resources for a resource type
  const getAvailableResourcesForType = (resourceTypeId: number, avail: ResourceAvailabilityResponse): number[] => {
    const req = avail.requirements.find(r => r.resource_type_id === resourceTypeId);
    if (!req) return [];
    return req.available_resources.filter(r => r.is_available).map(r => r.id);
  };

  // Extract auto-selection logic to a helper function
  const handleAutoSelection = useCallback((response: ResourceAvailabilityResponse) => {
    // Use the ref to get the selection at the time the effect was triggered
    const currentSelection = lastSelectedRef.current.length > 0 ? lastSelectedRef.current : selectedResourceIds;
    
    if (currentSelection.length > 0) {
      // Keep all originally selected resources (even if unavailable)
      // Group selected resources by type (both available and unavailable)
      const selectedByType: Record<number, number[]> = {};
      currentSelection.forEach(id => {
        for (const req of response.requirements) {
          const resource = req.available_resources.find(r => r.id === id);
          if (resource) {
            if (!selectedByType[req.resource_type_id]) {
              selectedByType[req.resource_type_id] = [];
            }
            const typeArray = selectedByType[req.resource_type_id];
            if (typeArray) {
              typeArray.push(id);
            }
          }
        }
      });
      
      // Build new selection: keep all original selections, only add if needed to meet requirements
      const newSelection: number[] = [...currentSelection];
      
      // For each resource type, check if we need to add more resources to meet requirements
      response.requirements.forEach(req => {
        const currentCount = selectedByType[req.resource_type_id]?.length || 0;
        const needed = req.required_quantity - currentCount;
        
        if (needed > 0) {
          // Get available resources for this type that aren't already selected
          const availableForType = getAvailableResourcesForType(req.resource_type_id, response);
          const notSelected = availableForType.filter(id => !newSelection.includes(id));
          
          // Add needed resources from available ones (only if we need more to meet requirements)
          const toAdd = notSelected.slice(0, needed);
          newSelection.push(...toAdd);
        }
      });
      
      // Only update if selection changed (to avoid infinite loops)
      const selectionChanged = newSelection.length !== currentSelection.length || 
          !newSelection.every(id => currentSelection.includes(id)) ||
          !currentSelection.every(id => newSelection.includes(id));
      
      if (selectionChanged) {
        isUpdatingSelectionRef.current = true;
        onSelectionChange(newSelection);
        lastSelectedRef.current = newSelection;
        // Reset flag after a short delay to allow state to update
        setTimeout(() => {
          isUpdatingSelectionRef.current = false;
        }, 100);
      } else {
        lastSelectedRef.current = currentSelection;
      }
    } else {
      // Auto-select suggested resources if none selected
      if (response.suggested_allocation.length > 0) {
        isUpdatingSelectionRef.current = true;
        const suggestedIds = response.suggested_allocation.flatMap((allocation) => (allocation as { id: number; name: string; resource_ids?: number[] }).resource_ids || []);
        onSelectionChange(suggestedIds);
        lastSelectedRef.current = suggestedIds;
        setTimeout(() => {
          isUpdatingSelectionRef.current = false;
        }, 100);
      }
    }
  }, [selectedResourceIds, onSelectionChange]);

  // Use initialAvailability if provided (pre-fetched in edit mode)
  useEffect(() => {
    if (initialAvailabilityProp) {
      setAvailability(initialAvailabilityProp);
      setLoading(false);
      
      // Cache it for future use
      if (appointmentTypeId && practitionerId && date && startTime) {
        const timeSlotKey = getResourceCacheKey(
          appointmentTypeId,
          practitionerId,
          date,
          startTime,
          durationMinutes,
          excludeCalendarEventId
        );
        setCachedResourceAvailability(timeSlotKey, initialAvailabilityProp);
        
        // Mark this slot as processed (auto-selection will be handled by the existing useEffect)
        lastAutoSelectedSlotRef.current = timeSlotKey;
      }
    }
  }, [initialAvailabilityProp, appointmentTypeId, practitionerId, date, startTime, durationMinutes, excludeCalendarEventId]);

  // Debounced fetch for resource availability (only if no initialAvailability provided)
  useEffect(() => {
    // Skip fetch if we have initialAvailability (already set above)
    if (initialAvailabilityProp) {
      return;
    }

    if (!appointmentTypeId || !practitionerId || !date || !startTime) {
      setAvailability(null);
      lastAutoSelectedSlotRef.current = '';
      return;
    }

    const timeSlotKey = getResourceCacheKey(
      appointmentTypeId,
      practitionerId,
      date,
      startTime,
      durationMinutes,
      excludeCalendarEventId
    );
    const needsAutoSelection = lastAutoSelectedSlotRef.current !== timeSlotKey;

    // Check cache first for immediate feedback
    const cachedData = getCachedResourceAvailability(timeSlotKey);
    if (cachedData !== null) {
      setAvailability(cachedData);
      setLoading(false);
      
      // Still trigger selection logic if slot hasn't been auto-selected yet
      if (needsAutoSelection) {
        handleAutoSelection(cachedData);
        lastAutoSelectedSlotRef.current = timeSlotKey;
      }
      return;
    }

    const fetchAvailability = async (signal?: AbortSignal) => {
      try {
        setLoading(true);
        setError(null);
        
        const startMoment = moment.tz(`${date}T${startTime}`, 'Asia/Taipei');
        const endMoment = startMoment.clone().add(durationMinutes, 'minutes');
        
        const response = await apiService.getResourceAvailability({
          appointment_type_id: appointmentTypeId,
          practitioner_id: practitionerId,
          date,
          start_time: startMoment.format('HH:mm'),
          end_time: endMoment.format('HH:mm'),
          ...(excludeCalendarEventId ? { exclude_calendar_event_id: excludeCalendarEventId } : {}),
        }, signal);
        
        setCachedResourceAvailability(timeSlotKey, response);
        setAvailability(response);
        
        // Smart resource selection logic: prefer keeping same resources if still available
        // Only run this logic when time slot changed and hasn't been auto-selected yet
        if (needsAutoSelection && !isUpdatingSelectionRef.current) {
          handleAutoSelection(response);
          lastAutoSelectedSlotRef.current = timeSlotKey;
        } else {
          // Update ref when selection changes due to user action (not time slot change)
          if (!needsAutoSelection) {
            lastSelectedRef.current = selectedResourceIds;
          }
        }
      } catch (err: unknown) {
        const error = err as { name?: string };
        if (error?.name === 'CanceledError' || error?.name === 'AbortError') return;
        logger.error('Failed to fetch resource availability:', err);
        setError(getErrorMessage(err) || '無法取得資源可用性');
        // Keep previous availability if we have it, rather than clearing
      } finally {
        setLoading(false);
        isInitialMountRef.current = false;
      }
    };

    const abortController = new AbortController();

    if (skipInitialDebounce && isInitialMountRef.current) {
      fetchAvailability(abortController.signal);
      return;
    }

    const timer = setTimeout(() => fetchAvailability(abortController.signal), 300); // 300ms debounce

    return () => {
      clearTimeout(timer);
      abortController.abort();
    };
  }, [appointmentTypeId, practitionerId, date, startTime, durationMinutes, excludeCalendarEventId, skipInitialDebounce, initialAvailabilityProp, handleAutoSelection, selectedResourceIds]);

  // Helper function to get resource by ID (memoized to avoid closure issues)
  const getResourceById = useCallback((resourceId: number): Resource | null => {
    if (currentAvailability) {
      for (const req of currentAvailability.requirements) {
        const resource = req.available_resources.find(r => r.id === resourceId);
        if (resource) {
          return {
            id: resource.id,
            name: resource.name,
            resource_type_id: req.resource_type_id,
            clinic_id: 0,
            is_deleted: false,
            created_at: '',
            updated_at: '',
          };
        }
      }
    }
    
    // Check in additional resources
    for (const resources of Object.values(additionalResources)) {
      const resource = resources.find(r => r.id === resourceId);
      if (resource) {
        return resource;
      }
    }
    
    return null;
  }, [currentAvailability, additionalResources]);

  // Track selection changes from user actions (not from our auto-updates)
  useEffect(() => {
    if (!isUpdatingSelectionRef.current) {
      lastSelectedRef.current = selectedResourceIds;
    }
  }, [selectedResourceIds]);

  // Auto-expand only if there are unmet requirements or conflicts
  useEffect(() => {
    if (!currentAvailability) return;
    
    const hasUnmetRequirements = currentAvailability.requirements.some(req => {
      const selectedCount = selectedResourceIds.filter(id => {
        const resource = getResourceById(id);
        return resource?.resource_type_id === req.resource_type_id;
      }).length;
      return selectedCount < req.required_quantity;
    });
    
    const hasConflicts = currentAvailability.requirements.some(req => 
      req.available_quantity < req.required_quantity
    );
    
    if (hasUnmetRequirements || hasConflicts) {
      setIsExpanded(true);
      // Auto-expand sections with issues - but preserve existing expanded sections
      // Note: Additional resource types are NOT auto-expanded (user must click to expand)
      setExpandedSections(prev => {
        const sectionsToExpand = new Set(prev); // Start with existing expanded sections
        
        // Add required resource types that need attention
        currentAvailability.requirements.forEach(req => {
          const selectedCount = selectedResourceIds.filter(id => {
            const resource = getResourceById(id);
            return resource?.resource_type_id === req.resource_type_id;
          }).length;
          
          // Check if any selected resources have conflicts
          const hasSelectedResourceConflicts = selectedResourceIds.some(id => {
            const resource = req.available_resources.find(r => r.id === id);
            return resource && !resource.is_available;
          });
          
          if (selectedCount < req.required_quantity || 
              req.available_quantity < req.required_quantity ||
              hasSelectedResourceConflicts) {
            sectionsToExpand.add(req.resource_type_id);
          }
        });
        
        return sectionsToExpand;
      });
    }
  }, [currentAvailability, selectedResourceIds, additionalResourceTypes, getResourceById]);

  // Fetch all resource types when needed (only for manually adding types)
  // No longer needed for initialResources - we have names from the API
  useEffect(() => {
    if (allResourceTypes.length === 0 && (
      showAddResourceTypeMenu || 
      (selectedResourceIds.length > 0 && availability && initialResources.length === 0)
    )) {
      const fetchResourceTypes = async () => {
        try {
          setLoadingResourceTypes(true);
          const response = await apiService.getResourceTypes();
          setAllResourceTypes(response.resource_types);
        } catch (err) {
          logger.error('Failed to fetch resource types:', err);
        } finally {
          setLoadingResourceTypes(false);
        }
      };
      fetchResourceTypes();
    }
  }, [showAddResourceTypeMenu, allResourceTypes.length, selectedResourceIds.length, availability, initialResources.length]);


  // Fetch resources for additional resource types
  // Use initialResources if available to avoid unnecessary API calls
  useEffect(() => {
    const fetchAdditionalResources = async () => {
      // Only fetch for types that don't have resources yet
      const typesToFetch = additionalResourceTypes.filter(typeId => !additionalResources[typeId]);
      
      if (typesToFetch.length === 0) return;

      // Check if we can use initialResources for any of these types
      const initialResourcesByType: Record<number, Resource[]> = {};
      initialResources.forEach(resource => {
        if (typesToFetch.includes(resource.resource_type_id)) {
          const typeId = resource.resource_type_id;
          if (!initialResourcesByType[typeId]) {
            initialResourcesByType[typeId] = [];
          }
          initialResourcesByType[typeId].push({
            id: resource.id,
            name: resource.name,
            resource_type_id: resource.resource_type_id,
            clinic_id: 0,
            is_deleted: false,
            created_at: '',
            updated_at: '',
          });
        }
      });

      // Set initial resources immediately (no API call needed) for immediate display
      // We'll still fetch the full list below to show all available resources
      if (Object.keys(initialResourcesByType).length > 0) {
        setAdditionalResources(prev => ({
          ...prev,
          ...initialResourcesByType,
        }));
      }

      // Fetch full resource lists for all types (in parallel for better performance)
      // We fetch all types, not just ones without initialResources, because:
      // - initialResources only contains selected resources, not all resources in the type
      // - We need the full list so users can see all available options
      const typesToFetchFromAPI = typesToFetch;
      
      if (typesToFetchFromAPI.length > 0) {
        // Fetch all types in parallel
        const fetchPromises = typesToFetchFromAPI.map(async (typeId) => {
          try {
            const response = await apiService.getResources(typeId);
            return {
              typeId,
              resources: response.resources.filter(r => !r.is_deleted)
            };
          } catch (err) {
            logger.error(`Failed to fetch resources for type ${typeId}:`, err);
            return { typeId, resources: [] };
          }
        });

        const results = await Promise.all(fetchPromises);
        
        // Update state once with all results
        setAdditionalResources(prev => {
          const updated = { ...prev };
          results.forEach(({ typeId, resources }) => {
            if (resources.length > 0) {
              updated[typeId] = resources;
            }
          });
          return updated;
        });
        
        // Auto-select first resource for newly added types
        const resourcesToAutoSelect: number[] = [];
        results.forEach(({ typeId, resources }) => {
          if (resources.length > 0 && newlyAddedResourceTypesRef.current.has(typeId)) {
            const firstResource = resources[0];
            if (firstResource && !selectedResourceIds.includes(firstResource.id)) {
              resourcesToAutoSelect.push(firstResource.id);
            }
            // Remove from newly added set after processing
            newlyAddedResourceTypesRef.current.delete(typeId);
          }
        });
        
        if (resourcesToAutoSelect.length > 0) {
          const newSelection = [...selectedResourceIds, ...resourcesToAutoSelect];
          onSelectionChange(newSelection);
        }
      }
    };
    
    if (additionalResourceTypes.length > 0) {
      fetchAdditionalResources();
    }
    // Only depend on additionalResourceTypes - the guard clause `!additionalResources[typeId]` 
    // inside the effect prevents re-fetching when additionalResources changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [additionalResourceTypes, initialResources]);


  // Group selected resources by type (must be memoized since it's used in dependency array)
  const selectedByType = useMemo(() => {
    const result: Record<number, number[]> = {};
    selectedResourceIds.forEach(id => {
      const resource = getResourceById(id);
      if (resource) {
        const typeId = resource.resource_type_id;
        if (!result[typeId]) {
          result[typeId] = [];
        }
        result[typeId].push(id);
      }
    });
    return result;
  }, [selectedResourceIds, getResourceById]);

  // Get resource type name by ID
  // Priority: availability requirements > initialResources > allResourceTypes > fallback
  const getResourceTypeName = useCallback((typeId: number): string => {
    if (currentAvailability) {
      const req = currentAvailability.requirements.find(r => r.resource_type_id === typeId);
      if (req) return req.resource_type_name;
    }
    const nameFromInitial = resourceTypeNamesFromInitial.get(typeId);
    if (nameFromInitial) return nameFromInitial;
    const type = allResourceTypes.find(t => t.id === typeId);
    return type?.name || `資源類型 ${typeId}`;
  }, [currentAvailability, resourceTypeNamesFromInitial, allResourceTypes]);

  // Get selected resource names for a resource type
  const getSelectedResourceNames = useCallback((resourceTypeId: number): string[] => {
    const selected = selectedResourceIds
      .map(id => getResourceById(id))
      .filter((r): r is Resource => r !== null && r.resource_type_id === resourceTypeId)
      .map(r => r.name);
    return selected;
  }, [selectedResourceIds, getResourceById]);

  // Get selected resource names with conflict indicators for a resource type
  const getSelectedResourceNamesWithConflicts = useCallback((resourceTypeId: number): string[] => {
    if (!currentAvailability) {
      // For additional resource types, we don't have availability info, so no conflicts
      return getSelectedResourceNames(resourceTypeId);
    }

    const selected = selectedResourceIds
      .map(id => {
        // Find the resource in availability requirements
        for (const req of currentAvailability.requirements) {
          if (req.resource_type_id === resourceTypeId) {
            const resource = req.available_resources.find(r => r.id === id);
            if (resource) {
              // Check if this resource has a conflict
              const hasConflict = !resource.is_available;
              return hasConflict ? `${resource.name}⚠️` : resource.name;
            }
          }
        }
        // If not found in requirements, check if it's an additional resource
        const resource = getResourceById(id);
        if (resource && resource.resource_type_id === resourceTypeId) {
          // For additional resources, we don't have conflict info, so no indicator
          return resource.name;
        }
        return null;
      })
      .filter((name): name is string => name !== null);
    
    return selected;
  }, [currentAvailability, selectedResourceIds, getResourceById, getSelectedResourceNames]);

  // Build summary text for collapsed view (must be before early return)
  const summaryText = useMemo(() => {
    const parts: string[] = [];
    
    if (currentAvailability) {
      currentAvailability.requirements.forEach(req => {
        const selectedCount = selectedByType[req.resource_type_id]?.length || 0;
        const selectedNamesWithConflicts = getSelectedResourceNamesWithConflicts(req.resource_type_id);
        const status = selectedCount >= req.required_quantity ? '✓' : '⚠️';
        
        if (selectedNamesWithConflicts.length > 0) {
          parts.push(`${req.resource_type_name}: ${selectedCount}/${req.required_quantity} ${status} (${selectedNamesWithConflicts.join(', ')})`);
        } else {
          parts.push(`${req.resource_type_name}: ${selectedCount}/${req.required_quantity} ${status}`);
        }
      });
    }
    
    // Add additional resource types (show even if empty to provide visual feedback)
    additionalResourceTypes.forEach(typeId => {
      const selectedNames = getSelectedResourceNames(typeId);
      const selectedCount = selectedNames.length;
      if (selectedCount > 0) {
        // For additional types, show count format with checkmark
        // Note: Additional resources don't have conflict info from availability API
        parts.push(`${getResourceTypeName(typeId)}: 已選 ${selectedCount} 個 ✓ (${selectedNames.join(', ')})`);
      } else {
        // Show empty additional type to indicate it was added
        parts.push(`${getResourceTypeName(typeId)}: 已選 0 個`);
      }
    });
    
    return parts.join(' | ');
  }, [currentAvailability, selectedByType, additionalResourceTypes, getSelectedResourceNames, getSelectedResourceNamesWithConflicts, getResourceTypeName]);

  const toggleSection = (resourceTypeId: number) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(resourceTypeId)) {
        newSet.delete(resourceTypeId);
      } else {
        newSet.add(resourceTypeId);
      }
      return newSet;
    });
  };

  const handleAddResourceType = (typeId: number) => {
    if (!manuallyAddedResourceTypes.includes(typeId)) {
      setManuallyAddedResourceTypes(prev => [...prev, typeId]);
      setIsExpanded(true);
      setExpandedSections(prev => new Set([...prev, typeId]));
      // Mark as newly added for auto-selection
      newlyAddedResourceTypesRef.current.add(typeId);
    }
    setShowAddResourceTypeMenu(false);
  };

  const availableResourceTypesForAdding = useMemo(() => {
    if (!currentAvailability) return allResourceTypes;
    const requiredTypeIds = new Set(currentAvailability.requirements.map(req => req.resource_type_id));
    return allResourceTypes.filter(type => 
      !requiredTypeIds.has(type.id) && !additionalResourceTypes.includes(type.id)
    );
  }, [allResourceTypes, currentAvailability, additionalResourceTypes]);

  // Find all selected resources that have descriptions
  const selectedWithDescriptions = currentAvailability?.requirements.flatMap(req => 
    req.available_resources.filter(r => 
      selectedResourceIds.includes(r.id) && r.description
    )
  ) || [];

  // Early return after all hooks (must be after all hooks)
  if ((!currentAvailability || currentAvailability.requirements.length === 0) && !loading && additionalResourceTypes.length === 0) {
    return null;
  }

  const handleResourceToggle = (resourceId: number) => {
    const newSelection = selectedResourceIds.includes(resourceId)
      ? selectedResourceIds.filter(id => id !== resourceId)
      : [...selectedResourceIds, resourceId];
    onSelectionChange(newSelection);
  };

  return (
    <div className="space-y-4 min-h-[100px]">
      <div className="border-t border-gray-200 pt-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-gray-900">資源選擇</h3>
            {loading && (
              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-400"></div>
            )}
          </div>
          {((currentAvailability && currentAvailability.requirements.length > 0) || additionalResourceTypes.length > 0) && (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              {isExpanded ? '收起' : '展開'}
            </button>
          )}
        </div>
        
        {error && (
          <div className="text-sm text-red-600 mb-3">{error}</div>
        )}
        

        {/* Collapsed Summary View */}
        {!isExpanded && summaryText && (
          <div className="text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {summaryText.split(' | ').map((part, idx) => {
                  const hasCheck = part.includes('✓');
                  const hasWarning = part.includes('⚠️');
                  
                  return (
                    <span key={idx} className="inline-flex items-center gap-1.5">
                      <span className={hasCheck ? 'text-green-700' : hasWarning ? 'text-orange-700' : 'text-gray-700'}>
                        {part}
                      </span>
                    </span>
                  );
                })}
              </div>
          </div>
        )}

        {/* Expanded Detailed View */}
        {(currentAvailability || additionalResourceTypes.length > 0) && isExpanded && (
          <div className="space-y-4">
            {currentAvailability?.requirements.map((req) => {
              const selectedCount = selectedByType[req.resource_type_id]?.length || 0;
              const hasConflict = req.available_quantity < req.required_quantity;
              const isQuantityInsufficient = selectedCount < req.required_quantity;
              const isSectionExpanded = expandedSections.has(req.resource_type_id);
              const selectedNames = getSelectedResourceNames(req.resource_type_id);

              return (
                <div key={req.resource_type_id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1">
                      <label className="text-sm font-medium text-gray-700">
                        {req.resource_type_name}
                        <span className="text-gray-500 ml-1">
                          (需要 {req.required_quantity} 個，已選 {selectedCount} 個)
                        </span>
                        {selectedNames.length > 0 && (
                          <span className="text-gray-600 ml-1">
                            ({selectedNames.join(', ')})
                          </span>
                        )}
                      </label>
                      {hasConflict && (
                        <span className="text-xs text-yellow-600 bg-yellow-50 px-2 py-1 rounded">
                          資源不足
                        </span>
                      )}
                      {isQuantityInsufficient && !hasConflict && (
                        <span className="text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded">
                          數量不足
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleSection(req.resource_type_id)}
                        className="text-xs text-gray-600 hover:text-gray-800"
                      >
                        {isSectionExpanded ? '收起' : '展開'}
                      </button>
                    </div>
                  </div>
                  
                  {isSectionExpanded && (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {req.available_resources.map((resource) => {
                        const isSelected = selectedResourceIds.includes(resource.id);
                        const isUnavailable = !resource.is_available;

                        return (
                          <button
                            key={resource.id}
                            type="button"
                            onClick={() => handleResourceToggle(resource.id)}
                            disabled={loading}
                            title={resource.description || undefined}
                            className={`
                              px-3 py-2 rounded-md border text-sm text-left transition-colors
                              ${isSelected
                                ? isUnavailable
                                  ? 'bg-yellow-50 border-yellow-500 text-yellow-900'
                                  : 'bg-primary-50 border-primary-500 text-primary-900'
                                : isUnavailable
                                ? 'bg-white border-gray-300 text-gray-500'
                                : 'bg-white border-gray-300 text-gray-700 hover:border-primary-300 hover:bg-primary-50'
                              }
                            `}
                          >
                            <div className="flex items-center justify-between">
                              <span>{resource.name}</span>
                              {isSelected && (
                                isUnavailable ? (
                                  <span className="text-xs text-yellow-700">衝突</span>
                                ) : (
                                  <svg className="w-4 h-4 text-primary-600" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                )
                              )}
                              {isUnavailable && !isSelected && (
                                <span className="text-xs text-gray-400">已使用</span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Additional Resource Types */}
            {additionalResourceTypes.map(typeId => {
              const typeName = getResourceTypeName(typeId);
              const resources = additionalResources[typeId] || [];
              const selectedNames = getSelectedResourceNames(typeId);
              const selectedCount = selectedNames.length;
              const isSectionExpanded = expandedSections.has(typeId);

              return (
                <div key={typeId} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1">
                      <label className="text-sm font-medium text-gray-700">
                        {typeName}
                        <span className="text-gray-500 ml-1">
                          (已選 {selectedCount} 個)
                        </span>
                        {selectedNames.length > 0 && (
                          <span className="text-gray-600 ml-1">
                            ({selectedNames.join(', ')})
                          </span>
                        )}
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleSection(typeId)}
                        className="text-xs text-gray-600 hover:text-gray-800"
                      >
                        {isSectionExpanded ? '收起' : '展開'}
                      </button>
                    </div>
                  </div>
                  
                  {isSectionExpanded && resources.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {resources.map((resource) => {
                        const isSelected = selectedResourceIds.includes(resource.id);

                        return (
                          <button
                            key={resource.id}
                            type="button"
                            onClick={() => handleResourceToggle(resource.id)}
                            disabled={loading}
                            title={resource.description || undefined}
                            className={`
                              px-3 py-2 rounded-md border text-sm text-left transition-colors
                              ${isSelected
                                ? 'bg-primary-50 border-primary-500 text-primary-900'
                                : 'bg-white border-gray-300 text-gray-700 hover:border-primary-300 hover:bg-primary-50'
                              }
                            `}
                          >
                            <div className="flex items-center justify-between">
                              <span>{resource.name}</span>
                              {isSelected && (
                                <svg className="w-4 h-4 text-primary-600" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Add Other Resource Type Button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowAddResourceTypeMenu(!showAddResourceTypeMenu)}
                className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                新增其他資源類型
              </button>
              
              {showAddResourceTypeMenu && (
                <>
                  <div 
                    className="fixed inset-0 z-10" 
                    onClick={() => setShowAddResourceTypeMenu(false)}
                  />
                  <div className="absolute left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-20 min-w-[200px] max-h-60 overflow-y-auto">
                    {loadingResourceTypes ? (
                      <div className="p-3 text-sm text-gray-500">載入中...</div>
                    ) : availableResourceTypesForAdding.length === 0 ? (
                      <div className="p-3 text-sm text-gray-500">無其他資源類型</div>
                    ) : (
                      availableResourceTypesForAdding.map(type => (
                        <button
                          key={type.id}
                          type="button"
                          onClick={() => handleAddResourceType(type.id)}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          {type.name}
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            {selectedWithDescriptions.length > 0 && (
              <div className="bg-blue-50 border border-blue-100 rounded-md p-3 space-y-2">
                <h4 className="text-xs font-semibold text-blue-900 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  資源備注
                </h4>
                <div className="space-y-1.5">
                  {selectedWithDescriptions.map(resource => (
                    <div key={resource.id} className="text-xs text-blue-800 leading-relaxed">
                      <span className="font-medium mr-1">{resource.name}：</span>
                      {resource.description}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

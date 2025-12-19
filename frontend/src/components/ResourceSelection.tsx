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
}) => {
  const [loading, setLoading] = useState(false);
  const [availability, setAvailability] = useState<ResourceAvailabilityResponse | null>(null);
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
  const [additionalResourceTypes, setAdditionalResourceTypes] = useState<number[]>(() => additionalResourceTypesRef.current);
  const additionalResourcesRef = useRef<Record<number, Resource[]>>({});
  const [additionalResources, setAdditionalResources] = useState<Record<number, Resource[]>>({});
  
  // Sync refs with state to preserve across remounts (when time/date clears)
  useEffect(() => {
    additionalResourceTypesRef.current = additionalResourceTypes;
    expandedSectionsRef.current = expandedSections;
    additionalResourcesRef.current = additionalResources;
  }, [additionalResourceTypes, expandedSections, additionalResources]);
  
  // Restore state from refs on mount (to preserve across remounts)
  useEffect(() => {
    // Check if refs have data that state doesn't (more robust check)
    const hasRefData = additionalResourceTypesRef.current.length > 0 || 
                       expandedSectionsRef.current.size > 0 || 
                       Object.keys(additionalResourcesRef.current).length > 0;
    const hasStateData = additionalResourceTypes.length > 0 || 
                         expandedSections.size > 0 || 
                         Object.keys(additionalResources).length > 0;
    
    if (hasRefData && !hasStateData) {
      setAdditionalResourceTypes(additionalResourceTypesRef.current);
      setExpandedSections(expandedSectionsRef.current);
      setAdditionalResources(additionalResourcesRef.current);
      // Also restore isExpanded if we have additional types
      if (additionalResourceTypesRef.current.length > 0) {
        setIsExpanded(true);
      }
    }
  }, []); // Only run on mount
  
  const [loadingResourceTypes, setLoadingResourceTypes] = useState(false);
  const [allResourceTypes, setAllResourceTypes] = useState<ResourceType[]>([]);
  const [showAddResourceTypeMenu, setShowAddResourceTypeMenu] = useState(false);

  // Notify parent about all resources found in this availability check
  useEffect(() => {
    if (availability && onResourcesFound) {
      const allResources = availability.requirements.flatMap(req => 
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
      onResourcesFound(allResources);
    }
  }, [availability, onResourcesFound]);

  // Helper function to get available resources for a resource type
  const getAvailableResourcesForType = (resourceTypeId: number, avail: ResourceAvailabilityResponse): number[] => {
    const req = avail.requirements.find(r => r.resource_type_id === resourceTypeId);
    if (!req) return [];
    return req.available_resources.filter(r => r.is_available).map(r => r.id);
  };

  // Debounced fetch for resource availability
  useEffect(() => {
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
      } catch (err: any) {
        if (err?.name === 'CanceledError' || err?.name === 'AbortError') return;
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
  }, [appointmentTypeId, practitionerId, date, startTime, durationMinutes, excludeCalendarEventId, skipInitialDebounce]);

  // Extract auto-selection logic to a helper function
  const handleAutoSelection = (response: ResourceAvailabilityResponse) => {
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
        const suggestedIds = response.suggested_allocation.map(r => r.id);
        onSelectionChange(suggestedIds);
        lastSelectedRef.current = suggestedIds;
        setTimeout(() => {
          isUpdatingSelectionRef.current = false;
        }, 100);
      }
    }
  };

  // Helper function to get resource by ID (memoized to avoid closure issues)
  const getResourceById = useCallback((resourceId: number): Resource | null => {
    // Check in availability requirements first
    if (availability) {
      for (const req of availability.requirements) {
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
  }, [availability, additionalResources]);

  // Track selection changes from user actions (not from our auto-updates)
  useEffect(() => {
    if (!isUpdatingSelectionRef.current) {
      lastSelectedRef.current = selectedResourceIds;
    }
  }, [selectedResourceIds]);

  // Auto-expand if requirements not met or if resources are prepopulated
  useEffect(() => {
    if (!availability) return;
    
    const hasUnmetRequirements = availability.requirements.some(req => {
      const selectedCount = selectedResourceIds.filter(id => {
        const resource = getResourceById(id);
        return resource?.resource_type_id === req.resource_type_id;
      }).length;
      return selectedCount < req.required_quantity;
    });
    
    const hasConflicts = availability.requirements.some(req => 
      req.available_quantity < req.required_quantity
    );
    
    // Auto-expand if requirements not met, conflicts exist, or if we have prepopulated resources
    // Also auto-expand if we have additional resource types
    // Check prepopulated resources before isInitialMountRef is reset
    const hasPrepopulatedResources = isInitialMountRef.current && selectedResourceIds.length > 0;
    if (hasUnmetRequirements || hasConflicts || hasPrepopulatedResources || additionalResourceTypes.length > 0) {
      setIsExpanded(true);
      // Auto-expand sections with issues - but preserve existing expanded sections (especially additional types)
      setExpandedSections(prev => {
        const sectionsToExpand = new Set(prev); // Start with existing expanded sections
        
        // Preserve all additional resource type sections
        additionalResourceTypes.forEach(typeId => {
          sectionsToExpand.add(typeId);
        });
        
        // Add required resource types that need attention
        availability.requirements.forEach(req => {
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
  }, [availability, selectedResourceIds, additionalResources, additionalResourceTypes, getResourceById]);

  // Fetch all resource types when needed (for adding types or detecting prepopulated types)
  useEffect(() => {
    if (allResourceTypes.length === 0 && (showAddResourceTypeMenu || (selectedResourceIds.length > 0 && availability))) {
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
  }, [showAddResourceTypeMenu, allResourceTypes.length, selectedResourceIds.length, availability]);

  // Fetch resources for additional resource types
  useEffect(() => {
    const fetchAdditionalResources = async () => {
      // Only fetch for types that don't have resources yet
      const typesToFetch = additionalResourceTypes.filter(typeId => !additionalResources[typeId]);
      
      for (const typeId of typesToFetch) {
        try {
          const response = await apiService.getResources(typeId);
          setAdditionalResources(prev => ({
            ...prev,
            [typeId]: response.resources.filter(r => !r.is_deleted)
          }));
        } catch (err) {
          logger.error(`Failed to fetch resources for type ${typeId}:`, err);
        }
      }
    };
    
    if (additionalResourceTypes.length > 0) {
      fetchAdditionalResources();
    }
    // Only depend on additionalResourceTypes - the guard clause `!additionalResources[typeId]` 
    // inside the effect prevents re-fetching when additionalResources changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [additionalResourceTypes]);


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
  const getResourceTypeName = useCallback((typeId: number): string => {
    if (availability) {
      const req = availability.requirements.find(r => r.resource_type_id === typeId);
      if (req) return req.resource_type_name;
    }
    const type = allResourceTypes.find(t => t.id === typeId);
    return type?.name || `資源類型 ${typeId}`;
  }, [availability, allResourceTypes]);

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
    if (!availability) {
      // For additional resource types, we don't have availability info, so no conflicts
      return getSelectedResourceNames(resourceTypeId);
    }

    const selected = selectedResourceIds
      .map(id => {
        // Find the resource in availability requirements
        for (const req of availability.requirements) {
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
  }, [availability, selectedResourceIds, getResourceById, getSelectedResourceNames]);

  // Build summary text for collapsed view (must be before early return)
  const summaryText = useMemo(() => {
    const parts: string[] = [];
    
    // Add required resource types (if availability exists)
    if (availability) {
      availability.requirements.forEach(req => {
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
        // For additional types, show count/count format with checkmark
        // Note: Additional resources don't have conflict info from availability API
        parts.push(`${getResourceTypeName(typeId)}: ${selectedCount}/${selectedCount} ✓ (${selectedNames.join(', ')})`);
      } else {
        // Show empty additional type to indicate it was added
        parts.push(`${getResourceTypeName(typeId)}: 0/0`);
      }
    });
    
    return parts.join(' | ');
  }, [availability, selectedByType, additionalResourceTypes, getSelectedResourceNames, getSelectedResourceNamesWithConflicts, getResourceTypeName]);

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
    if (!additionalResourceTypes.includes(typeId)) {
      setAdditionalResourceTypes(prev => [...prev, typeId]);
      setIsExpanded(true);
      setExpandedSections(prev => new Set([...prev, typeId]));
    }
    setShowAddResourceTypeMenu(false);
  };

  const availableResourceTypesForAdding = useMemo(() => {
    if (!availability) return allResourceTypes;
    const requiredTypeIds = new Set(availability.requirements.map(req => req.resource_type_id));
    return allResourceTypes.filter(type => 
      !requiredTypeIds.has(type.id) && !additionalResourceTypes.includes(type.id)
    );
  }, [allResourceTypes, availability, additionalResourceTypes]);

  // Find all selected resources that have descriptions
  const selectedWithDescriptions = availability?.requirements.flatMap(req => 
    req.available_resources.filter(r => 
      selectedResourceIds.includes(r.id) && r.description
    )
  ) || [];

  // Early return after all hooks (must be after all hooks)
  if ((!availability || availability.requirements.length === 0) && !loading && additionalResourceTypes.length === 0) {
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
          {((availability && availability.requirements.length > 0) || additionalResourceTypes.length > 0) && (
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
        
        {loading && !availability && (
          <div className="space-y-4">
            <div className="h-4 bg-gray-100 rounded w-1/3 animate-pulse"></div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <div className="h-10 bg-gray-100 rounded animate-pulse"></div>
              <div className="h-10 bg-gray-100 rounded animate-pulse"></div>
            </div>
          </div>
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
        {(availability || additionalResourceTypes.length > 0) && isExpanded && (
          <div className="space-y-4">
            {availability?.requirements.map((req) => {
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
              const isSectionExpanded = expandedSections.has(typeId);

              return (
                <div key={typeId} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1">
                      <label className="text-sm font-medium text-gray-700">
                        {typeName}
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

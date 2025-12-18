import React, { useState, useEffect, useRef } from 'react';
import { ResourceAvailabilityResponse, Resource } from '../types';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../types/api';
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
  skipInitialDebounce = false,
}) => {
  const [loading, setLoading] = useState(false);
  const [availability, setAvailability] = useState<ResourceAvailabilityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, ResourceAvailabilityResponse>>({});
  const lastAutoSelectedSlotRef = useRef<string>('');
  const lastSelectedRef = useRef<number[]>([]);
  const isUpdatingSelectionRef = useRef(false);
  const isInitialMountRef = useRef(true);

  // Helper function to check if a resource is available in the current availability response
  const isResourceAvailable = (resourceId: number, avail: ResourceAvailabilityResponse): boolean => {
    for (const req of avail.requirements) {
      const resource = req.available_resources.find(r => r.id === resourceId && r.is_available);
      if (resource) {
        return true;
      }
    }
    return false;
  };

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

    const timeSlotKey = `${appointmentTypeId}_${practitionerId}_${date}_${startTime}_${durationMinutes}_${excludeCalendarEventId || 0}`;
    const needsAutoSelection = lastAutoSelectedSlotRef.current !== timeSlotKey;

    // Check cache first for immediate feedback
    if (cache[timeSlotKey]) {
      const cachedData = cache[timeSlotKey]!;
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
        
        setCache(prev => ({ ...prev, [timeSlotKey]: response }));
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
  }, [appointmentTypeId, practitionerId, date, startTime, durationMinutes, excludeCalendarEventId, cache, skipInitialDebounce]);

  // Extract auto-selection logic to a helper function
  const handleAutoSelection = (response: ResourceAvailabilityResponse) => {
    // Use the ref to get the selection at the time the effect was triggered
    const currentSelection = lastSelectedRef.current.length > 0 ? lastSelectedRef.current : selectedResourceIds;
    
    if (currentSelection.length > 0) {
      // Check which selected resources are still available
      const availableSelected: number[] = [];
      
      currentSelection.forEach(resourceId => {
        if (isResourceAvailable(resourceId, response)) {
          availableSelected.push(resourceId);
        }
      });
      
      // Group available selected resources by type
      const availableByType: Record<number, number[]> = {};
      availableSelected.forEach(id => {
        for (const req of response.requirements) {
          const resource = req.available_resources.find(r => r.id === id);
          if (resource) {
            if (!availableByType[req.resource_type_id]) {
              availableByType[req.resource_type_id] = [];
            }
            const typeArray = availableByType[req.resource_type_id];
            if (typeArray) {
              typeArray.push(id);
            }
          }
        }
      });
      
      // Build new selection: keep available ones, replace unavailable ones
      const newSelection: number[] = [...availableSelected];
      
      // For each resource type, ensure we have the required quantity
      response.requirements.forEach(req => {
        const currentCount = availableByType[req.resource_type_id]?.length || 0;
        const needed = req.required_quantity - currentCount;
        
        if (needed > 0) {
          // Get available resources for this type that aren't already selected
          const availableForType = getAvailableResourcesForType(req.resource_type_id, response);
          const notSelected = availableForType.filter(id => !newSelection.includes(id));
          
          // Add needed resources from available ones
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

  // Track selection changes from user actions (not from our auto-updates)
  useEffect(() => {
    if (!isUpdatingSelectionRef.current) {
      lastSelectedRef.current = selectedResourceIds;
    }
  }, [selectedResourceIds]);

  // Don't show if no requirements and not loading
  if ((!availability || availability.requirements.length === 0) && !loading) {
    return null;
  }

  const handleResourceToggle = (resourceId: number) => {
    const newSelection = selectedResourceIds.includes(resourceId)
      ? selectedResourceIds.filter(id => id !== resourceId)
      : [...selectedResourceIds, resourceId];
    onSelectionChange(newSelection);
  };

  const getResourceById = (resourceId: number): Resource | null => {
    if (!availability) return null;
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
    return null;
  };

  // Group selected resources by type
  const selectedByType: Record<number, number[]> = {};
  selectedResourceIds.forEach(id => {
    const resource = getResourceById(id);
    if (resource) {
      if (!selectedByType[resource.resource_type_id]) {
        selectedByType[resource.resource_type_id] = [];
      }
      const typeArray = selectedByType[resource.resource_type_id];
      if (typeArray) {
        typeArray.push(id);
      }
    }
  });

  // Find all selected resources that have descriptions
  const selectedWithDescriptions = availability?.requirements.flatMap(req => 
    req.available_resources.filter(r => 
      selectedResourceIds.includes(r.id) && r.description
    )
  ) || [];

  return (
    <div className="space-y-4 min-h-[100px]">
      <div className="border-t border-gray-200 pt-4">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-medium text-gray-900">資源選擇</h3>
          {loading && (
            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-400"></div>
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

        {availability && (
          <div className="space-y-4">
            {availability.requirements.map((req) => {
              const selectedCount = selectedByType[req.resource_type_id]?.length || 0;
              const hasConflict = req.available_quantity < req.required_quantity;
              const isQuantityInsufficient = selectedCount < req.required_quantity;

              return (
                <div key={req.resource_type_id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700">
                      {req.resource_type_name}
                      <span className="text-gray-500 ml-1">
                        (需要 {req.required_quantity} 個，已選 {selectedCount} 個)
                      </span>
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
                </div>
              );
            })}

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

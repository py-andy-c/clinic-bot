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
}) => {
  const [loading, setLoading] = useState(false);
  const [availability, setAvailability] = useState<ResourceAvailabilityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastTimeSlotRef = useRef<string>('');
  const lastSelectedRef = useRef<number[]>([]);
  const isUpdatingSelectionRef = useRef(false);

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
      lastTimeSlotRef.current = '';
      return;
    }

    const timeSlotKey = `${date}_${startTime}_${durationMinutes}`;
    const timeSlotChanged = lastTimeSlotRef.current !== timeSlotKey;
    lastTimeSlotRef.current = timeSlotKey;

    const timer = setTimeout(async () => {
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
        });
        
        setAvailability(response);
        
        // Smart resource selection logic: prefer keeping same resources if still available
        // Only run this logic when time slot changes (not when selection changes due to user action)
        if (timeSlotChanged && !isUpdatingSelectionRef.current) {
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
        } else {
          // Update ref when selection changes due to user action (not time slot change)
          if (!timeSlotChanged) {
            lastSelectedRef.current = selectedResourceIds;
          }
        }
      } catch (err) {
        logger.error('Failed to fetch resource availability:', err);
        setError(getErrorMessage(err) || '無法取得資源可用性');
        setAvailability(null);
      } finally {
        setLoading(false);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [appointmentTypeId, practitionerId, date, startTime, durationMinutes, excludeCalendarEventId]);

  // Track selection changes from user actions (not from our auto-updates)
  useEffect(() => {
    if (!isUpdatingSelectionRef.current) {
      lastSelectedRef.current = selectedResourceIds;
    }
  }, [selectedResourceIds]);

  // Don't show if no requirements
  if (!availability || availability.requirements.length === 0) {
    return null;
  }

  const handleResourceToggle = (resourceId: number) => {
    const newSelection = selectedResourceIds.includes(resourceId)
      ? selectedResourceIds.filter(id => id !== resourceId)
      : [...selectedResourceIds, resourceId];
    onSelectionChange(newSelection);
  };

  const getResourceById = (resourceId: number): Resource | null => {
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

  return (
    <div className="space-y-4">
      <div className="border-t border-gray-200 pt-4">
        <h3 className="text-sm font-medium text-gray-900 mb-3">資源選擇</h3>
        
        {loading && (
          <div className="text-sm text-gray-500">載入資源可用性中...</div>
        )}
        
        {error && (
          <div className="text-sm text-red-600 mb-3">{error}</div>
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
                          className={`
                            px-3 py-2 rounded-md border text-sm text-left transition-colors
                            ${isSelected
                              ? 'bg-primary-50 border-primary-500 text-primary-900'
                              : isUnavailable
                              ? 'bg-gray-100 border-gray-300 text-gray-500 opacity-60'
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
                            {isUnavailable && !isSelected && (
                              <span className="text-xs text-gray-400">已使用</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  
                  {isQuantityInsufficient && (
                    <p className="text-xs text-orange-600">
                      已選擇的資源數量不足，建議選擇 {req.required_quantity} 個
                    </p>
                  )}
                </div>
              );
            })}
            
            {availability.conflicts.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                <p className="text-sm text-yellow-800">
                  <strong>資源衝突：</strong>
                  {availability.conflicts.map((conflict, idx) => (
                    <span key={conflict.resource_type_id}>
                      {idx > 0 && '、'}
                      {conflict.resource_type_name} 僅有 {conflict.available_quantity} 個可用（需要 {conflict.required_quantity} 個）
                    </span>
                  ))}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};


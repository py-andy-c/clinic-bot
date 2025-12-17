import React, { useState, useEffect, useRef, useMemo } from 'react';
import { getPractitionerColor } from '../utils/practitionerColors';
import { getResourceColorById } from '../utils/resourceColorUtils';
import { Resource, ResourceType } from '../types';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';

interface Practitioner {
  id: number;
  full_name: string;
}

interface CalendarSelectorProps {
  practitioners: Practitioner[];
  selectedPractitionerIds: number[];
  currentUserId: number | null;
  isPractitioner: boolean;
  onPractitionerChange: (practitionerIds: number[]) => void;
  resources: Resource[];
  selectedResourceIds: number[];
  onResourceChange: (resourceIds: number[]) => void;
  maxSelectablePractitioners?: number;
  maxSelectableResources?: number;
  showAsList?: boolean;
}

const CalendarSelector: React.FC<CalendarSelectorProps> = ({
  practitioners,
  selectedPractitionerIds,
  currentUserId,
  isPractitioner,
  onPractitionerChange,
  resources,
  selectedResourceIds,
  onResourceChange,
  maxSelectablePractitioners = 5,
  maxSelectableResources = 10,
  showAsList = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resourceTypes, setResourceTypes] = useState<ResourceType[]>([]);
  const [loadingResourceTypes, setLoadingResourceTypes] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownMenuRef = useRef<HTMLDivElement>(null);

  // Load resource types
  useEffect(() => {
    const loadResourceTypes = async () => {
      try {
        setLoadingResourceTypes(true);
        const response = await apiService.getResourceTypes();
        setResourceTypes(response.resource_types);
      } catch (err) {
        logger.error('Failed to load resource types:', err);
      } finally {
        setLoadingResourceTypes(false);
      }
    };

    if (resources.length > 0) {
      loadResourceTypes();
    }
  }, [resources.length]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
    return undefined;
  }, [isOpen]);

  // Close dropdown on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  // Calculate dropdown position
  useEffect(() => {
    if (isOpen && dropdownRef.current && dropdownMenuRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const dropdownHeight = 200;
      
      if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
        dropdownMenuRef.current.style.bottom = '100%';
        dropdownMenuRef.current.style.top = 'auto';
        dropdownMenuRef.current.style.marginBottom = '0.5rem';
        dropdownMenuRef.current.style.marginTop = '0';
      } else {
        dropdownMenuRef.current.style.top = '100%';
        dropdownMenuRef.current.style.bottom = 'auto';
        dropdownMenuRef.current.style.marginTop = '0.5rem';
        dropdownMenuRef.current.style.marginBottom = '0';
      }
    }
  }, [isOpen]);

  // Filter out current user if they're a practitioner
  const availablePractitioners = practitioners.filter(
    (p) => !isPractitioner || p.id !== currentUserId
  );

  // Group resources by type
  const resourcesByType = useMemo(() => {
    const grouped: Record<number, Resource[]> = {};
    resources.forEach(resource => {
      const typeId = resource.resource_type_id;
      if (typeId !== undefined) {
        if (!grouped[typeId]) {
          grouped[typeId] = [];
        }
        grouped[typeId].push(resource);
      }
    });
    return grouped;
  }, [resources]);

  // Get selected items for display
  const selectedPractitioners = practitioners.filter((p) =>
    selectedPractitionerIds.includes(p.id)
  );
  const selectedResources = resources.filter((r) =>
    selectedResourceIds.includes(r.id)
  );

  // Calculate all IDs for color indexing (practitioners + resources)
  const allPractitionerIds = useMemo(() => {
    return currentUserId && isPractitioner
      ? [currentUserId, ...selectedPractitionerIds]
      : selectedPractitionerIds;
  }, [currentUserId, isPractitioner, selectedPractitionerIds]);

  // Calculate color for resources (treat them as if they were practitioners)
  // Resources get colors after all practitioners, using the same color scheme
  const getResourceColor = useMemo(() => {
    const primaryId = (currentUserId && isPractitioner) ? currentUserId : null;
    return (resourceId: number): string => {
      return getResourceColorById(
        resourceId,
        allPractitionerIds,
        selectedResourceIds,
        primaryId
      );
    };
  }, [allPractitionerIds, selectedResourceIds, currentUserId, isPractitioner]);

  // Get chip colors for practitioners
  const practitionerChipColors = useMemo(() => {
    const primaryId = (currentUserId && isPractitioner) ? currentUserId : -1;
    
    return selectedPractitioners.map((p) => {
      const color = getPractitionerColor(p.id, primaryId, allPractitionerIds);
      
      if (!color) {
        return {
          id: p.id,
          bg: 'bg-blue-100',
          text: 'text-blue-800',
          border: 'border-blue-200',
          practitionerColor: null
        };
      }

      return {
        id: p.id,
        bg: '',
        text: 'text-white',
        border: '',
        practitionerColor: color
      };
    });
  }, [selectedPractitioners, currentUserId, isPractitioner, allPractitionerIds]);

  // Get chip colors for resources
  const resourceChipColors = useMemo(() => {
    return selectedResources.map((r) => {
      const color = getResourceColor(r.id);
      return {
        id: r.id,
        resourceColor: color,
      };
    });
  }, [selectedResources, getResourceColor]);

  const handleTogglePractitioner = (practitionerId: number) => {
    if (selectedPractitionerIds.includes(practitionerId)) {
      onPractitionerChange(selectedPractitionerIds.filter((id) => id !== practitionerId));
      setErrorMessage(null);
    } else {
      if (selectedPractitionerIds.length >= maxSelectablePractitioners) {
        setErrorMessage(`最多只能選擇 ${maxSelectablePractitioners} 位治療師，請先移除其他治療師`);
        setTimeout(() => setErrorMessage(null), 3000);
        return;
      }
      onPractitionerChange([...selectedPractitionerIds, practitionerId]);
      setErrorMessage(null);
    }
  };

  const handleToggleResource = (resourceId: number) => {
    if (selectedResourceIds.includes(resourceId)) {
      onResourceChange(selectedResourceIds.filter((id) => id !== resourceId));
      setErrorMessage(null);
    } else {
      if (selectedResourceIds.length >= maxSelectableResources) {
        setErrorMessage(`最多只能選擇 ${maxSelectableResources} 個資源，請先移除其他資源`);
        setTimeout(() => setErrorMessage(null), 3000);
        return;
      }
      onResourceChange([...selectedResourceIds, resourceId]);
      setErrorMessage(null);
    }
  };

  const handleRemovePractitioner = (practitionerId: number) => {
    onPractitionerChange(selectedPractitionerIds.filter((id) => id !== practitionerId));
  };

  const handleRemoveResource = (resourceId: number) => {
    onResourceChange(selectedResourceIds.filter((id) => id !== resourceId));
  };

  if (availablePractitioners.length === 0 && resources.length === 0) {
    return null;
  }

  // List view
  if (showAsList) {
    return (
      <div className="w-full">
        <div className="flex flex-col gap-2">
          {errorMessage && (
            <div className="bg-red-50 border border-red-200 rounded-md p-2 text-sm text-red-800">
              {errorMessage}
            </div>
          )}
          
          <div className="space-y-4">
            {/* Practitioners section */}
            {availablePractitioners.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  治療師
                </label>
                <div className="space-y-2">
                  {availablePractitioners.map((practitioner) => {
                    const isSelected = selectedPractitionerIds.includes(practitioner.id);
                    const isDisabled = !isSelected && selectedPractitionerIds.length >= maxSelectablePractitioners;
                    
                    return (
                      <button
                        key={practitioner.id}
                        type="button"
                        onClick={() => handleTogglePractitioner(practitioner.id)}
                        disabled={isDisabled}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border-2 transition-colors ${
                          isSelected
                            ? 'bg-primary-50 border-primary-500 text-primary-900'
                            : isDisabled
                            ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
                            : 'bg-white border-gray-200 text-gray-700 hover:border-primary-300 hover:bg-gray-50'
                        } disabled:opacity-50`}
                      >
                        <span className="font-medium">{practitioner.full_name}</span>
                        {isSelected && (
                          <svg
                            className="w-5 h-5 text-primary-600"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Resources section */}
            {!loadingResourceTypes && resources.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  資源
                </label>
                <div className="space-y-3">
                  {resourceTypes.map((type) => {
                    const typeResources = resourcesByType[type.id] || [];
                    if (typeResources.length === 0) return null;

                    return (
                      <div key={type.id} className="space-y-2">
                        <div className="text-xs font-medium text-gray-500 px-2">
                          {type.name}
                        </div>
                        {typeResources.map((resource) => {
                          const isSelected = selectedResourceIds.includes(resource.id);
                          const isDisabled = !isSelected && selectedResourceIds.length >= maxSelectableResources;
                          
                          return (
                            <button
                              key={resource.id}
                              type="button"
                              onClick={() => handleToggleResource(resource.id)}
                              disabled={isDisabled}
                              className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border-2 transition-colors ${
                                isSelected
                                  ? 'bg-primary-50 border-primary-500 text-primary-900'
                                  : isDisabled
                                  ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
                                  : 'bg-white border-gray-200 text-gray-700 hover:border-primary-300 hover:bg-gray-50'
                              } disabled:opacity-50`}
                            >
                              <span className="font-medium">{resource.name}</span>
                              {isSelected && (
                                <svg
                                  className="w-5 h-5 text-primary-600"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M5 13l4 4L19 7"
                                  />
                                </svg>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Dropdown view
  return (
    <div className="relative w-full" ref={dropdownRef}>
      <div className="flex flex-col gap-2">
        {errorMessage && (
          <div className="bg-red-50 border border-red-200 rounded-md p-2 text-sm text-red-800">
            {errorMessage}
          </div>
        )}
        
        <div className="flex flex-wrap gap-2 items-center w-full">
          {/* Selected practitioners as chips */}
          {selectedPractitioners.map((practitioner) => {
            const chipColor = practitionerChipColors.find(c => c.id === practitioner.id);
            const chipStyle = chipColor?.practitionerColor && chipColor.bg === ''
              ? {
                  backgroundColor: chipColor.practitionerColor,
                  borderColor: chipColor.practitionerColor,
                }
              : undefined;
            
            const chipClassName = chipColor?.bg
              ? `inline-flex items-center px-2 md:px-3 py-1 rounded-full text-xs md:text-sm font-medium ${chipColor.bg} ${chipColor.text} border ${chipColor.border}`
              : 'inline-flex items-center px-2 md:px-3 py-1 rounded-full text-xs md:text-sm font-medium border';
            
            return (
              <span
                key={practitioner.id}
                className={chipClassName}
                style={chipStyle}
              >
                {practitioner.full_name}
                <button
                  type="button"
                  onClick={() => handleRemovePractitioner(practitioner.id)}
                  className={`ml-2 inline-flex items-center justify-center w-4 h-4 rounded-full ${
                    chipColor?.practitionerColor
                      ? 'text-white hover:opacity-80'
                      : 'text-primary-600 hover:bg-primary-200'
                  } focus:outline-none focus:ring-2 focus:ring-primary-500`}
                  aria-label={`移除 ${practitioner.full_name}`}
                >
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </span>
            );
          })}

          {/* Selected resources as chips */}
          {selectedResources.map((resource) => {
            const colorInfo = resourceChipColors.find(c => c.id === resource.id);
            const resourceColor = colorInfo?.resourceColor || '#6B7280';
            
            return (
              <span
                key={resource.id}
                className="inline-flex items-center px-2 md:px-3 py-1 rounded-full text-xs md:text-sm font-medium border"
                style={{
                  backgroundColor: resourceColor,
                  borderColor: resourceColor,
                  color: 'white',
                }}
              >
                {resource.name}
                <button
                  type="button"
                  onClick={() => handleRemoveResource(resource.id)}
                  className="ml-2 inline-flex items-center justify-center w-4 h-4 rounded-full text-white hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  aria-label={`移除 ${resource.name}`}
                >
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </span>
            );
          })}

          {/* Dropdown button */}
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="flex-1 md:flex-initial inline-flex items-center justify-center px-3 py-2 rounded-md text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            aria-expanded={isOpen}
            aria-haspopup="true"
          >
            <span className="mr-2 whitespace-nowrap">加入行事曆</span>
            <svg
              className={`h-4 w-4 text-gray-500 transition-transform ${
                isOpen ? 'transform rotate-180' : ''
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Dropdown menu */}
      {isOpen && (
        <div 
          ref={dropdownMenuRef}
          className="absolute z-[60] w-full md:w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none"
        >
          <div className="py-1 max-h-64 overflow-y-auto" role="menu">
            {/* Practitioners section */}
            {availablePractitioners.length > 0 && (
              <>
                <div className="px-4 py-2 text-xs font-medium text-gray-500 bg-gray-50 border-b">
                  治療師
                </div>
                {availablePractitioners.map((practitioner) => {
                  const isSelected = selectedPractitionerIds.includes(practitioner.id);
                  const isDisabled = !isSelected && selectedPractitionerIds.length >= maxSelectablePractitioners;
                  return (
                    <button
                      key={practitioner.id}
                      type="button"
                      onClick={() => handleTogglePractitioner(practitioner.id)}
                      disabled={isDisabled}
                      className={`${
                        isSelected
                          ? 'bg-primary-50 text-primary-900'
                          : isDisabled
                          ? 'text-gray-400 cursor-not-allowed'
                          : 'text-gray-700 hover:bg-gray-50'
                      } flex items-center px-4 py-2 text-sm w-full text-left disabled:opacity-50`}
                      role="menuitem"
                      title={isDisabled ? `最多只能選擇 ${maxSelectablePractitioners} 位治療師` : undefined}
                    >
                      <span>{practitioner.full_name}</span>
                    </button>
                  );
                })}
              </>
            )}

            {/* Resources section */}
            {!loadingResourceTypes && resources.length > 0 && (
              <>
                <div className="px-4 py-2 text-xs font-medium text-gray-500 bg-gray-50 border-b border-t">
                  資源
                </div>
                {resourceTypes.map((type) => {
                  const typeResources = resourcesByType[type.id] || [];
                  if (typeResources.length === 0) return null;

                  return (
                    <div key={type.id}>
                      <div className="px-4 py-1 text-xs text-gray-500 bg-gray-50">
                        {type.name}
                      </div>
                      {typeResources.map((resource) => {
                        const isSelected = selectedResourceIds.includes(resource.id);
                        const isDisabled = !isSelected && selectedResourceIds.length >= maxSelectableResources;
                        return (
                          <button
                            key={resource.id}
                            type="button"
                            onClick={() => handleToggleResource(resource.id)}
                            disabled={isDisabled}
                            className={`${
                              isSelected
                                ? 'bg-primary-50 text-primary-900'
                                : isDisabled
                                ? 'text-gray-400 cursor-not-allowed'
                                : 'text-gray-700 hover:bg-gray-50'
                            } flex items-center px-6 py-2 text-sm w-full text-left disabled:opacity-50`}
                            role="menuitem"
                            title={isDisabled ? `最多只能選擇 ${maxSelectableResources} 個資源` : undefined}
                          >
                            <span>{resource.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </>
            )}

            {/* Limit messages */}
            {selectedPractitionerIds.length >= maxSelectablePractitioners && (
              <div className="px-4 py-2 text-xs text-gray-500 border-t border-gray-200">
                治療師已達上限 ({maxSelectablePractitioners} 位)
              </div>
            )}
            {selectedResourceIds.length >= maxSelectableResources && (
              <div className="px-4 py-2 text-xs text-gray-500 border-t border-gray-200">
                資源已達上限 ({maxSelectableResources} 個)
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarSelector;


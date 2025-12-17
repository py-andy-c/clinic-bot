import React, { useState, useEffect, useRef } from 'react';
import { Resource } from '../types';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';

interface ResourceSelectorProps {
  selectedResourceIds: number[];
  onChange: (resourceIds: number[]) => void;
  maxSelectable?: number; // Maximum number of resources that can be selected
  showAsList?: boolean; // If true, show all resources as a list instead of dropdown
}

const ResourceSelector: React.FC<ResourceSelectorProps> = ({
  selectedResourceIds,
  onChange,
  maxSelectable = 10, // Default limit of 10 resources
  showAsList = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownMenuRef = useRef<HTMLDivElement>(null);

  // Load all resources on mount
  useEffect(() => {
    const loadResources = async () => {
      try {
        setLoading(true);
        // Fetch all resource types
        const resourceTypesResponse = await apiService.getResourceTypes();
        const resourceTypes = resourceTypesResponse.resource_types;

        // Fetch all resources for each type
        const allResources: Resource[] = [];
        for (const resourceType of resourceTypes) {
          try {
            const resourcesResponse = await apiService.getResources(resourceType.id);
            // Filter out deleted resources
            const activeResources = resourcesResponse.resources.filter(r => !r.is_deleted);
            allResources.push(...activeResources);
          } catch (err) {
            logger.error(`Failed to load resources for type ${resourceType.id}:`, err);
          }
        }

        setResources(allResources);
      } catch (err) {
        logger.error('Failed to load resources:', err);
      } finally {
        setLoading(false);
      }
    };

    loadResources();
  }, []);

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

  // Get selected resource names for display
  const selectedResources = resources.filter((r) =>
    selectedResourceIds.includes(r.id)
  );

  const handleToggleResource = (resourceId: number) => {
    if (selectedResourceIds.includes(resourceId)) {
      // Remove resource
      onChange(selectedResourceIds.filter((id) => id !== resourceId));
      setErrorMessage(null);
    } else {
      // Check if we've reached the limit
      if (selectedResourceIds.length >= maxSelectable) {
        setErrorMessage(`最多只能選擇 ${maxSelectable} 個資源，請先移除其他資源`);
        setTimeout(() => setErrorMessage(null), 3000);
        return;
      }
      // Add resource
      onChange([...selectedResourceIds, resourceId]);
      setErrorMessage(null);
    }
  };

  const handleRemoveResource = (resourceId: number) => {
    onChange(selectedResourceIds.filter((id) => id !== resourceId));
  };

  if (loading) {
    return <div className="text-sm text-gray-500">載入中...</div>;
  }

  if (resources.length === 0) {
    return null;
  }

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
          
          <div className="space-y-2">
            {resources.map((resource) => {
              const isSelected = selectedResourceIds.includes(resource.id);
              const isDisabled = !isSelected && selectedResourceIds.length >= maxSelectable;
              
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
            {selectedResourceIds.length >= maxSelectable && (
              <div className="px-4 py-2 text-xs text-gray-500 text-center">
                已達上限 ({maxSelectable} 個)
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
          {/* Selected resources as chips */}
          {selectedResources.map((resource) => {
            return (
              <span
                key={resource.id}
                className="inline-flex items-center px-2 md:px-3 py-1 rounded-full text-xs md:text-sm font-medium border border-gray-300 bg-gray-50 text-gray-700"
              >
                {resource.name}
                <button
                  type="button"
                  onClick={() => handleRemoveResource(resource.id)}
                  className="ml-2 inline-flex items-center justify-center w-4 h-4 rounded-full text-gray-600 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
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
            <span className="mr-2 whitespace-nowrap">加入資源</span>
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
            {resources.map((resource) => {
              const isSelected = selectedResourceIds.includes(resource.id);
              const isDisabled = !isSelected && selectedResourceIds.length >= maxSelectable;
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
                  } flex items-center px-4 py-2 text-sm w-full text-left disabled:opacity-50`}
                  role="menuitem"
                  title={isDisabled ? `最多只能選擇 ${maxSelectable} 個資源` : undefined}
                >
                  <span>{resource.name}</span>
                </button>
              );
            })}
            {selectedResourceIds.length >= maxSelectable && (
              <div className="px-4 py-2 text-xs text-gray-500 border-t border-gray-200">
                已達上限 ({maxSelectable} 個)
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ResourceSelector;


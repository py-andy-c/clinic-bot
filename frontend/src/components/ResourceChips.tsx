import React from 'react';
import { Resource } from '../types';
import { getResourceColorById } from '../utils/resourceColorUtils';

interface ResourceChipsProps {
  resources: Resource[];
  selectedResourceIds: number[];
  onRemove: (resourceId: number) => void;
  // For color calculation - resources use same colors as practitioners
  allPractitionerIds?: number[]; // All practitioner IDs (for color indexing)
  primaryUserId?: number | null; // Primary user ID (for color indexing)
}

const ResourceChips: React.FC<ResourceChipsProps> = ({
  resources,
  selectedResourceIds,
  onRemove,
  allPractitionerIds = [],
  primaryUserId = null,
}) => {
  // All hooks must be called before any conditional returns
  // Get selected resources
  const selectedResources = resources.filter((r) =>
    selectedResourceIds.includes(r.id)
  );

  // Calculate colors for resources using the same scheme as practitioners
  // Resources get colors after all practitioners
  const chipColors = React.useMemo(() => {
    return selectedResources.map((r) => {
      const color = getResourceColorById(
        r.id,
        allPractitionerIds,
        selectedResourceIds,
        primaryUserId
      );
      return {
        id: r.id,
        resourceColor: color,
      };
    });
  }, [selectedResources, selectedResourceIds, allPractitionerIds, primaryUserId]);

  if (selectedResources.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 mb-2 pl-2">
      {selectedResources.map((resource) => {
        const colorInfo = chipColors.find(c => c.id === resource.id);
        const resourceColor = colorInfo?.resourceColor || '#6B7280';
        
        return (
          <div
            key={resource.id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm font-medium border"
            style={{
              backgroundColor: resourceColor,
              borderColor: resourceColor,
              color: 'white',
            }}
          >
            <span>{resource.name}</span>
            <button
              onClick={() => onRemove(resource.id)}
              className="ml-0.5 rounded-full p-0.5 focus:outline-none focus:ring-1 focus:ring-offset-1 text-white hover:opacity-80"
              aria-label={`移除 ${resource.name}`}
            >
              <span className="text-xs">×</span>
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default ResourceChips;


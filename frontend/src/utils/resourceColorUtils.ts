/**
 * Utility functions for calculating resource colors using the extended calendar color palette.
 * Resources get colors from the secondary set (colors 10-19) in the 20-color palette.
 */

import { generateResourceColors } from './practitionerColors';

/**
 * Calculate the color for a resource using the secondary color set (colors 10-19).
 * Resources get colors from the dedicated resource palette, independent of practitioners.
 *
 * @param resourceIndex - The index of the resource in the selected resources array
 * @param selectedResourceIds - Array of all selected resource IDs
 * @returns The color string for the resource
 */
export function getResourceColor(
  resourceIndex: number,
  selectedResourceIds: number[]
): string {
  // Fallback if resource not found
  if (resourceIndex === -1 || resourceIndex >= selectedResourceIds.length) {
    return '#6B7280';
  }

  // Resources get colors from the secondary set (colors 10-19)
  const resourceColors = generateResourceColors(selectedResourceIds.length);
  return resourceColors[resourceIndex] || '#6B7280';
}

/**
 * Calculate resource color with automatic index lookup.
 *
 * @param resourceId - The ID of the resource
 * @param selectedResourceIds - Array of all selected resource IDs
 * @returns The color string for the resource
 */
export function getResourceColorById(
  resourceId: number,
  selectedResourceIds: number[]
): string {
  const resourceIndex = selectedResourceIds.indexOf(resourceId);
  return getResourceColor(
    resourceIndex,
    selectedResourceIds
  );
}


/**
 * Utility functions for calculating resource colors using the practitioner color scheme.
 * Resources get colors after all practitioners in the same color array.
 */

import { generatePractitionerColors } from './practitionerColors';

/**
 * Calculate the color for a resource based on its position relative to practitioners.
 * Resources are assigned colors after all practitioners in the same color scheme.
 * 
 * @param resourceIndex - The index of the resource in the selected resources array
 * @param allPractitionerIds - Array of all practitioner IDs (including primary)
 * @param selectedResourceIds - Array of all selected resource IDs
 * @param primaryUserId - The primary user ID (if exists, its color is skipped)
 * @returns The color string for the resource
 */
export function getResourceColor(
  resourceIndex: number,
  allPractitionerIds: number[],
  selectedResourceIds: number[],
  primaryUserId: number | null
): string {
  // Fallback if resource not found
  if (resourceIndex === -1) {
    return '#6B7280';
  }

  const hasPrimary = primaryUserId !== null && primaryUserId !== -1;
  const totalItems = allPractitionerIds.length + selectedResourceIds.length;
  const colorCount = hasPrimary
    ? Math.max(totalItems - 1, 1)
    : Math.max(totalItems, 1);

  const colorArray = generatePractitionerColors(colorCount);
  
  // Resource color index starts after practitioners
  const virtualPosition = allPractitionerIds.length + resourceIndex;
  
  // Calculate which color index to use (skip primary if exists)
  const colorIndex = hasPrimary
    ? Math.max(virtualPosition - 1, 0)  // Skip primary practitioner color (index 0)
    : virtualPosition;
  
  return colorArray[colorIndex % colorArray.length] || '#6B7280';
}

/**
 * Calculate resource color with automatic index lookup.
 * 
 * @param resourceId - The ID of the resource
 * @param allPractitionerIds - Array of all practitioner IDs (including primary)
 * @param selectedResourceIds - Array of all selected resource IDs
 * @param primaryUserId - The primary user ID (if exists, its color is skipped)
 * @returns The color string for the resource
 */
export function getResourceColorById(
  resourceId: number,
  allPractitionerIds: number[],
  selectedResourceIds: number[],
  primaryUserId: number | null
): string {
  const resourceIndex = selectedResourceIds.indexOf(resourceId);
  return getResourceColor(
    resourceIndex,
    allPractitionerIds,
    selectedResourceIds,
    primaryUserId
  );
}


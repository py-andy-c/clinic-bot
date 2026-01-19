/**
 * Utility functions for generating colors for practitioners and resources in calendar view
 * Implements the exact 20-color palette specified in the design document
 */

// Extended 20-color palette: 10 primary (practitioners) + 10 secondary (resources) colors
export const CALENDAR_COLORS = [
  // Primary set (practitioners - first 10)
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
  // Secondary set (resources - next 10)
  '#7c3aed', '#be123c', '#ea580c', '#65a30d', '#0891b2',
  '#c2410c', '#7c2d12', '#365314', '#1e3a8a', '#581c87'
];

/**
 * Get colors for practitioners (first 10 colors from the palette)
 * @param count - Number of colors needed (max 10)
 * @returns Array of color strings for practitioners
 */
export const generatePractitionerColors = (count: number): string[] => {
  return CALENDAR_COLORS.slice(0, Math.min(count, 10));
};

/**
 * Get colors for resources (next 10 colors from the palette)
 * @param count - Number of colors needed (max 10)
 * @returns Array of color strings for resources
 */
export const generateResourceColors = (count: number): string[] => {
  return CALENDAR_COLORS.slice(10, 10 + Math.min(count, 10));
};

/**
 * Get the color for a specific practitioner using the primary color set (colors 0-9)
 * @param practitionerId - ID of the practitioner
 * @param primaryUserId - ID of the primary practitioner (uses blue). Use -1 if no primary.
 * @param allPractitionerIds - Array of all practitioner IDs (primary + additional)
 * @returns Color string for the practitioner, or null if primary
 */
export const getPractitionerColor = (
  practitionerId: number,
  primaryUserId: number,
  allPractitionerIds: number[]
): string | null => {
  // Primary practitioner uses blue (null = blue)
  if (primaryUserId !== -1 && practitionerId === primaryUserId) {
    return null;
  }

  // Practitioners get colors from the primary set (colors 0-9)
  // Calculate the position in the selected practitioners array (excluding primary)
  const selectedPractitioners = allPractitionerIds.filter(id => id !== primaryUserId);
  const selectedIndex = selectedPractitioners.indexOf(practitionerId);

  if (selectedIndex === -1) {
    return '#6B7280'; // Fallback color
  }

  // Get practitioner colors and return the appropriate one
  const practitionerColors = generatePractitionerColors(selectedPractitioners.length);
  return practitionerColors[selectedIndex] || '#6B7280';
};



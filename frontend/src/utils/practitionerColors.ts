/**
 * Utility functions for generating colors for practitioners in calendar view
 */

/**
 * Generate dynamic colors for practitioners
 * @param count - Number of colors to generate
 * @returns Array of color strings (hex or hsl)
 */
export const generatePractitionerColors = (count: number): string[] => {
  if (count <= 6) {
    // Use predefined colors for small counts
    return [
      '#10B981', // Green
      '#F59E0B', // Amber
      '#EF4444', // Red
      '#8B5CF6', // Purple
      '#EC4899', // Pink
      '#06B6D4', // Cyan
    ];
  }
  
  // Generate colors dynamically using HSL for better distribution
  const colors: string[] = [];
  const hueStep = 360 / count;
  for (let i = 0; i < count; i++) {
    const hue = (i * hueStep) % 360;
    // Use medium saturation and lightness for good visibility
    colors.push(`hsl(${hue}, 65%, 50%)`);
  }
  return colors;
};

/**
 * Get the color for a specific practitioner
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
  const practitionerIndex = allPractitionerIds.indexOf(practitionerId);
  
  // Primary practitioner uses blue (null = blue)
  if (primaryUserId !== -1 && practitionerId === primaryUserId) {
    return null;
  }
  
  // Calculate color count and get color
  const hasPrimary = primaryUserId !== -1;
  const colorCount = hasPrimary
    ? Math.max(allPractitionerIds.length - 1, 1)
    : Math.max(allPractitionerIds.length, 1);
  const colors = generatePractitionerColors(colorCount);
  
  // Get color index (skip primary if exists)
  const colorIndex = hasPrimary && practitionerIndex > 0
    ? practitionerIndex - 1
    : practitionerIndex;
  
  return colors[colorIndex % colors.length] || null;
};



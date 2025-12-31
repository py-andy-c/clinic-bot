/**
 * Utility functions for generating colors for resources in calendar view
 */

/**
 * Generate dynamic colors for resources
 * @param count - Number of colors to generate
 * @returns Array of color strings (hex or hsl)
 */
export const generateResourceColors = (count: number): string[] => {
  if (count <= 6) {
    // Use predefined colors for small counts (different from practitioners for visual distinction)
    return [
      '#059669', // Emerald
      '#DC2626', // Red
      '#7C3AED', // Violet
      '#EA580C', // Orange
      '#0891B2', // Sky
      '#BE185D', // Rose
    ];
  }
  
  // Generate colors dynamically using HSL for better distribution
  // Use different hue range than practitioners for visual distinction
  const colors: string[] = [];
  const hueStep = 360 / count;
  const hueOffset = 30; // Offset to distinguish from practitioner colors
  for (let i = 0; i < count; i++) {
    const hue = ((i * hueStep) + hueOffset) % 360;
    // Use medium saturation and lightness for good visibility
    colors.push(`hsl(${hue}, 70%, 45%)`);
  }
  return colors;
};

/**
 * Get the color for a specific resource
 * @param resourceId - ID of the resource
 * @param allResourceIds - Array of all resource IDs
 * @returns Color string for the resource
 */
export const getResourceColor = (
  resourceId: number,
  allResourceIds: number[]
): string => {
  const resourceIndex = allResourceIds.indexOf(resourceId);
  
  if (resourceIndex === -1) {
    // Fallback color if resource not found
    return '#6B7280'; // Gray
  }
  
  // Calculate color count and get color
  const colorCount = Math.max(allResourceIds.length, 1);
  const colors = generateResourceColors(colorCount);
  
  return colors[resourceIndex % colors.length] || '#6B7280';
};




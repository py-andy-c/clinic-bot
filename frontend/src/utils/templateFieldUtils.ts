/**
 * Utility functions for medical record template field processing
 */

/**
 * Process field options from string or array format to array format
 * Used for dropdown, radio, and checkbox field types
 * 
 * @param field - Template field with options
 * @returns Array of option strings, or undefined if field doesn't support options
 */
export const processFieldOptions = (
  field: { type: string; options?: string | string[] | undefined }
): string[] | undefined => {
  const supportsOptions = ['dropdown', 'radio', 'checkbox'].includes(field.type);
  
  if (!supportsOptions) {
    return undefined;
  }
  
  // Handle string format (newline-separated)
  if (typeof field.options === 'string' && field.options.trim()) {
    return field.options
      .split('\n')
      .map(opt => opt.trim())
      .filter(opt => opt.length > 0);
  }
  
  // Handle array format
  if (Array.isArray(field.options)) {
    return field.options;
  }
  
  return undefined;
};

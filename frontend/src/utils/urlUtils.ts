/**
 * URL utility functions for preserving query parameters.
 * 
 * This helps prevent bugs where important URL parameters (like clinic_id)
 * are accidentally lost during URL updates.
 */

/**
 * Preserves specified query parameters while updating URL.
 * 
 * @param pathname - URL pathname
 * @param paramsToSet - Parameters to set/update
 * @param paramsToPreserve - Parameters to preserve (default: ['clinic_id'])
 * @returns New URL string with preserved and updated parameters
 * 
 * @example
 * ```typescript
 * // Preserve clinic_id while updating mode
 * const newUrl = preserveQueryParams('/liff', { mode: 'book' });
 * // Result: '/liff?clinic_id=123&mode=book'
 * ```
 */
export const preserveQueryParams = (
  pathname: string,
  paramsToSet: Record<string, string>,
  paramsToPreserve: string[] = ['clinic_id']
): string => {
  const urlParams = new URLSearchParams(window.location.search);
  
  // Preserve specified params
  paramsToPreserve.forEach(param => {
    const value = urlParams.get(param);
    if (value) {
      urlParams.set(param, value);
    }
  });
  
  // Set new params (overwrites existing if present)
  Object.entries(paramsToSet).forEach(([key, value]) => {
    urlParams.set(key, value);
  });
  
  return `${pathname}?${urlParams.toString()}`;
};


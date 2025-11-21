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
 * @param paramsToPreserve - Parameters to preserve (default: ['clinic_token', 'clinic_id'])
 * @returns New URL string with preserved and updated parameters
 * 
 * @example
 * ```typescript
 * // Preserve clinic_token while updating mode
 * const newUrl = preserveQueryParams('/liff', { mode: 'book' });
 * // Result: '/liff?clinic_token=...&mode=book'
 * ```
 */
export const preserveQueryParams = (
  pathname: string,
  paramsToSet: Record<string, string>,
  paramsToPreserve: string[] = ['clinic_token', 'clinic_id']  // Support both during migration
): string => {
  const urlParams = new URLSearchParams();

  // Preserve specified params from current URL
  const currentParams = new URLSearchParams(window.location.search);

  // Preserve clinic_token/clinic_id only if they're in the preserve list (or default)
  // Check if clinic_token or clinic_id should be preserved
  const shouldPreserveToken = paramsToPreserve.includes('clinic_token');
  const shouldPreserveId = paramsToPreserve.includes('clinic_id');

  if (shouldPreserveToken || shouldPreserveId) {
    // Prioritize clinic_token if both are present in current URL
    const currentToken = currentParams.get('clinic_token');
    const currentId = currentParams.get('clinic_id');

    if (shouldPreserveToken && currentToken) {
      urlParams.set('clinic_token', currentToken);
    } else if (shouldPreserveId && currentId) {
      urlParams.set('clinic_id', currentId);
    }
  }

  // Preserve other specified params, ensuring clinic_token/id are not overwritten if already set
  paramsToPreserve.forEach(param => {
    if (param !== 'clinic_token' && param !== 'clinic_id') {
      const value = currentParams.get(param);
      if (value) {
        urlParams.set(param, value);
      }
    }
  });

  // Set new params (overwrites existing if present)
  Object.entries(paramsToSet).forEach(([key, value]) => {
    urlParams.set(key, value);
  });

  return `${pathname}?${urlParams.toString()}`;
};


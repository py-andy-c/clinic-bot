/**
 * URL utility functions for preserving query parameters.
 * 
 * This helps prevent bugs where important URL parameters (like clinic_token)
 * are accidentally lost during URL updates.
 */

/**
 * Preserves specified query parameters while updating URL.
 * 
 * @param pathname - URL pathname
 * @param paramsToSet - Parameters to set/update
 * @param paramsToPreserve - Parameters to preserve (default: ['clinic_token'])
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
  paramsToPreserve: string[] = ['clinic_token']  // Only clinic_token, clinic_id removed
): string => {
  const urlParams = new URLSearchParams();

  // Preserve specified params from current URL
  const currentParams = new URLSearchParams(window.location.search);

  // Preserve clinic_token if it's in the preserve list (or default)
  if (paramsToPreserve.includes('clinic_token')) {
    const currentToken = currentParams.get('clinic_token');
    if (currentToken) {
      urlParams.set('clinic_token', currentToken);
    }
  }

  // Preserve other specified params, ensuring clinic_token is not overwritten if already set
  paramsToPreserve.forEach(param => {
    if (param !== 'clinic_token') {
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


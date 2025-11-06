/**
 * useApiData Hook
 * 
 * A reusable hook for fetching data from APIs with standardized loading, error, and data states.
 * 
 * Features:
 * - Automatic fetching on mount (with optional dependencies)
 * - Manual refetch capability
 * - Standardized error handling
 * - Loading state management
 * - Optional initial data
 * - Custom error messages
 * 
 * @important
 * The `fetchFn` function should be stable (use `useCallback` in components) to avoid
 * unnecessary refetches. If `fetchFn` changes on every render, it will trigger a refetch.
 * 
 * @example
 * ```tsx
 * const fetchPatients = useCallback(() => apiService.getPatients(), []);
 * 
 * const { data, loading, error, refetch } = useApiData(
 *   fetchPatients,
 *   {
 *     enabled: isAuthenticated,
 *     dependencies: [isAuthenticated],
 *     defaultErrorMessage: '無法載入病患列表'
 *   }
 * );
 * ```
 * 
 * @future
 * Potential enhancements for future versions:
 * - Caching support
 * - Retry logic
 * - Polling support
 * - Optimistic updates helper
 * - Integration with React Query (if needed)
 * - Request cancellation
 * - Debouncing/throttling
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { logger } from '../utils/logger';
import { ApiErrorType, getErrorMessage } from '../types';

export interface UseApiDataOptions<T> {
  /**
   * Whether to automatically fetch data on mount and when dependencies change.
   * @default true
   */
  enabled?: boolean;

  /**
   * Dependencies array - refetch when these values change.
   * Similar to useEffect dependencies.
   */
  dependencies?: React.DependencyList;

  /**
   * Initial data value before first fetch completes.
   */
  initialData?: T;

  /**
   * Custom error message to display when fetch fails.
   * If not provided, uses getErrorMessage() to extract from error.
   */
  defaultErrorMessage?: string;

  /**
   * Callback fired when data is successfully fetched.
   */
  onSuccess?: (data: T) => void;

  /**
   * Callback fired when fetch fails.
   */
  onError?: (error: ApiErrorType) => void;

  /**
   * Whether to log errors automatically.
   * @default true
   */
  logErrors?: boolean;
}

export interface UseApiDataResult<T> {
  /**
   * The fetched data, or initialData if provided and no fetch has completed yet.
   */
  data: T | null;

  /**
   * Whether a fetch is currently in progress.
   */
  loading: boolean;

  /**
   * Error message string, or null if no error.
   */
  error: string | null;

  /**
   * Manually trigger a refetch of the data.
   */
  refetch: () => Promise<void>;

  /**
   * Clear the error state.
   */
  clearError: () => void;

  /**
   * Set data manually (useful for optimistic updates).
   */
  setData: (data: T | null) => void;
}

/**
 * Hook for fetching data from APIs with standardized state management.
 * 
 * @param fetchFn - Function that returns a Promise resolving to the data.
 *                  Should be stable (use `useCallback` in components) to avoid unnecessary refetches.
 * @param options - Configuration options
 * @returns Object containing data, loading, error states and refetch function
 * 
 * @note
 * The `useEffect` dependency array uses `eslint-disable-next-line react-hooks/exhaustive-deps`
 * because `dependencies` is explicitly passed by the caller and `performFetch` is memoized
 * with `useCallback` that includes `fetchFn` in its dependencies.
 */
export function useApiData<T>(
  fetchFn: () => Promise<T>,
  options: UseApiDataOptions<T> = {}
): UseApiDataResult<T> {
  const {
    enabled = true,
    dependencies = [],
    initialData,
    defaultErrorMessage,
    onSuccess,
    onError,
    logErrors = true,
  } = options;

  const [data, setData] = useState<T | null>(initialData ?? null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);

  // Track if component is mounted to avoid state updates after unmount
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const performFetch = useCallback(async () => {
    if (!enabled) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const result = await fetchFn();

      // Only update state if component is still mounted
      if (isMountedRef.current) {
        setData(result);
        setLoading(false);
        onSuccess?.(result);
      }
    } catch (err: ApiErrorType) {
      const errorMessage = defaultErrorMessage || getErrorMessage(err);

      // Only update state if component is still mounted
      if (isMountedRef.current) {
        setError(errorMessage);
        setLoading(false);
        onError?.(err);
      }

      if (logErrors) {
        logger.error('useApiData: Fetch error:', err);
      }
    }
  }, [fetchFn, enabled, defaultErrorMessage, onSuccess, onError, logErrors]);

  // Auto-fetch on mount and when dependencies change
  useEffect(() => {
    if (enabled) {
      performFetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...dependencies]);

  const refetch = useCallback(async () => {
    await performFetch();
  }, [performFetch]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    data,
    loading,
    error,
    refetch,
    clearError,
    setData,
  };
}


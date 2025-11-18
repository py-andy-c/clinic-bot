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

// Simple in-memory cache with TTL
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<any>>();
const DEFAULT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Track in-flight requests to deduplicate concurrent requests for the same data
const inFlightRequests = new Map<string, Promise<any>>();

function getCacheKey(fetchFn: () => Promise<any>): string {
  // Use function string representation as cache key
  // In production, you might want a more sophisticated key generation
  return fetchFn.toString();
}

// Export function to clear cache (useful for tests)
export function clearApiDataCache(): void {
  cache.clear();
  inFlightRequests.clear();
}

function getCached<T>(key: string, ttl: number): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  
  const age = Date.now() - entry.timestamp;
  if (age > ttl) {
    cache.delete(key);
    return null;
  }
  
  return entry.data as T;
}

function setCached<T>(key: string, data: T): void {
  cache.set(key, {
    data,
    timestamp: Date.now(),
  });
}

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

  /**
   * Cache TTL in milliseconds. Set to 0 to disable caching.
   * @default 300000 (5 minutes)
   */
  cacheTTL?: number;
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
    cacheTTL = DEFAULT_CACHE_TTL,
  } = options;

  const [data, setData] = useState<T | null>(initialData ?? null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);

  // Track if component is mounted to avoid state updates after unmount
  const isMountedRef = useRef(true);
  // Generate cache key synchronously to avoid race conditions
  const cacheKeyRef = useRef<string | null>(getCacheKey(fetchFn));

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Update cache key when fetchFn changes
  useEffect(() => {
    cacheKeyRef.current = getCacheKey(fetchFn);
  }, [fetchFn]);

  const performFetch = useCallback(async () => {
    if (!enabled) {
      return;
    }

    // Check cache first if caching is enabled and no initial data is set
    // (initial data takes precedence over cache)
    let hasCachedData = false;
    if (cacheTTL > 0 && cacheKeyRef.current && initialData === undefined) {
      const cached = getCached<T>(cacheKeyRef.current, cacheTTL);
      if (cached !== null) {
        hasCachedData = true;
        // Use cached data immediately
        if (isMountedRef.current) {
          setData(cached);
          setLoading(false);
          onSuccess?.(cached);
        }
        // Still fetch in background to refresh cache (stale-while-revalidate pattern)
        // But don't show loading state if we have cached data
      }
    }

    // Check if there's already an in-flight request for this cache key
    // This prevents duplicate concurrent requests (e.g., from React StrictMode)
    if (cacheKeyRef.current && inFlightRequests.has(cacheKeyRef.current)) {
      try {
        const result = await inFlightRequests.get(cacheKeyRef.current)!;
        // Reuse the result from the in-flight request
        if (isMountedRef.current) {
          setData(result);
          setLoading(false);
          onSuccess?.(result);
        }
        return;
      } catch (err) {
        // If the in-flight request failed, continue to make a new request
        inFlightRequests.delete(cacheKeyRef.current!);
      }
    }

    try {
      // Only show loading if we don't have cached data
      if (!hasCachedData) {
        setLoading(true);
      }
      setError(null);

      // Create the fetch promise and store it for deduplication
      const fetchPromise = fetchFn();
      if (cacheKeyRef.current) {
        inFlightRequests.set(cacheKeyRef.current, fetchPromise);
      }

      const result = await fetchPromise;

      // Cache the result if caching is enabled
      if (cacheTTL > 0 && cacheKeyRef.current) {
        setCached(cacheKeyRef.current, result);
      }

      // Remove from in-flight requests
      if (cacheKeyRef.current) {
        inFlightRequests.delete(cacheKeyRef.current);
      }

      // Only update state if component is still mounted
      if (isMountedRef.current) {
        setData(result);
        setLoading(false);
        onSuccess?.(result);
      }
    } catch (err: ApiErrorType) {
      // Remove from in-flight requests on error
      if (cacheKeyRef.current) {
        inFlightRequests.delete(cacheKeyRef.current);
      }
      const errorMessage = defaultErrorMessage || getErrorMessage(err);

      // Clear cache on error to prevent stale data
      if (cacheTTL > 0 && cacheKeyRef.current) {
        cache.delete(cacheKeyRef.current);
      }

      // Only update state if component is still mounted
      if (isMountedRef.current) {
        // Clear data on error (don't keep stale cached data)
        setData(null);
        setError(errorMessage);
        setLoading(false);
        onError?.(err);
      }

      if (logErrors) {
        logger.error('useApiData: Fetch error:', err);
      }
    }
  }, [fetchFn, enabled, defaultErrorMessage, onSuccess, onError, logErrors, cacheTTL, initialData]);

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


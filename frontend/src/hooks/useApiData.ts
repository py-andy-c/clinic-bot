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

import { useState, useEffect, useCallback, useRef, DependencyList } from 'react';
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
// Map to track locks for promise registration (prevents race conditions)
const registrationLocks = new Map<string, boolean>();

// Map to store cache keys for function string representations
// This ensures functions with identical code share the same cache key
const functionStringToKeyMap = new Map<string, string>();
let cacheKeyCounter = 0;

/**
 * Extract parameters from a function string
 * Handles patterns like: apiService.getPractitionerStatus(user.user_id)
 * Returns a normalized string representation of parameters
 */
function extractParameters(functionString: string): string | null {
  // Match the content inside parentheses after the method name
  // Pattern: .methodName(...params...)
  // Handles optional chaining: user?.user_id, user?.id, etc.
  const paramMatch = functionString.match(/\.\w+\s*\(([^)]*)\)/);
  if (!paramMatch || !paramMatch[1]) return null;
  
  const params = paramMatch[1].trim();
  if (!params) return null; // No parameters
  
  // Normalize the parameter string
  // Remove whitespace, normalize optional chaining (user?.user_id -> user.user_id for cache key)
  // Note: We normalize optional chaining to regular property access for cache key consistency
  let normalized = params.replace(/\s+/g, '').replace(/\?\./g, '.'); // user?.id -> user.id
  
  // Try to detect array literals like [1, 2, 3] or [user.id, other.id]
  // Handle nested arrays by recursively processing
  const processArray = (str: string): string => {
    const arrayMatch = str.match(/\[([^\]]+)\]/);
    if (arrayMatch && arrayMatch[1]) {
      // For arrays, sort and normalize the elements
      const elements = arrayMatch[1].split(',').map(e => {
        const trimmed = e.trim();
        // Recursively process nested arrays
        return trimmed.includes('[') ? processArray(trimmed) : trimmed;
      }).sort().join(',');
      return `[${elements}]`;
    }
    return str;
  };
  
  normalized = processArray(normalized);
  
  return normalized;
}

/**
 * Create a stable hash from a string (simple implementation)
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

function getCacheKey(fetchFn: () => Promise<any>, dependencies?: DependencyList): string {
  // Normalize function string to extract method name
  // This handles minification differences (e.g., xe.getClinicSettings() vs j.getClinicSettings())
  const functionString = fetchFn.toString();
  
  // Match common HTTP method patterns: get, post, put, patch, delete, update, create
  // Also handle batch methods like getBatchPractitionerStatus
  const methodMatch = functionString.match(/\.(get\w+|post\w+|put\w+|patch\w+|update\w+|create\w+|delete\w+)\s*\(/);
  
  if (methodMatch && methodMatch[1]) {
    const methodName = methodMatch[1];
    
    // Extract parameters to include in cache key
    const params = extractParameters(functionString);
    
    // Include dependencies in cache key if provided (for parameterized functions)
    // This ensures different IDs get different cache keys
    let dependencySuffix = '';
    if (dependencies && dependencies.length > 0) {
      // Create a stable string representation of dependencies
      // Include null/undefined values as special markers to differentiate cache keys
      // This is important: null vs undefined vs actual values should create different cache keys
      const depValues = dependencies
        .map(dep => {
          // Handle null and undefined explicitly (they are different values for cache purposes)
          if (dep === null) return '__null__';
          if (dep === undefined) return '__undefined__';
          
          if (Array.isArray(dep)) {
            // For arrays, sort elements for consistent cache keys
            // Handle arrays of primitives and objects
            try {
              const sorted = [...dep].sort((a, b) => {
                if (typeof a === 'number' && typeof b === 'number') return a - b;
                if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
                return String(a).localeCompare(String(b));
              });
              return JSON.stringify(sorted);
            } catch {
              return JSON.stringify(dep);
            }
          } else if (typeof dep === 'object' && dep !== null) {
            // For objects, use JSON stringify (sorted keys for consistency)
            try {
              return JSON.stringify(dep, Object.keys(dep).sort());
            } catch {
              return String(dep);
            }
          }
          return String(dep);
        })
        .join('|');

      if (depValues) {
        dependencySuffix = depValues.length > 50 ? `_${simpleHash(depValues)}` : `_${depValues}`;
      }
    }

    if (params) {
      // Parameterized function - include parameters and dependencies in cache key
      // Use hash for long parameter strings to keep keys manageable
      const paramHash = params.length > 50 ? simpleHash(params) : params;
      const normalizedKey = `api_${methodName}_${paramHash}${dependencySuffix}`;

      if (functionStringToKeyMap.has(normalizedKey)) {
        return functionStringToKeyMap.get(normalizedKey)!;
      }

      functionStringToKeyMap.set(normalizedKey, normalizedKey);
      return normalizedKey;
    } else {
      // Non-parameterized function - use method name and dependencies
      const normalizedKey = `api_${methodName}${dependencySuffix}`;

      if (functionStringToKeyMap.has(normalizedKey)) {
        return functionStringToKeyMap.get(normalizedKey)!;
      }

      functionStringToKeyMap.set(normalizedKey, normalizedKey);
      return normalizedKey;
    }
  }

  // Fallback for non-standard functions - use full function string and dependencies for uniqueness
  const fallbackKey = dependencies && dependencies.length > 0
    ? `${functionString}_${dependencies.map(d => {
        if (d === null) return '__null__';
        if (d === undefined) return '__undefined__';
        return String(d);
      }).join('|')}`
    : functionString;

  if (functionStringToKeyMap.has(fallbackKey)) {
    return functionStringToKeyMap.get(fallbackKey)!;
  }

  const key = `fn_${cacheKeyCounter++}_${fallbackKey.slice(0, 50)}`;
  functionStringToKeyMap.set(fallbackKey, key);
  return key;
}

// Export function to clear cache (useful for tests)
export function clearApiDataCache(): void {
  cache.clear();
  inFlightRequests.clear();
  registrationLocks.clear();
}

// Export function to invalidate cache for a specific fetch function
export function invalidateCacheForFunction(fetchFn: () => Promise<any>): void {
  const cacheKey = getCacheKey(fetchFn);
  cache.delete(cacheKey);
  // Note: We don't clear in-flight requests as they may be needed by other components
}

// Export function to invalidate cache by pattern (useful for parameterized functions)
export function invalidateCacheByPattern(pattern: string): void {
  const keysToDelete: string[] = [];
  for (const key of cache.keys()) {
    if (key.startsWith(pattern)) {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach(key => cache.delete(key));
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
  dependencies?: DependencyList;

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
  // Track active lock for cleanup on unmount
  const activeLockRef = useRef<string | null>(null);
  // Store latest dependencies in ref so performFetch always uses current values
  // without needing to be recreated on every render
  // Update synchronously on each render to ensure we always have the latest values
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies; // Update synchronously, not in effect

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Clean up any active locks on unmount
      if (activeLockRef.current) {
        registrationLocks.delete(activeLockRef.current);
        activeLockRef.current = null;
      }
    };
  }, []);

  const performFetch = useCallback(async () => {
    if (!enabled) {
      return;
    }

    // Check in-flight requests first to prevent race conditions
    // Compute cache key synchronously to ensure we use the latest key
    // Include dependencies in cache key to differentiate between different parameter values
    // Use ref to always get the latest dependencies without recreating this callback
    // dependenciesRef.current is updated synchronously on each render, so it's always current
    const currentDeps = dependenciesRef.current;
    const cacheKey = getCacheKey(fetchFn, currentDeps);
    if (cacheKey && inFlightRequests.has(cacheKey)) {
      try {
        const result = await inFlightRequests.get(cacheKey)!;
        if (isMountedRef.current) {
          setData(result);
          setLoading(false);
          onSuccess?.(result);
        }
        return;
      } catch (err) {
        // If the in-flight request failed, delete it and continue with a new fetch
        inFlightRequests.delete(cacheKey);
        // Re-throw the error so the component can handle it
        if (isMountedRef.current) {
          const errorMessage = err instanceof Error ? err.message : defaultErrorMessage || '載入資料時發生錯誤';
          setError(errorMessage);
          setLoading(false);
          onError?.(err);
          if (logErrors) {
            logger.error('In-flight request failed:', err);
          }
        }
        return; // Don't continue with a new fetch if the in-flight one failed
      }
    }

    // Check cache if caching is enabled
    // Use computed cache key consistently (not cacheKeyRef.current which may be stale)
    let hasCachedData = false;
    let cacheAge = 0;
    if (cacheTTL > 0 && cacheKey && initialData === undefined) {
      const cached = getCached<T>(cacheKey, cacheTTL);
      if (cached !== null) {
        hasCachedData = true;
        const cacheEntry = cache.get(cacheKey);
        if (cacheEntry) {
          cacheAge = Date.now() - cacheEntry.timestamp;
        }
        if (isMountedRef.current) {
          setData(cached);
          setLoading(false);
          onSuccess?.(cached);
        }
        // Check in-flight requests even for fresh cache to get latest data
        // Use the same cacheKey computed at the start
        if (cacheKey && inFlightRequests.has(cacheKey)) {
          try {
            const result = await inFlightRequests.get(cacheKey)!;
            if (isMountedRef.current) {
              setData(result);
              setLoading(false);
              onSuccess?.(result);
            }
            return;
          } catch (err) {
            // If in-flight request failed, continue with background fetch
            inFlightRequests.delete(cacheKey);
          }
        }
        
        // Skip background fetch if cache is very fresh (< 1 minute)
        const FRESH_CACHE_THRESHOLD = 60 * 1000;
        if (cacheAge < FRESH_CACHE_THRESHOLD) {
          return;
        }
      }
    }

    // No cache hit and no in-flight request - perform new fetch
    try {
      // Only show loading if we don't have cached data
      if (!hasCachedData) {
        setLoading(true);
      }
      setError(null);

      // Atomic check-and-set: Use a lock to prevent race conditions
      // This ensures only one component can register a promise for a given cache key
      // Use the cacheKey computed at the start of the function
      
      // Check if there's already an in-flight request
      if (cacheKey && inFlightRequests.has(cacheKey)) {
        try {
          const result = await inFlightRequests.get(cacheKey)!;
          if (isMountedRef.current) {
            setData(result);
            setLoading(false);
            onSuccess?.(result);
          }
          return;
        } catch (err) {
          // If the existing request failed, remove it and continue
          inFlightRequests.delete(cacheKey);
          registrationLocks.delete(cacheKey);
        }
      }
      
      // Check if another component is currently registering a promise
      // Use polling with retry limit to wait for registration
      if (cacheKey && registrationLocks.has(cacheKey)) {
        let attempts = 0;
        const maxAttempts = 50; // 500ms max wait (50 * 10ms)
        while (registrationLocks.has(cacheKey) && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 10));
          if (cacheKey && inFlightRequests.has(cacheKey)) {
            // Promise was registered, use it
            try {
              const result = await inFlightRequests.get(cacheKey)!;
              if (isMountedRef.current) {
                setData(result);
                setLoading(false);
                onSuccess?.(result);
              }
              return;
            } catch (err) {
              inFlightRequests.delete(cacheKey);
              registrationLocks.delete(cacheKey);
              break; // Exit loop and continue with new fetch
            }
          }
          attempts++;
        }
        // If we exit the loop without finding a promise, clear stale lock and continue
        if (cacheKey && registrationLocks.has(cacheKey) && !inFlightRequests.has(cacheKey)) {
          registrationLocks.delete(cacheKey);
        }
      }
      
      // Acquire lock and create promise
      if (!cacheKey) {
        // No cache key, fetch without caching
        const result = await fetchFn();
        if (isMountedRef.current) {
          setData(result);
          setLoading(false);
          onSuccess?.(result);
        }
        return;
      }
      
      registrationLocks.set(cacheKey, true);
      activeLockRef.current = cacheKey; // Track for cleanup
      try {
        // Double-check after acquiring lock
        if (inFlightRequests.has(cacheKey)) {
          const result = await inFlightRequests.get(cacheKey)!;
          if (isMountedRef.current) {
            setData(result);
            setLoading(false);
            onSuccess?.(result);
          }
          registrationLocks.delete(cacheKey);
          return;
        }
        
        // Create and register promise atomically
        const fetchPromise = fetchFn();
        inFlightRequests.set(cacheKey, fetchPromise);
        
        const result = await fetchPromise;
        
        // Cache the result if caching is enabled
        if (cacheTTL > 0 && cacheKey) {
          setCached(cacheKey, result);
        }
        
        // Clean up
        inFlightRequests.delete(cacheKey);
        registrationLocks.delete(cacheKey);
        activeLockRef.current = null;
        
        if (isMountedRef.current) {
          setData(result);
          setLoading(false);
          onSuccess?.(result);
        }
        return;
      } catch (err: ApiErrorType) {
        // Clean up on error
        if (cacheKey) {
          inFlightRequests.delete(cacheKey);
          registrationLocks.delete(cacheKey);
          activeLockRef.current = null;
        }
        
        if (isMountedRef.current) {
          const errorMessage = defaultErrorMessage || getErrorMessage(err) || '載入資料時發生錯誤';
          setError(errorMessage);
          setLoading(false);
          onError?.(err);
          if (logErrors) {
            logger.error('Fetch error:', err);
          }
        }
        return;
      }
    } catch (err: ApiErrorType) {
      // Remove from in-flight requests on error
      // Use the cacheKey computed at the start
      if (cacheKey) {
        inFlightRequests.delete(cacheKey);
        registrationLocks.delete(cacheKey);
      }
      const errorMessage = defaultErrorMessage || getErrorMessage(err) || '載入資料時發生錯誤';

      // Clear cache on error to prevent stale data
      if (cacheTTL > 0 && cacheKey) {
        cache.delete(cacheKey);
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


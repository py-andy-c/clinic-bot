/**
 * Availability Cache Utility
 * 
 * Shared cache for appointment availability slots to avoid redundant API calls.
 * Provides functions to get, set, and invalidate cached availability data.
 */

import { TimeInterval } from '../types';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CachedAvailabilityData {
  slots: TimeInterval[];
  timestamp: number;
}

// Global cache for availability data
// Key format: `${practitionerId}-${appointmentTypeId}-${monthKey}-${date}`
// Example: "123-456-2024-11-2024-11-15"
const globalAvailabilityCache = new Map<string, CachedAvailabilityData>();

/**
 * Parse cache key to extract components
 * @param key - The cache key
 * @returns Parsed components or null if invalid
 */
interface ParsedCacheKey {
  practitionerId: number;
  appointmentTypeId: number;
  date: string;
}

function parseCacheKey(key: string): ParsedCacheKey | null {
  const keyParts = key.split('-');
  if (keyParts.length < 4) return null;

  const practitionerIdStr = keyParts[0];
  const appointmentTypeIdStr = keyParts[1];
  const date = keyParts.slice(-3).join('-'); // Last 3 parts form YYYY-MM-DD

  if (!practitionerIdStr || !appointmentTypeIdStr) return null;

  const practitionerId = parseInt(practitionerIdStr, 10);
  const appointmentTypeId = parseInt(appointmentTypeIdStr, 10);

  if (isNaN(practitionerId) || isNaN(appointmentTypeId)) return null;

  return { practitionerId, appointmentTypeId, date };
}

/**
 * Check if a parsed cache key matches the filter criteria
 */
function matchesFilter(
  parsed: ParsedCacheKey,
  practitionerId: number | null,
  appointmentTypeId: number | null,
  dateFilter: (date: string) => boolean
): boolean {
  if (!dateFilter(parsed.date)) return false;

  if (practitionerId !== null && parsed.practitionerId !== practitionerId) return false;
  if (appointmentTypeId !== null && parsed.appointmentTypeId !== appointmentTypeId) return false;

  return true;
}

/**
 * Generate a cache key for a specific date
 * @param practitionerId - The practitioner ID
 * @param appointmentTypeId - The appointment type ID
 * @param monthKey - The month key in format "YYYY-MM"
 * @param date - The date in format "YYYY-MM-DD"
 * @returns The cache key
 */
export function getCacheKey(
  practitionerId: number,
  appointmentTypeId: number,
  monthKey: string,
  date: string
): string {
  return `${practitionerId}-${appointmentTypeId}-${monthKey}-${date}`;
}

/**
 * Get cached availability slots for a specific key
 * @param cacheKey - The cache key
 * @returns The cached slots array, or null if not found or expired
 */
export function getCachedSlots(cacheKey: string): TimeInterval[] | null {
  const cached = globalAvailabilityCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  const now = Date.now();
  if (now - cached.timestamp >= CACHE_TTL) {
    // Cache expired, remove it
    globalAvailabilityCache.delete(cacheKey);
    return null;
  }

  return cached.slots;
}

/**
 * Set cached availability slots for a specific key
 * @param cacheKey - The cache key
 * @param slots - The slots array to cache
 */
export function setCachedSlots(cacheKey: string, slots: TimeInterval[]): void {
  globalAvailabilityCache.set(cacheKey, {
    slots,
    timestamp: Date.now(),
  });
}

/**
 * Invalidate cache entries for a specific date, practitioner, and appointment type
 * @param practitionerId - The practitioner ID (null to invalidate for all practitioners)
 * @param appointmentTypeId - The appointment type ID (null to invalidate for all types)
 * @param date - The date in format "YYYY-MM-DD"
 */
export function invalidateCacheForDate(
  practitionerId: number | null,
  appointmentTypeId: number | null,
  date: string
): void {
  const keysToDelete: string[] = [];

  for (const key of globalAvailabilityCache.keys()) {
    const parsed = parseCacheKey(key);
    if (!parsed) continue;

    if (matchesFilter(parsed, practitionerId, appointmentTypeId, (d) => d === date)) {
      keysToDelete.push(key);
    }
  }

  keysToDelete.forEach(key => globalAvailabilityCache.delete(key));
}

/**
 * Clear all cached availability data
 * Exported for testing purposes
 */
export function clearAllCache(): void {
  globalAvailabilityCache.clear();
}


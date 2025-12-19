/**
 * Resource Availability Cache Utility
 * 
 * Shared cache for resource availability data to avoid redundant API calls.
 * Provides functions to get, set, and invalidate cached resource availability data.
 */

import { ResourceAvailabilityResponse } from '../types';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CachedResourceAvailabilityData {
  data: ResourceAvailabilityResponse;
  timestamp: number;
}

// Global cache for resource availability data
// Key format: `${appointmentTypeId}_${practitionerId}_${date}_${startTime}_${durationMinutes}_${excludeCalendarEventId || 0}`
// Example: "123_456_2024-11-15_14:00_30_0"
const globalResourceAvailabilityCache = new Map<string, CachedResourceAvailabilityData>();

/**
 * Generate a cache key for resource availability
 * @param appointmentTypeId - The appointment type ID
 * @param practitionerId - The practitioner ID
 * @param date - The date in format "YYYY-MM-DD"
 * @param startTime - The start time in format "HH:mm"
 * @param durationMinutes - The duration in minutes
 * @param excludeCalendarEventId - Optional calendar event ID to exclude (for editing)
 * @returns The cache key
 */
export function getResourceCacheKey(
  appointmentTypeId: number,
  practitionerId: number,
  date: string,
  startTime: string,
  durationMinutes: number,
  excludeCalendarEventId: number | undefined
): string {
  return `${appointmentTypeId}_${practitionerId}_${date}_${startTime}_${durationMinutes}_${excludeCalendarEventId || 0}`;
}

/**
 * Get cached resource availability data for a specific key
 * @param cacheKey - The cache key
 * @returns The cached data, or null if not found or expired
 */
export function getCachedResourceAvailability(cacheKey: string): ResourceAvailabilityResponse | null {
  const cached = globalResourceAvailabilityCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  const now = Date.now();
  if (now - cached.timestamp >= CACHE_TTL) {
    // Cache expired, remove it
    globalResourceAvailabilityCache.delete(cacheKey);
    return null;
  }

  return cached.data;
}

/**
 * Set cached resource availability data for a specific key
 * @param cacheKey - The cache key
 * @param data - The data to cache
 */
export function setCachedResourceAvailability(cacheKey: string, data: ResourceAvailabilityResponse): void {
  globalResourceAvailabilityCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
  });
}

/**
 * Parse cache key to extract components
 */
interface ParsedResourceCacheKey {
  appointmentTypeId: number;
  practitionerId: number;
  date: string;
  startTime: string;
  durationMinutes: number;
}

function parseResourceCacheKey(key: string): ParsedResourceCacheKey | null {
  // Key format: `${appointmentTypeId}_${practitionerId}_${date}_${startTime}_${durationMinutes}_${excludeCalendarEventId || 0}`
  // Example: "123_456_2024-11-15_14:00_30_0"
  // Note: date contains dashes (YYYY-MM-DD), so we can't just split by '_'
  // We'll use a regex to match the pattern
  
  const match = key.match(/^(\d+)_(\d+)_(\d{4}-\d{2}-\d{2})_(\d{2}:\d{2})_(\d+)_(\d+)$/);
  if (!match) return null;

  const appointmentTypeIdStr = match[1];
  const practitionerIdStr = match[2];
  const date = match[3]; // YYYY-MM-DD
  const startTime = match[4]; // HH:mm
  const durationMinutesStr = match[5];

  if (!appointmentTypeIdStr || !practitionerIdStr || !date || !startTime || !durationMinutesStr) {
    return null;
  }

  const appointmentTypeId = parseInt(appointmentTypeIdStr, 10);
  const practitionerId = parseInt(practitionerIdStr, 10);
  const durationMinutes = parseInt(durationMinutesStr, 10);

  if (isNaN(appointmentTypeId) || isNaN(practitionerId) || isNaN(durationMinutes)) {
    return null;
  }

  return { appointmentTypeId, practitionerId, date, startTime, durationMinutes };
}

/**
 * Invalidate cache entries for a specific date, practitioner, and appointment type
 * @param practitionerId - The practitioner ID (null to invalidate for all practitioners)
 * @param appointmentTypeId - The appointment type ID (null to invalidate for all types)
 * @param date - The date in format "YYYY-MM-DD"
 */
export function invalidateResourceCacheForDate(
  practitionerId: number | null,
  appointmentTypeId: number | null,
  date: string
): void {
  const keysToDelete: string[] = [];

  for (const key of globalResourceAvailabilityCache.keys()) {
    const parsed = parseResourceCacheKey(key);
    if (!parsed) continue;

    // Check date match
    if (parsed.date !== date) continue;

    // Check practitioner match
    if (practitionerId !== null && parsed.practitionerId !== practitionerId) continue;

    // Check appointment type match
    if (appointmentTypeId !== null && parsed.appointmentTypeId !== appointmentTypeId) continue;

    keysToDelete.push(key);
  }

  keysToDelete.forEach(key => globalResourceAvailabilityCache.delete(key));
}

/**
 * Clear all cached resource availability data
 */
export function clearAllResourceCache(): void {
  globalResourceAvailabilityCache.clear();
}


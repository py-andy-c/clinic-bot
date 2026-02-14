/**
 * ID Utility Functions
 * 
 * Provides utilities for working with temporary and real IDs.
 * Temporary IDs are generated using Date.now() (large timestamps > 1000000000000)
 * or negative numbers (for groups). Real IDs from the backend are small positive integers.
 */

// Temporary IDs are generated using Date.now(), which produces large timestamps
// Real IDs from the backend are small integers, so we use this threshold to distinguish them
export const TEMPORARY_ID_THRESHOLD = 1000000000000;

/**
 * Check if an ID is a temporary ID (for service items)
 * Temporary service item IDs are large timestamps > TEMPORARY_ID_THRESHOLD
 * OR 0 (which represents a new item not yet saved)
 */
export const isTemporaryServiceItemId = (id: number): boolean => {
  return id <= 0 || id > TEMPORARY_ID_THRESHOLD;
};

/**
 * Check if an ID is a temporary ID (for groups)
 * Temporary group IDs are negative numbers
 */
export const isTemporaryGroupId = (id: number): boolean => {
  return id < 0;
};

/**
 * Check if an ID is a real ID (not temporary)
 * Real IDs are small positive integers
 */
export const isRealId = (id: number): boolean => {
  return id > 0 && id < TEMPORARY_ID_THRESHOLD;
};

/**
 * Check if an ID is a temporary ID (either service item or group)
 */
export const isTemporaryId = (id: number): boolean => {
  return isTemporaryServiceItemId(id) || isTemporaryGroupId(id);
};


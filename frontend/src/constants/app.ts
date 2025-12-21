/**
 * Application-wide constants
 * 
 * Centralized constants for magic numbers and strings used throughout the app.
 */

/**
 * Z-index scale for consistent layering
 * 
 * - MODAL: Highest priority modals (calendar modals, important dialogs)
 * - DIALOG: Standard dialogs (ModalContext alerts/confirms) - must be higher than MODAL for nested dialogs
 * - DROPDOWN: Dropdown menus, tooltips
 * - TOOLTIP: Info popups, positioned modals
 */
export const Z_INDEX = {
  MODAL: 9999,
  DIALOG: 10000, // Higher than MODAL to appear above modals (e.g., confirmation dialogs)
  DROPDOWN: 50,
  TOOLTIP: 50,
} as const;

/**
 * Cache TTL values (in milliseconds)
 */
export const CACHE_TTL = {
  DEFAULT: 5 * 60 * 1000, // 5 minutes
  SHORT: 1 * 60 * 1000, // 1 minute
  LONG: 10 * 60 * 1000, // 10 minutes
} as const;

/**
 * Request timeout values (in milliseconds)
 */
export const REQUEST_TIMEOUT = {
  DEFAULT: 30000, // 30 seconds
  SHORT: 10000, // 10 seconds
  LONG: 60000, // 60 seconds
} as const;


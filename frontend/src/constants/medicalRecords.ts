/**
 * Medical record constants
 */

/**
 * Number of days before a soft-deleted medical record is permanently deleted
 */
export const MEDICAL_RECORD_RETENTION_DAYS = 30;

/**
 * Sentinel value for "no template selected" state
 * Must not match any real template ID (templates start at 1)
 */
export const NO_TEMPLATE_SELECTED = -1;

/**
 * Utility functions for comparing chat settings.
 * 
 * Used to detect changes in chat settings for auto-closing test modal.
 */

import { ChatSettings } from '../schemas/api';

/**
 * Normalizes a string value for comparison (handles null, undefined, empty string).
 * 
 * @param value - The value to normalize
 * @returns Normalized value (null if empty/undefined)
 */
function normalizeString(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim() === '') {
    return null;
  }
  return value;
}

/**
 * Compares two chat settings objects to detect if any field has changed.
 * 
 * Uses JSON.stringify for efficient deep comparison and normalizes
 * string values to handle null/undefined/empty string cases consistently.
 * 
 * @param prev - Previous chat settings
 * @param current - Current chat settings
 * @returns true if settings have changed, false otherwise
 */
export function hasChatSettingsChanged(
  prev: ChatSettings,
  current: ChatSettings
): boolean {
  // Normalize both objects for comparison
  const normalizedPrev: ChatSettings = {
    chat_enabled: prev.chat_enabled,
    label_ai_replies: prev.label_ai_replies,
    clinic_description: normalizeString(prev.clinic_description),
    therapist_info: normalizeString(prev.therapist_info),
    treatment_details: normalizeString(prev.treatment_details),
    service_item_selection_guide: normalizeString(prev.service_item_selection_guide),
    operating_hours: normalizeString(prev.operating_hours),
    location_details: normalizeString(prev.location_details),
    booking_policy: normalizeString(prev.booking_policy),
    payment_methods: normalizeString(prev.payment_methods),
    equipment_facilities: normalizeString(prev.equipment_facilities),
    common_questions: normalizeString(prev.common_questions),
    other_info: normalizeString(prev.other_info),
    ai_guidance: normalizeString(prev.ai_guidance),
  };

  const normalizedCurrent: ChatSettings = {
    chat_enabled: current.chat_enabled,
    label_ai_replies: current.label_ai_replies,
    clinic_description: normalizeString(current.clinic_description),
    therapist_info: normalizeString(current.therapist_info),
    treatment_details: normalizeString(current.treatment_details),
    service_item_selection_guide: normalizeString(current.service_item_selection_guide),
    operating_hours: normalizeString(current.operating_hours),
    location_details: normalizeString(current.location_details),
    booking_policy: normalizeString(current.booking_policy),
    payment_methods: normalizeString(current.payment_methods),
    equipment_facilities: normalizeString(current.equipment_facilities),
    common_questions: normalizeString(current.common_questions),
    other_info: normalizeString(current.other_info),
    ai_guidance: normalizeString(current.ai_guidance),
  };

  // Use JSON.stringify for efficient deep comparison
  return JSON.stringify(normalizedPrev) !== JSON.stringify(normalizedCurrent);
}


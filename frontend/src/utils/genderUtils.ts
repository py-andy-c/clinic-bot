/**
 * Gender utility functions for converting between API values and display labels.
 */

export type GenderValue = 'male' | 'female' | 'other';

export const GENDER_OPTIONS: { value: GenderValue; label: string }[] = [
  { value: 'male', label: '男性' },
  { value: 'female', label: '女性' },
  { value: 'other', label: '其他' },
];

/**
 * Get display label for a gender value.
 * @param value Gender value ('male', 'female', 'other', or null/undefined)
 * @returns Display label in Chinese, or '-' if value is invalid/null (consistent with other display fields)
 */
export function getGenderLabel(value: string | null | undefined): string {
  if (!value) return '-';
  const option = GENDER_OPTIONS.find(opt => opt.value === value.toLowerCase());
  return option?.label || '-';
}

/**
 * Get gender value from display label.
 * @param label Display label in Chinese
 * @returns Gender value ('male', 'female', 'other'), or null if not found
 */
export function getGenderValue(label: string): GenderValue | null {
  const option = GENDER_OPTIONS.find(opt => opt.label === label);
  return (option?.value as GenderValue) || null;
}

/**
 * Check if a value is a valid gender value.
 * @param value Value to check
 * @returns True if value is a valid gender value
 */
export function isValidGenderValue(value: string | null | undefined): value is GenderValue {
  if (!value) return false;
  return GENDER_OPTIONS.some(opt => opt.value === value.toLowerCase());
}


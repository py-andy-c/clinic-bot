import { ClinicSettings, BookingRestrictionSettings } from '../schemas/api';

/**
 * Normalizes booking restriction settings for comparison.
 * Handles type mismatches (string vs number) and optional fields with defaults.
 * 
 * @param settings - The booking restriction settings to normalize
 * @returns Normalized settings object
 */
function normalizeBookingRestrictionSettings(
  settings: BookingRestrictionSettings
): BookingRestrictionSettings {
  // Normalize numeric fields (handle string vs number)
  const normalizeNumber = (value: string | number | undefined | null, defaultValue: number): number => {
    if (value === undefined || value === null || value === '') {
      return defaultValue;
    }
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return isNaN(num) ? defaultValue : num;
  };

  // Normalize string fields
  const normalizeString = (value: string | undefined | null, defaultValue: string = ''): string => {
    return value ?? defaultValue;
  };

  // Normalize boolean fields
  const normalizeBoolean = (value: boolean | undefined | null, defaultValue: boolean): boolean => {
    return value ?? defaultValue;
  };

  return {
    booking_restriction_type: normalizeString(settings.booking_restriction_type, 'minimum_hours_required'),
    minimum_booking_hours_ahead: normalizeNumber(settings.minimum_booking_hours_ahead, 24),
    deadline_time_day_before: normalizeString(settings.deadline_time_day_before, '08:00'),
    deadline_on_same_day: normalizeBoolean(settings.deadline_on_same_day, false),
    step_size_minutes: normalizeNumber(settings.step_size_minutes, 30),
    max_future_appointments: normalizeNumber(settings.max_future_appointments, 3),
    max_booking_window_days: normalizeNumber(settings.max_booking_window_days, 90),
    minimum_cancellation_hours_before: normalizeNumber(settings.minimum_cancellation_hours_before, 24),
    allow_patient_deletion: normalizeBoolean(settings.allow_patient_deletion, true),
  };
}

/**
 * Compares two booking restriction settings objects to detect if any field has changed.
 * 
 * Uses normalization to handle type mismatches and optional fields, then
 * uses JSON.stringify for efficient deep comparison.
 * 
 * @param current - Current booking restriction settings
 * @param original - Original booking restriction settings
 * @returns true if settings have changed, false otherwise
 */
function hasBookingRestrictionSettingsChanged(
  current: BookingRestrictionSettings,
  original: BookingRestrictionSettings
): boolean {
  const normalizedCurrent = normalizeBookingRestrictionSettings(current);
  const normalizedOriginal = normalizeBookingRestrictionSettings(original);
  
  return JSON.stringify(normalizedCurrent) !== JSON.stringify(normalizedOriginal);
}

// Validate clinic settings data
export const validateClinicSettings = (settings: ClinicSettings): string | null => {
  if (!settings) return '設定資料不存在';

  // Validate appointment types
  for (let i = 0; i < settings.appointment_types.length; i++) {
    const type = settings.appointment_types[i];
    if (!type) continue; // Skip if type doesn't exist

    // Check name
    if (!type.name || type.name.trim().length === 0) {
      return `預約類型的名稱不能為空`;
    }

    // Check duration
    const duration = Number(type.duration_minutes);
    if (isNaN(duration) || duration < 15 || duration > 480) {
      return `預約類型的時長必須在 15-480 分鐘之間`;
    }
  }

  // Validate reminder hours
  const reminderHoursValue = settings.notification_settings.reminder_hours_before;
  const reminderHours = typeof reminderHoursValue === 'string' ? parseFloat(reminderHoursValue) : reminderHoursValue;
  if (isNaN(reminderHours) || reminderHours < 1 || reminderHours > 168) {
    return '預約前幾小時發送提醒必須在 1-168 小時之間';
  }

  // Validate booking restriction settings
  if (settings.booking_restriction_settings.booking_restriction_type === 'minimum_hours_required') {
    const minHoursValue = settings.booking_restriction_settings.minimum_booking_hours_ahead;
    const minHours = typeof minHoursValue === 'string' ? parseFloat(minHoursValue) : minHoursValue;
    if (isNaN(minHours) || minHours < 1 || minHours > 168) {
      return '預約前至少需幾小時必須在 1-168 小時之間';
    }
  }

  // Validate step_size_minutes
  const stepSizeValue = settings.booking_restriction_settings.step_size_minutes;
  if (stepSizeValue !== undefined && stepSizeValue !== null) {
    const stepSize = typeof stepSizeValue === 'string' ? parseFloat(stepSizeValue) : stepSizeValue;
    if (isNaN(stepSize) || stepSize < 5 || stepSize > 60) {
      return '時段間隔必須在 5-60 分鐘之間';
    }
  }

  // Validate max_future_appointments
  const maxFutureAppointmentsValue = settings.booking_restriction_settings.max_future_appointments;
  if (maxFutureAppointmentsValue !== undefined && maxFutureAppointmentsValue !== null) {
    const maxFutureAppointments = typeof maxFutureAppointmentsValue === 'string' ? parseFloat(maxFutureAppointmentsValue) : maxFutureAppointmentsValue;
    if (isNaN(maxFutureAppointments) || maxFutureAppointments < 1 || maxFutureAppointments > 100) {
      return '患者未來預約上限必須在 1-100 之間';
    }
  }

  // Validate max_booking_window_days
  const maxBookingWindowDaysValue = settings.booking_restriction_settings.max_booking_window_days;
  if (maxBookingWindowDaysValue !== undefined && maxBookingWindowDaysValue !== null) {
    const maxBookingWindowDays = typeof maxBookingWindowDaysValue === 'string' ? parseFloat(maxBookingWindowDaysValue) : maxBookingWindowDaysValue;
    if (isNaN(maxBookingWindowDays) || maxBookingWindowDays < 1 || maxBookingWindowDays > 365) {
      return '預約時間範圍必須在 1-365 天之間';
    }
  }

  return null; // Valid
};

// Get section-specific changes for clinic settings
export const getClinicSectionChanges = (current: ClinicSettings, original: ClinicSettings): Record<string, boolean> => {
  // Check if appointment settings section has changes
  // This includes: appointment types, appointment type instructions, booking restrictions, and require_birthday
  // 
  // Use the helper function for booking restriction settings to ensure all fields are compared,
  // including deadline_time_day_before and deadline_on_same_day which were previously missing.
  // This approach is more maintainable and prevents similar issues when new fields are added.
  const appointmentSettingsChanged =
    JSON.stringify(current.appointment_types) !== JSON.stringify(original.appointment_types) ||
    current.clinic_info_settings.appointment_type_instructions !== original.clinic_info_settings.appointment_type_instructions ||
    current.clinic_info_settings.appointment_notes_instructions !== original.clinic_info_settings.appointment_notes_instructions ||
    hasBookingRestrictionSettingsChanged(current.booking_restriction_settings, original.booking_restriction_settings) ||
    (current.clinic_info_settings.require_birthday || false) !== (original.clinic_info_settings.require_birthday || false);

  return {
    appointmentSettings: appointmentSettingsChanged,
    clinicInfoSettings:
      current.clinic_info_settings.display_name !== original.clinic_info_settings.display_name ||
      current.clinic_info_settings.address !== original.clinic_info_settings.address ||
      current.clinic_info_settings.phone_number !== original.clinic_info_settings.phone_number,
    reminderSettings: current.notification_settings.reminder_hours_before !== original.notification_settings.reminder_hours_before,
    chatSettings: JSON.stringify(current.chat_settings) !== JSON.stringify(original.chat_settings),
  };
};

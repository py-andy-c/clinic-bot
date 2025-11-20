import { ClinicSettings } from '../schemas/api';

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
  const appointmentSettingsChanged =
    JSON.stringify(current.appointment_types) !== JSON.stringify(original.appointment_types) ||
    current.clinic_info_settings.appointment_type_instructions !== original.clinic_info_settings.appointment_type_instructions ||
    current.booking_restriction_settings.booking_restriction_type !== original.booking_restriction_settings.booking_restriction_type ||
    current.booking_restriction_settings.minimum_booking_hours_ahead !== original.booking_restriction_settings.minimum_booking_hours_ahead ||
    (current.booking_restriction_settings.step_size_minutes ?? 30) !== (original.booking_restriction_settings.step_size_minutes ?? 30) ||
    (current.booking_restriction_settings.max_future_appointments ?? 3) !== (original.booking_restriction_settings.max_future_appointments ?? 3) ||
    (current.booking_restriction_settings.max_booking_window_days ?? 90) !== (original.booking_restriction_settings.max_booking_window_days ?? 90) ||
    (current.booking_restriction_settings.minimum_cancellation_hours_before ?? 24) !== (original.booking_restriction_settings.minimum_cancellation_hours_before ?? 24) ||
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

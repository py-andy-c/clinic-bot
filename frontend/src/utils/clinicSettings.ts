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
      return `預約類型 ${i + 1} 的名稱不能為空`;
    }

    // Check duration
    const duration = Number(type.duration_minutes);
    if (isNaN(duration) || duration < 15 || duration > 480) {
      return `預約類型 ${i + 1} 的時長必須在 15-480 分鐘之間`;
    }
  }

  // Validate reminder hours
  const reminderHoursValue = settings.notification_settings.reminder_hours_before;
  const reminderHours = typeof reminderHoursValue === 'string' ? parseFloat(reminderHoursValue) : reminderHoursValue;
  if (isNaN(reminderHours) || reminderHours < 1 || reminderHours > 168) {
    return '預約前幾小時發送提醒必須在 1-168 小時之間';
  }

  return null; // Valid
};

// Get section-specific changes for clinic settings
export const getClinicSectionChanges = (current: ClinicSettings, original: ClinicSettings): Record<string, boolean> => {
  return {
    appointmentTypes: JSON.stringify(current.appointment_types) !== JSON.stringify(original.appointment_types),
    reminderSettings: current.notification_settings.reminder_hours_before !== original.notification_settings.reminder_hours_before,
  };
};

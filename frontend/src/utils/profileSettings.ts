import { DefaultScheduleResponse } from '../types';

interface PractitionerSettings {
  compact_schedule_enabled: boolean;
  next_day_notification_time?: string;
  auto_assigned_notification_time?: string;
  step_size_minutes?: number | null;
}

interface ProfileSettingsData {
  fullName: string;
  title: string;
  schedule: DefaultScheduleResponse;
  settings?: PractitionerSettings;
  clinicDefaultStep?: number;
}

const DAYS_OF_WEEK = [
  { value: 0, label: '星期一', labelEn: 'Monday' },
  { value: 1, label: '星期二', labelEn: 'Tuesday' },
  { value: 2, label: '星期三', labelEn: 'Wednesday' },
  { value: 3, label: '星期四', labelEn: 'Thursday' },
  { value: 4, label: '星期五', labelEn: 'Friday' },
  { value: 5, label: '星期六', labelEn: 'Saturday' },
  { value: 6, label: '星期日', labelEn: 'Sunday' },
];

interface TimeInterval {
  start_time: string;
  end_time: string;
}

// Validate time intervals for overlaps
const validateIntervals = (intervals: TimeInterval[]): string | null => {
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      const interval1 = intervals[i];
      const interval2 = intervals[j];

      if (interval1 && interval2 &&
        ((interval1.start_time <= interval2.start_time && interval1.end_time > interval2.start_time) ||
          (interval2.start_time <= interval1.start_time && interval2.end_time > interval1.start_time))) {
        return '時間區間不能重疊';
      }
    }
  }
  return null;
};

// Validate profile settings data
export const validateProfileSettings = (data: ProfileSettingsData): string | null => {
  // Validate schedule intervals
  for (const dayKey of Object.keys(data.schedule) as Array<keyof DefaultScheduleResponse>) {
    const intervals = data.schedule[dayKey];
    const validationError = validateIntervals(intervals);
    if (validationError) {
      const dayLabel = DAYS_OF_WEEK.find(d => d.labelEn.toLowerCase() === dayKey)?.label;
      return `${dayLabel}: ${validationError}`;
    }
  }

  // Validate step_size_minutes if set
  if (data.settings?.step_size_minutes !== undefined && data.settings?.step_size_minutes !== null) {
    if (data.settings.step_size_minutes < 5 || data.settings.step_size_minutes > 60) {
      return '預約起始時間間隔必須介於 5 到 60 分鐘之間';
    }

    // Disallow setting smaller than clinic default
    const clinicDefault = data.clinicDefaultStep || 15; // Fallback to 15 if unknown
    if (data.settings.step_size_minutes < clinicDefault) {
      return `個人預約起始時間間隔不能小於診所預設值 (${clinicDefault} 分鐘)`;
    }
  }

  return null; // Valid
};

// Get section-specific changes for profile settings
export const getProfileSectionChanges = (current: ProfileSettingsData, original: ProfileSettingsData): Record<string, boolean> => {
  const currentSettings = current.settings || { compact_schedule_enabled: false, next_day_notification_time: '21:00', auto_assigned_notification_time: '21:00' };
  const originalSettings = original.settings || { compact_schedule_enabled: false, next_day_notification_time: '21:00', auto_assigned_notification_time: '21:00' };

  const settingsChanged =
    currentSettings.compact_schedule_enabled !== originalSettings.compact_schedule_enabled ||
    (currentSettings.next_day_notification_time || '21:00') !== (originalSettings.next_day_notification_time || '21:00') ||
    (currentSettings.auto_assigned_notification_time || '21:00') !== (originalSettings.auto_assigned_notification_time || '21:00') ||
    currentSettings.step_size_minutes !== originalSettings.step_size_minutes;

  return {
    profile: current.fullName !== original.fullName || current.title !== original.title,
    schedule: original.schedule ?
      JSON.stringify(current.schedule) !== JSON.stringify(original.schedule) : false,
    settings: settingsChanged,
  };
};

import { DefaultScheduleResponse } from '../types';

interface PractitionerSettings {
  compact_schedule_enabled: boolean;
}

interface ProfileSettingsData {
  fullName: string;
  schedule: DefaultScheduleResponse;
  selectedAppointmentTypeIds: number[];
  settings?: PractitionerSettings;
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

  return null; // Valid
};

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

// Get section-specific changes for profile settings
export const getProfileSectionChanges = (current: ProfileSettingsData, original: ProfileSettingsData): Record<string, boolean> => {
  const currentSettings = current.settings || { compact_schedule_enabled: false };
  const originalSettings = original.settings || { compact_schedule_enabled: false };
  
  return {
    profile: current.fullName !== original.fullName,
    schedule: original.schedule ?
      JSON.stringify(current.schedule) !== JSON.stringify(original.schedule) : false,
    appointmentTypes: JSON.stringify(current.selectedAppointmentTypeIds) !== JSON.stringify(original.selectedAppointmentTypeIds),
    settings: currentSettings.compact_schedule_enabled !== originalSettings.compact_schedule_enabled,
  };
};

import React from 'react';
import moment from 'moment-timezone';

export type TimeRangePreset = 'month' | '3months' | '6months' | 'year';

export interface TimeRangePresetsProps {
  onSelect: (preset: TimeRangePreset) => void;
  activePreset?: TimeRangePreset | null;
  className?: string;
}

export const TimeRangePresets: React.FC<TimeRangePresetsProps> = ({
  onSelect,
  activePreset,
  className = '',
}) => {
  const presets: Array<{ key: TimeRangePreset; label: string }> = [
    { key: 'month', label: '本月' },
    { key: '3months', label: '最近3個月' },
    { key: '6months', label: '最近6個月' },
    { key: 'year', label: '最近1年' },
  ];

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {presets.map((preset) => {
        const isActive = activePreset === preset.key;
        return (
          <button
            key={preset.key}
            type="button"
            onClick={() => onSelect(preset.key)}
            className={`px-2 md:px-3 py-1 text-xs rounded-md transition-colors ${
              isActive
                ? 'bg-blue-600 text-white hover:bg-blue-700 font-medium'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
};

/**
 * Calculate date range for a preset
 */
export function getDateRangeForPreset(preset: TimeRangePreset): { startDate: string; endDate: string } {
  let startDate: moment.Moment;
  let endDate: moment.Moment;

  switch (preset) {
    case 'month':
      startDate = moment().tz('Asia/Taipei').startOf('month');
      endDate = moment().tz('Asia/Taipei').endOf('month');
      break;
    case '3months':
      startDate = moment().tz('Asia/Taipei').subtract(2, 'months').startOf('month');
      endDate = moment().tz('Asia/Taipei').endOf('month');
      break;
    case '6months':
      startDate = moment().tz('Asia/Taipei').subtract(5, 'months').startOf('month');
      endDate = moment().tz('Asia/Taipei').endOf('month');
      break;
    case 'year':
      startDate = moment().tz('Asia/Taipei').startOf('year');
      endDate = moment().tz('Asia/Taipei').endOf('year');
      break;
  }

  return {
    startDate: startDate.format('YYYY-MM-DD'),
    endDate: endDate.format('YYYY-MM-DD'),
  };
}

/**
 * Detect which preset matches the given date range
 */
export function detectPresetFromDates(startDate: string, endDate: string): TimeRangePreset | null {
  // Check each preset to see if it matches
  const presets: TimeRangePreset[] = ['month', '3months', '6months', 'year'];
  
  for (const preset of presets) {
    const range = getDateRangeForPreset(preset);
    if (range.startDate === startDate && range.endDate === endDate) {
      return preset;
    }
  }
  
  return null;
}

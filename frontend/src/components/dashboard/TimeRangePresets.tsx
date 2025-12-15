import React from 'react';
import moment from 'moment-timezone';

export type TimeRangePreset = 'month' | '3months' | '6months' | 'year';

export interface TimeRangePresetsProps {
  onSelect: (preset: TimeRangePreset) => void;
  className?: string;
}

export const TimeRangePresets: React.FC<TimeRangePresetsProps> = ({
  onSelect,
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
      {presets.map((preset) => (
        <button
          key={preset.key}
          type="button"
          onClick={() => onSelect(preset.key)}
          className="px-2 md:px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
        >
          {preset.label}
        </button>
      ))}
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
      startDate = moment().startOf('month');
      endDate = moment().endOf('month');
      break;
    case '3months':
      startDate = moment().subtract(2, 'months').startOf('month');
      endDate = moment().endOf('month');
      break;
    case '6months':
      startDate = moment().subtract(5, 'months').startOf('month');
      endDate = moment().endOf('month');
      break;
    case 'year':
      startDate = moment().startOf('year');
      endDate = moment().endOf('month');
      break;
  }

  return {
    startDate: startDate.format('YYYY-MM-DD'),
    endDate: endDate.format('YYYY-MM-DD'),
  };
}

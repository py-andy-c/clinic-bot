import React from 'react';
import { DefaultScheduleResponse, TimeInterval, WarningResponse } from '../types';

const DAYS_OF_WEEK = [
  { value: 0, label: '星期一', labelEn: 'Monday' },
  { value: 1, label: '星期二', labelEn: 'Tuesday' },
  { value: 2, label: '星期三', labelEn: 'Wednesday' },
  { value: 3, label: '星期四', labelEn: 'Thursday' },
  { value: 4, label: '星期五', labelEn: 'Friday' },
  { value: 5, label: '星期六', labelEn: 'Saturday' },
  { value: 6, label: '星期日', labelEn: 'Sunday' },
];

interface AvailabilitySettingsProps {
  schedule: DefaultScheduleResponse;
  onScheduleChange: (dayKey: keyof DefaultScheduleResponse, updates: any) => void;
  onAddInterval: (dayKey: keyof DefaultScheduleResponse) => void;
  onUpdateInterval: (dayKey: keyof DefaultScheduleResponse, index: number, field: keyof TimeInterval, value: string) => void;
  onRemoveInterval: (dayKey: keyof DefaultScheduleResponse, index: number) => void;
  validateIntervals: (intervals: TimeInterval[]) => string | null;
}

const AvailabilitySettings: React.FC<AvailabilitySettingsProps> = ({
  schedule,
  onScheduleChange,
  onAddInterval,
  onUpdateInterval,
  onRemoveInterval,
  validateIntervals,
}) => {
  const getDayKey = (dayOfWeek: number): keyof DefaultScheduleResponse => {
    const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    return dayNames[dayOfWeek] as keyof DefaultScheduleResponse;
  };

  return (
    <div className="mb-8">
      <h2 className="text-xl font-semibold text-gray-900 mb-6">預設每週排班</h2>
      
      <div className="space-y-4">
        <div className="grid gap-4">
          {DAYS_OF_WEEK.map((day) => {
            const dayKey = getDayKey(day.value);
            const intervals = schedule[dayKey];

            return (
              <div key={day.value} className="border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="font-medium text-gray-900">{day.label}</h4>
                  <button
                    type="button"
                    onClick={() => onAddInterval(dayKey)}
                    className="text-sm text-primary-600 hover:text-primary-800"
                  >
                    + 新增時段
                  </button>
                </div>

                {intervals.length === 0 ? (
                  <p className="text-gray-500 text-sm">尚未設定工作時段</p>
                ) : (
                  <div className="space-y-2">
                    {intervals.map((interval, index) => (
                      <div key={index} className="flex items-center space-x-3 bg-gray-50 p-3 rounded">
                        <div className="flex items-center space-x-2 flex-1">
                          <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                          <div className="grid grid-cols-2 gap-2 flex-1">
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">開始時間</label>
                              <input
                                type="time"
                                value={interval.start_time}
                                onChange={(e) => onUpdateInterval(dayKey, index, 'start_time', e.target.value)}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">結束時間</label>
                              <input
                                type="time"
                                value={interval.end_time}
                                onChange={(e) => onUpdateInterval(dayKey, index, 'end_time', e.target.value)}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                              />
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onRemoveInterval(dayKey, index)}
                          className="text-red-600 hover:text-red-800 p-1"
                          title="移除時段"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default AvailabilitySettings;

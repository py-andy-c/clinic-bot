import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import CalendarView from '../components/CalendarView';
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

const AvailabilityPage: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'schedule' | 'calendar'>('schedule');
  const [schedule, setSchedule] = useState<DefaultScheduleResponse>({
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  });
  const [originalSchedule, setOriginalSchedule] = useState<DefaultScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<WarningResponse | null>(null);
  const [showWarningDialog, setShowWarningDialog] = useState(false);

  useEffect(() => {
    if (user?.user_id && activeTab === 'schedule') {
      fetchSchedule();
    }
  }, [user, activeTab]);

  const fetchSchedule = async () => {
    if (!user?.user_id) return;

    try {
      setLoading(true);
      setError(null);
      const data = await apiService.getPractitionerDefaultSchedule(user.user_id);
      setSchedule(data);
      setOriginalSchedule(JSON.parse(JSON.stringify(data))); // Deep copy
    } catch (err) {
      setError('無法載入排班設定');
      console.error('Fetch schedule error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddInterval = (dayKey: keyof DefaultScheduleResponse) => {
    const newInterval: TimeInterval = {
      start_time: '09:00',
      end_time: '18:00',
    };

    setSchedule(prev => ({
      ...prev,
      [dayKey]: [...prev[dayKey], newInterval]
    }));
  };

  const handleUpdateInterval = (
    dayKey: keyof DefaultScheduleResponse,
    index: number,
    field: keyof TimeInterval,
    value: string
  ) => {
    setSchedule(prev => ({
      ...prev,
      [dayKey]: prev[dayKey].map((interval, i) =>
        i === index ? { ...interval, [field]: value } : interval
      )
    }));
  };

  const handleRemoveInterval = (dayKey: keyof DefaultScheduleResponse, index: number) => {
    setSchedule(prev => ({
      ...prev,
      [dayKey]: prev[dayKey].filter((_, i) => i !== index)
    }));
  };

  const validateIntervals = (intervals: TimeInterval[]): string | null => {
    for (let i = 0; i < intervals.length; i++) {
      for (let j = i + 1; j < intervals.length; j++) {
        const interval1 = intervals[i];
        const interval2 = intervals[j];

        // Check for overlapping intervals (both intervals are guaranteed to exist here)
        if (interval1 && interval2 &&
          ((interval1.start_time <= interval2.start_time && interval1.end_time > interval2.start_time) ||
           (interval2.start_time <= interval1.start_time && interval2.end_time > interval1.start_time))
        ) {
          return '時間區間不能重疊';
        }
      }
    }
    return null;
  };

  const handleSaveSchedule = async () => {
    if (!user?.user_id) return;

    // Validate all intervals
    for (const dayKey of Object.keys(schedule) as Array<keyof DefaultScheduleResponse>) {
      const validationError = validateIntervals(schedule[dayKey]);
      if (validationError) {
        setError(`${DAYS_OF_WEEK.find(d => d.labelEn.toLowerCase() === dayKey)?.label}: ${validationError}`);
        return;
      }
    }

    try {
      setSaving(true);
      setError(null);
      setWarning(null);

      const response = await apiService.updatePractitionerDefaultSchedule(user.user_id, schedule);

      // Check for warnings
      if ((response as any).warning) {
        setWarning(response as any);
        setShowWarningDialog(true);
        return;
      }

      setOriginalSchedule(JSON.parse(JSON.stringify(schedule)));
      // Success message could be shown here
    } catch (err: any) {
      console.error('Save schedule error:', err);
      if (err.response?.data?.warning) {
        setWarning(err.response.data as WarningResponse);
        setShowWarningDialog(true);
      } else {
        setError(err.response?.data?.message || '儲存失敗，請稍後再試');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmSave = async () => {
    if (!user?.user_id || !warning) return;

    try {
      setSaving(true);
      // Force save despite warnings
      await apiService.updatePractitionerDefaultSchedule(user.user_id, schedule);
      setOriginalSchedule(JSON.parse(JSON.stringify(schedule)));
      setShowWarningDialog(false);
      setWarning(null);
    } catch (err: any) {
      console.error('Force save error:', err);
      setError(err.response?.data?.message || '儲存失敗，請稍後再試');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (originalSchedule) {
      setSchedule(JSON.parse(JSON.stringify(originalSchedule)));
    }
  };

  const hasUnsavedChanges = () => {
    return JSON.stringify(schedule) !== JSON.stringify(originalSchedule);
  };

  const getDayKey = (dayOfWeek: number): keyof DefaultScheduleResponse => {
    const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    return dayNames[dayOfWeek] as keyof DefaultScheduleResponse;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">我的可用時間</h1>
          <p className="text-gray-600 mt-1">設定預設排班時間表和查看我的行事曆</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('schedule')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'schedule'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            排班設定
          </button>
          <button
            onClick={() => setActiveTab('calendar')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'calendar'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            行事曆檢視
          </button>
        </nav>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {/* Schedule Settings Tab */}
      {activeTab === 'schedule' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-medium text-gray-900">預設每週排班</h2>
            <div className="flex space-x-3">
              {hasUnsavedChanges() && (
                <button
                  onClick={handleReset}
                  className="btn-secondary"
                  disabled={saving}
                >
                  重設
                </button>
              )}
              <button
                onClick={handleSaveSchedule}
                className="btn-primary"
                disabled={saving || !hasUnsavedChanges()}
              >
                {saving ? '儲存中...' : '儲存變更'}
              </button>
            </div>
          </div>

          <div className="grid gap-4">
            {DAYS_OF_WEEK.map((day) => {
              const dayKey = getDayKey(day.value);
              const intervals = schedule[dayKey];

              return (
                <div key={day.value} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-medium text-gray-900">{day.label}</h3>
                    <button
                      onClick={() => handleAddInterval(dayKey)}
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
                                  onChange={(e) => handleUpdateInterval(dayKey, index, 'start_time', e.target.value)}
                                  className="input text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-600 mb-1">結束時間</label>
                                <input
                                  type="time"
                                  value={interval.end_time}
                                  onChange={(e) => handleUpdateInterval(dayKey, index, 'end_time', e.target.value)}
                                  className="input text-sm"
                                />
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveInterval(dayKey, index)}
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
      )}

      {/* Calendar View Tab */}
      {activeTab === 'calendar' && user?.user_id && (
        <CalendarView userId={user.user_id} />
      )}

      {/* Warning Dialog */}
      {showWarningDialog && warning && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                ⚠️ 確認變更
              </h3>

              <div className="mb-4">
                <p className="text-gray-700 mb-2">{warning.message}</p>

                {warning.warning === 'appointments_outside_hours' && warning.details?.affected_appointments && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
                    <p className="text-sm font-medium text-yellow-800 mb-2">受影響的預約：</p>
                    <ul className="text-sm text-yellow-700 space-y-1">
                      {warning.details.affected_appointments.map((appointment: any, index: number) => (
                        <li key={index}>
                          • {appointment.date} {appointment.time} - {appointment.patient}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowWarningDialog(false);
                    setWarning(null);
                  }}
                  className="btn-secondary"
                  disabled={saving}
                >
                  取消
                </button>
                <button
                  onClick={handleConfirmSave}
                  className="btn-primary"
                  disabled={saving}
                >
                  {saving ? '儲存中...' : '確認儲存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AvailabilityPage;

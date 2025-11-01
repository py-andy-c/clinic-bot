import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import { ClinicSettings } from '../schemas/api';
import { AppointmentType } from '../types';
import { useAuth } from '../hooks/useAuth';

const SettingsPage: React.FC = () => {
  const { isClinicAdmin } = useAuth();

  // Only clinic admins can access clinic settings
  if (!isClinicAdmin) {
    return (
      <div className="space-y-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">診所設定</h1>
          </div>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-6 text-center">
          <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-yellow-600 text-xl">⚠️</span>
          </div>
          <h3 className="text-lg font-medium text-yellow-800 mb-2">無權限存取設定</h3>
          <p className="text-yellow-700">
            只有診所管理員才能查看此頁面。如有需要，請聯絡管理員。
          </p>
        </div>
      </div>
    );
  }

  // For clinic admins, show clinic settings
  const [settings, setSettings] = useState<ClinicSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const data = await apiService.getClinicSettings();
      setSettings(data);
    } catch (err) {
      setError('無法載入設定');
      console.error('Fetch settings error:', err);
    } finally {
      setLoading(false);
    }
  };

  const validateSettings = (): string | null => {
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

  const handleSaveSettings = async () => {
    if (!settings) return;

    // Validate before saving
    const validationError = validateSettings();
    if (validationError) {
      alert(`驗證失敗: ${validationError}`);
      return;
    }

    // Convert reminder hours to number for backend
    const settingsToSave = {
      ...settings,
      notification_settings: {
        ...settings.notification_settings,
        reminder_hours_before: parseInt(String(settings.notification_settings.reminder_hours_before)) || 24
      }
    };

    try {
      setSaving(true);
      await apiService.updateClinicSettings(settingsToSave);
      alert('設定已儲存');
    } catch (err) {
      console.error('Save settings error:', err);
      alert('儲存設定失敗，請稍後再試');
    } finally {
      setSaving(false);
    }
  };

  const addAppointmentType = () => {
    if (!settings) return;

    const newType: AppointmentType = {
      id: Date.now(), // Temporary ID for UI
      clinic_id: settings.clinic_id || 0, // Use clinic_id from settings or default
      name: '',
      duration_minutes: 30,
    };

    setSettings({
      ...settings,
      appointment_types: [...settings.appointment_types, newType],
    });
  };

  const updateAppointmentType = (index: number, field: keyof AppointmentType, value: string | number) => {
    if (!settings) return;

    const updatedTypes = [...settings.appointment_types];
    updatedTypes[index] = {
      ...updatedTypes[index],
      [field]: value
    } as AppointmentType;

    setSettings({
      ...settings,
      appointment_types: updatedTypes,
    });
  };


  const removeAppointmentType = (index: number) => {
    if (!settings) return;

    const updatedTypes = settings.appointment_types.filter((_, i) => i !== index);
    setSettings({
      ...settings,
      appointment_types: updatedTypes,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">無法載入設定</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">設定</h1>
        </div>
        {isClinicAdmin ? (
          <button
            onClick={handleSaveSettings}
            disabled={saving}
            className="btn-primary"
          >
            {saving ? '儲存中...' : '儲存設定'}
          </button>
        ) : (
          <div className="text-sm text-gray-500 bg-gray-50 px-3 py-2 rounded-md">
            🔒 僅管理員可修改設定
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {/* Appointment Types */}
      <div className="card">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-medium text-gray-900">預約類型</h2>
          {isClinicAdmin && (
            <button
              onClick={addAppointmentType}
              className="btn-secondary text-sm"
            >
              新增類型
            </button>
          )}
        </div>

        <div className="space-y-4">
          {settings.appointment_types.map((type, index) => (
            <div key={type.id} className="flex items-center space-x-4 p-4 border border-gray-200 rounded-lg">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  類型名稱
                </label>
                <input
                  type="text"
                  value={type.name}
                  onChange={(e) => updateAppointmentType(index, 'name', e.target.value)}
                  className="input"
                  placeholder="例如：初診評估"
                  disabled={!isClinicAdmin}
                />
              </div>

              <div className="w-32">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  時長 (分鐘)
                </label>
                <input
                  type="number"
                  value={type.duration_minutes}
                  onChange={(e) => {
                    const value = e.target.value;
                    updateAppointmentType(index, 'duration_minutes', value);
                  }}
                  className="input"
                  min="15"
                  max="480"
                  disabled={!isClinicAdmin}
                />
              </div>

              {isClinicAdmin && (
                <div className="flex items-end">
                  <button
                    onClick={() => removeAppointmentType(index)}
                    className="text-red-600 hover:text-red-800 p-2"
                    title="刪除"
                  >
                    🗑️
                  </button>
                </div>
              )}
            </div>
          ))}

          {settings.appointment_types.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              尚未設定任何預約類型
            </div>
          )}
        </div>
      </div>

      {/* Reminder Settings */}
      <div className="card">
        <h2 className="text-lg font-medium text-gray-900 mb-6">提醒設定</h2>

        <div className="max-w-md">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            預約前幾小時發送提醒
          </label>
          <input
            type="number"
            value={settings.notification_settings.reminder_hours_before}
            onChange={(e) => {
              const value = e.target.value;
              setSettings({
                ...settings,
                notification_settings: {
                  ...settings.notification_settings,
                  reminder_hours_before: value // Allow any input during editing
                }
              });
            }}
            className="input"
            min="1"
            max="168"
            disabled={!isClinicAdmin}
          />
          <p className="text-sm text-gray-500 mt-1">
            預設為 24 小時前發送提醒
          </p>
        </div>
      </div>

    </div>
  );
};

export default SettingsPage;


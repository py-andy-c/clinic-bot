import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import { ClinicSettings } from '../schemas/api';
import { AppointmentType } from '../types';
import { useAuth } from '../hooks/useAuth';

const SettingsPage: React.FC = () => {
  const { isClinicAdmin } = useAuth();
  const [settings, setSettings] = useState<ClinicSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [tempValues, setTempValues] = useState<{[key: string]: string}>({});

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

  const handleSaveSettings = async () => {
    if (!settings) return;

    try {
      setSaving(true);
      await apiService.updateClinicSettings(settings);
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

  const handleChange = (index: number, field: keyof AppointmentType, value: string) => {
    if (composing) {
      // During composition, update temp values for display only
      const key = `${index}-${field}`;
      setTempValues(prev => ({ ...prev, [key]: value }));
    } else {
      // Normal typing - validate and update state
      let processedValue: string | number = value;
      if (field === 'duration_minutes') {
        const numValue = parseInt(value);
        processedValue = isNaN(numValue) ? 30 : numValue;
      }

      if (validateAppointmentTypeValue(field, processedValue)) {
        updateAppointmentType(index, field, processedValue);
      }
      // If invalid, don't update state - input will revert to previous value
    }
  };

  const handleCompositionStart = () => {
    setComposing(true);
  };

  const validateAppointmentTypeValue = (field: keyof AppointmentType, value: string | number): boolean => {
    if (field === 'name') {
      // Name should be non-empty string
      return typeof value === 'string' && value.trim().length > 0;
    } else if (field === 'duration_minutes') {
      // Duration should be number between 15 and 480
      const num = typeof value === 'string' ? parseInt(value) : value;
      return !isNaN(num) && num >= 15 && num <= 480;
    }
    return false;
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>, index: number, field: keyof AppointmentType) => {
    setComposing(false);
    const finalValue = e.currentTarget.value;

    // Validate the final composed value
    let processedValue: string | number = finalValue;
    if (field === 'duration_minutes') {
      const numValue = parseInt(finalValue);
      processedValue = isNaN(numValue) ? 30 : numValue; // Default to 30 if invalid
    }

    // Only update if valid
    if (validateAppointmentTypeValue(field, processedValue)) {
      // Clear temp value and update with final composed text
      const key = `${index}-${field}`;
      setTempValues(prev => {
        const newTemp = { ...prev };
        delete newTemp[key];
        return newTemp;
      });

      updateAppointmentType(index, field, processedValue);
    } else {
      // Invalid value - reset to previous valid value
      const key = `${index}-${field}`;
      setTempValues(prev => {
        const newTemp = { ...prev };
        delete newTemp[key];
        return newTemp;
      });
      // Don't update state - let it revert to previous value
    }
  };

  const getDisplayValue = (index: number, field: keyof AppointmentType) => {
    if (composing) {
      const key = `${index}-${field}`;
      return tempValues[key] !== undefined ? tempValues[key] : settings?.appointment_types[index]?.[field] || '';
    }
    return settings?.appointment_types[index]?.[field] || '';
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
                  value={getDisplayValue(index, 'name')}
                  onChange={(e) => handleChange(index, 'name', e.target.value)}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={(e) => handleCompositionEnd(e, index, 'name')}
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
                  value={getDisplayValue(index, 'duration_minutes')}
                  onChange={(e) => handleChange(index, 'duration_minutes', e.target.value)}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={(e) => handleCompositionEnd(e, index, 'duration_minutes')}
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
              const value = parseInt(e.target.value) || 24;
              setSettings({
                ...settings,
                notification_settings: {
                  ...settings.notification_settings,
                  reminder_hours_before: value
                }
              });
            }}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={() => setComposing(false)}
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

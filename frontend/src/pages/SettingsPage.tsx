import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import { ClinicSettings } from '../schemas/api';
import { AppointmentType } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useUnsavedChangesDetection } from '../hooks/useUnsavedChangesDetection';
import ClinicAppointmentTypes from '../components/ClinicAppointmentTypes';
import ClinicReminderSettings from '../components/ClinicReminderSettings';

const SettingsPage: React.FC = () => {
  const { isClinicAdmin, isClinicUser } = useAuth();

  // Only clinic users can access clinic settings
  if (!isClinicUser) {
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
            只有診所成員才能查看此頁面。
          </p>
        </div>
      </div>
    );
  }

  // For all clinic users, show clinic settings (read-only for non-admins)
  const [settings, setSettings] = useState<ClinicSettings | null>(null);
  const [originalSettings, setOriginalSettings] = useState<ClinicSettings | null>(null);
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
      setOriginalSettings(JSON.parse(JSON.stringify(data))); // Deep clone for comparison
    } catch (err) {
      setError('無法載入設定');
      console.error('Fetch settings error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Check if there are unsaved changes
  const hasUnsavedChanges = () => {
    if (!settings || !originalSettings) return false;
    return JSON.stringify(settings) !== JSON.stringify(originalSettings);
  };

  // Check for specific section changes
  const hasAppointmentTypeChanges = () => {
    if (!settings || !originalSettings) return false;
    return JSON.stringify(settings.appointment_types) !== JSON.stringify(originalSettings.appointment_types);
  };

  const hasReminderSettingsChanges = () => {
    if (!settings || !originalSettings) return false;
    return settings.notification_settings.reminder_hours_before !== originalSettings.notification_settings.reminder_hours_before;
  };

  // Setup navigation warnings for unsaved changes
  useUnsavedChangesDetection({ hasUnsavedChanges: () => hasUnsavedChanges() });

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
      // Update original settings after successful save
      setOriginalSettings(JSON.parse(JSON.stringify(settings)));
      alert('設定已更新');
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
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">診所設定</h1>
          {!isClinicAdmin && (
            <div className="mt-2 text-sm text-gray-500 bg-gray-50 px-3 py-2 rounded-md inline-block">
            🔒 唯讀模式 - 僅管理員可修改設定
          </div>
        )}
      </div>

        <div className="space-y-8">
          {/* Single Form */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <form onSubmit={(e) => { e.preventDefault(); handleSaveSettings(); }}>
      {/* Appointment Types */}
              <ClinicAppointmentTypes
                appointmentTypes={settings.appointment_types}
                onAddType={addAppointmentType}
                onUpdateType={updateAppointmentType}
                onRemoveType={removeAppointmentType}
                showSaveButton={hasAppointmentTypeChanges()}
                onSave={handleSaveSettings}
                saving={saving}
                isClinicAdmin={isClinicAdmin}
              />

      {/* Reminder Settings */}
              <ClinicReminderSettings
                reminderHoursBefore={settings.notification_settings.reminder_hours_before}
                onReminderHoursChange={(value) => {
              setSettings({
                ...settings,
                notification_settings: {
                  ...settings.notification_settings,
                      reminder_hours_before: value
                }
              });
            }}
                showSaveButton={hasReminderSettingsChanges()}
                onSave={handleSaveSettings}
                saving={saving}
                isClinicAdmin={isClinicAdmin}
          />

              {/* Error Display */}
              {error && (
                <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-md">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-red-800">錯誤</h3>
                      <div className="mt-2 text-sm text-red-700">
                        <p>{error}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;


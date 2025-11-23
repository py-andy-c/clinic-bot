import React, { useState, useCallback } from 'react';
import { TimeInterval } from '../types';
import { logger } from '../utils/logger';
import { LoadingSpinner } from '../components/shared';
import { useAuth } from '../hooks/useAuth';
import { useSettingsPage } from '../hooks/useSettingsPage';
import { useModal } from '../contexts/ModalContext';
import { validateProfileSettings, getProfileSectionChanges } from '../utils/profileSettings';
import { apiService } from '../services/api';
import { useApiData } from '../hooks/useApiData';
import { ClinicSettings } from '../schemas/api';
import ProfileForm from '../components/ProfileForm';
import AvailabilitySettings from '../components/AvailabilitySettings';
import PractitionerAppointmentTypes from '../components/PractitionerAppointmentTypes';
import CompactScheduleSettings from '../components/CompactScheduleSettings';
import PractitionerNotificationTimeSettings from '../components/PractitionerNotificationTimeSettings';
import AdminAutoAssignedNotificationTimeSettings from '../components/AdminAutoAssignedNotificationTimeSettings';
import PageHeader from '../components/PageHeader';

interface LineLinkingSectionProps {
  lineLinked: boolean;
  onRefresh: () => void;
  clinicName?: string | undefined;
}

const LineLinkingSection: React.FC<LineLinkingSectionProps> = ({ lineLinked, onRefresh, clinicName }) => {
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const { alert, confirm } = useModal();

  const handleGenerateCode = async () => {
    setIsGenerating(true);
    try {
      const response = await apiService.generateLinkCode();
      setLinkCode(response.code);
      setExpiresAt(new Date(response.expires_at));
    } catch (err: any) {
      logger.error('Error generating link code:', err);
      alert('產生連結代碼失敗', err?.response?.data?.detail || '請稍後再試');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUnlink = async () => {
    const confirmed = await confirm(
      '取消連結 LINE 帳號',
      '確定要取消連結 LINE 帳號嗎？您將不再收到預約通知。'
    );
    if (!confirmed) return;

    setIsUnlinking(true);
    try {
      await apiService.unlinkLineAccount();
      alert('成功', 'LINE 帳號已取消連結');
      onRefresh();
    } catch (err: any) {
      logger.error('Error unlinking LINE account:', err);
      alert('取消連結失敗', err?.response?.data?.detail || '請稍後再試');
    } finally {
      setIsUnlinking(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      alert('已複製', '連結代碼已複製到剪貼簿');
    }).catch(err => {
      logger.error('Failed to copy:', err);
    });
  };

  return (
    <div className="space-y-4">
        {/* Status */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-700">
              {lineLinked ? (
                <span className="flex items-center">
                  <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                  LINE 帳號已連結
                </span>
              ) : (
                <span className="flex items-center">
                  <span className="w-2 h-2 bg-gray-400 rounded-full mr-2"></span>
                  LINE 帳號尚未連結
                </span>
              )}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {lineLinked
                ? `您將從${clinicName ? `「${clinicName}」` : '診所'}的 LINE 官方帳號收到新預約通知`
                : `連結 LINE 帳號以從${clinicName ? `「${clinicName}」` : '診所'}的 LINE 官方帳號接收預約通知`}
            </p>
          </div>
        </div>

        {/* Link Code Display */}
        {linkCode && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm font-medium text-blue-900 mb-2">
              請使用您的「個人 LINE 帳號」，傳送以下訊息給{clinicName ? `「${clinicName}」` : '「診所」'}官方帳號：
            </p>
            <div className="flex items-center space-x-2 mb-2">
              <code className="flex-1 bg-white border border-blue-300 rounded px-3 py-2 text-lg font-mono text-blue-900">
                {linkCode}
              </code>
              <button
                type="button"
                onClick={() => copyToClipboard(linkCode)}
                className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
              >
                複製
              </button>
            </div>
            {expiresAt && (
              <p className="text-xs text-blue-700">
                此代碼將於 {expiresAt.toLocaleString('zh-TW')} 過期
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex space-x-3">
          {!lineLinked && (
            <button
              type="button"
              onClick={handleGenerateCode}
              disabled={isGenerating}
              className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {isGenerating ? '產生中...' : '產生連結代碼'}
            </button>
          )}
          {lineLinked && (
            <button
              type="button"
              onClick={handleUnlink}
              disabled={isUnlinking}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {isUnlinking ? '取消連結中...' : '取消連結'}
            </button>
          )}
        </div>
      </div>
  );
};

interface PractitionerSettings {
  compact_schedule_enabled: boolean;
  next_day_notification_time?: string;
  auto_assigned_notification_time?: string;
}

interface ProfileData {
  fullName: string;
  schedule: any;
  selectedAppointmentTypeIds: number[];
  settings?: PractitionerSettings;
}

const ProfilePage: React.FC = () => {
  const { user, isLoading, user: authUser } = useAuth();
  const activeClinicId = authUser?.active_clinic_id;
  const { alert } = useModal();


  // Profile state for display (set from useSettingsPage fetchData)
  const [profile, setProfile] = React.useState<any>(null);

  // Fetch clinic settings with caching to pass to PractitionerAppointmentTypes
  // This eliminates duplicate API calls
  const fetchClinicSettingsFn = useCallback(() => apiService.getClinicSettings(), []);
  const { data: clinicSettings } = useApiData<ClinicSettings>(
    fetchClinicSettingsFn,
    {
      enabled: !isLoading && !!user,
      dependencies: [isLoading, user, activeClinicId],
      cacheTTL: 5 * 60 * 1000, // 5 minutes cache
    }
  );

  const {
    data: profileData,
    uiState,
    sectionChanges,
    saveData,
    updateData,
    fetchData,
  } = useSettingsPage<ProfileData>({
    fetchData: async () => {
      const result: ProfileData = {
        fullName: '',
        schedule: {},
        selectedAppointmentTypeIds: [],
        settings: {
          compact_schedule_enabled: false,
        },
      };

      // Fetch profile (useSettingsPage handles the fetching, eliminating duplicate calls)
      let profileToUse: any = null;
      try {
        profileToUse = await apiService.getProfile();
        setProfile(profileToUse); // Set profile state for display
      } catch (err) {
        logger.error('Error fetching profile:', err);
      }

      // Set the full name from the profile
      if (profileToUse) {
        result.fullName = profileToUse.full_name || '';
        // Set settings from profile
        if (profileToUse.settings) {
          const settings = profileToUse.settings as PractitionerSettings;
          result.settings = {
            compact_schedule_enabled: Boolean(settings?.compact_schedule_enabled),
            next_day_notification_time: settings?.next_day_notification_time || '21:00',
            auto_assigned_notification_time: settings?.auto_assigned_notification_time || '21:00',
          };
        } else {
          // Initialize with defaults if no settings exist
          result.settings = {
            compact_schedule_enabled: false,
            next_day_notification_time: '21:00',
            auto_assigned_notification_time: '21:00',
          };
        }
      }

      // Fetch availability schedule (only for practitioners)
      if (user?.roles?.includes('practitioner') && user.user_id) {
        try {
          const scheduleData = await apiService.getPractitionerDefaultSchedule(user.user_id);
          result.schedule = scheduleData;
        } catch (err) {
          logger.warn('Could not fetch availability schedule:', err);
        }

        // Fetch practitioner's appointment types
        try {
          const practitionerData = await apiService.getPractitionerAppointmentTypes(user.user_id);
          result.selectedAppointmentTypeIds = practitionerData.appointment_types.map((at: any) => at.id);
        } catch (err) {
          logger.warn('Could not fetch practitioner appointment types:', err);
        }
      }

      return result;
    },
    saveData: async (data: ProfileData) => {
      // Prepare profile update data
      const profileUpdate: { full_name?: string; settings?: PractitionerSettings } = {};

      // Check if full name changed
      if (data.fullName !== profile?.full_name) {
        profileUpdate.full_name = data.fullName;
      }

      // Check if settings changed (for practitioners and admins)
      if ((user?.roles?.includes('practitioner') || user?.roles?.includes('admin')) && data.settings) {
        const currentSettings = (profile?.settings as PractitionerSettings | undefined) || {
          compact_schedule_enabled: false,
          next_day_notification_time: '21:00',
          auto_assigned_notification_time: '21:00'
        };
        const newSettings = data.settings;

        // Check if any setting changed
        const settingsChanged =
          currentSettings.compact_schedule_enabled !== newSettings.compact_schedule_enabled ||
          (currentSettings.next_day_notification_time || '21:00') !== (newSettings.next_day_notification_time || '21:00') ||
          (currentSettings.auto_assigned_notification_time || '21:00') !== (newSettings.auto_assigned_notification_time || '21:00');

        if (settingsChanged) {
          profileUpdate.settings = newSettings;
        }
      }

      // Save profile changes if any
      if (Object.keys(profileUpdate).length > 0) {
        const updatedProfile = await apiService.updateProfile(profileUpdate);
        setProfile(updatedProfile);
      }

      // Save schedule and appointment types changes (only for practitioners)
      if (user?.roles?.includes('practitioner') && user.user_id) {
        // Always save schedule for practitioners
        await apiService.updatePractitionerDefaultSchedule(user.user_id, data.schedule);

        // Filter appointment type IDs to only include valid ones for current clinic
        // This prevents errors when switching clinics (old clinic's appointment type IDs might still be in state)
        try {
          const clinicSettings = await apiService.getClinicSettings();
          const validAppointmentTypeIds = new Set(
            clinicSettings.appointment_types.map((at: { id: number }) => at.id)
          );
          const filteredAppointmentTypeIds = data.selectedAppointmentTypeIds.filter(
            (id: number) => validAppointmentTypeIds.has(id)
          );

          await apiService.updatePractitionerAppointmentTypes(user.user_id, filteredAppointmentTypeIds);
        } catch (err) {
          logger.error('Error filtering appointment types before save:', err);
          // If we can't get clinic settings, try to save anyway (backend will validate)
          await apiService.updatePractitionerAppointmentTypes(user.user_id, data.selectedAppointmentTypeIds);
        }
      }
    },
    validateData: validateProfileSettings,
    getSectionChanges: getProfileSectionChanges,
    onValidationError: async (error: string) => {
      await alert(error, '無效的時間區間');
    },
    onSaveError: async (error: string) => {
      await alert(error, '儲存失敗');
    },
  }, { isLoading });

  // Refresh profile data when clinic changes
  React.useEffect(() => {
    if (!isLoading && activeClinicId && fetchData) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClinicId]);

  const handleAddInterval = (dayKey: string) => {
    if (!profileData) return;

    const newInterval: TimeInterval = {
      start_time: '09:00',
      end_time: '18:00',
    };

    const updatedSchedule = {
      ...profileData.schedule,
      [dayKey]: [...(profileData.schedule[dayKey] || []), newInterval],
    };

    updateData({ schedule: updatedSchedule });
  };

  const handleUpdateInterval = (
    dayKey: string,
    index: number,
    field: keyof TimeInterval,
    value: string
  ) => {
    if (!profileData) return;

    const daySchedule = profileData.schedule[dayKey] || [];
    const updatedIntervals = daySchedule.map((interval: any, i: number) =>
      i === index ? { ...interval, [field]: value } : interval
    );

    const updatedSchedule = {
      ...profileData.schedule,
      [dayKey]: updatedIntervals,
    };

    updateData({ schedule: updatedSchedule });
  };

  const handleRemoveInterval = (dayKey: string, index: number) => {
    if (!profileData) return;

    const daySchedule = profileData.schedule[dayKey] || [];
    const updatedSchedule = {
      ...profileData.schedule,
      [dayKey]: daySchedule.filter((_: any, i: number) => i !== index),
    };

    updateData({ schedule: updatedSchedule });
  };

  if (uiState.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-gray-600 text-xl">找不到個人資料</div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <PageHeader title="個人設定" />

      <div className="space-y-8">
        {/* Single Form */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <form onSubmit={(e) => { e.preventDefault(); saveData(); }}>
              {/* Profile Form */}
              <ProfileForm
                profile={profile}
                fullName={profileData?.fullName || ''}
                onFullNameChange={(name) => updateData({ fullName: name })}
                showSaveButton={sectionChanges.profile || false}
                onSave={saveData}
                saving={uiState.saving}
              />

              {/* Availability Settings (Only for practitioners) */}
              {profile?.roles?.includes('practitioner') && (
                <AvailabilitySettings
                  schedule={profileData?.schedule || {}}
                  onAddInterval={handleAddInterval}
                  onUpdateInterval={handleUpdateInterval}
                  onRemoveInterval={handleRemoveInterval}
                  showSaveButton={sectionChanges.schedule || false}
                  onSave={saveData}
                  saving={uiState.saving}
                />
              )}

              {/* Practitioner Appointment Types (Only for practitioners) */}
              {profile?.roles?.includes('practitioner') && (
                <div className="pt-6">
                  <PractitionerAppointmentTypes
                    selectedAppointmentTypeIds={profileData?.selectedAppointmentTypeIds || []}
                    {...(clinicSettings?.appointment_types ? { availableTypes: clinicSettings.appointment_types } : {})}
                    onAppointmentTypeChange={(selectedTypeIds) => updateData({ selectedAppointmentTypeIds: selectedTypeIds })}
                    showSaveButton={sectionChanges.appointmentTypes || false}
                    onSave={saveData}
                    saving={uiState.saving}
                  />
                </div>
              )}

              {/* Compact Schedule Settings (Only for practitioners) */}
              {profile?.roles?.includes('practitioner') && (
                <CompactScheduleSettings
                  compactScheduleEnabled={profileData?.settings?.compact_schedule_enabled || false}
                  onToggle={(enabled) => updateData({
                    settings: {
                      ...profileData?.settings,
                      compact_schedule_enabled: enabled
                    }
                  })}
                  showSaveButton={sectionChanges.settings || false}
                  onSave={saveData}
                  saving={uiState.saving}
                />
              )}

              {/* LINE Notification Settings */}
              <div className="pt-6">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-medium text-gray-900">LINE 通知設定</h3>
                  {sectionChanges.settings && (
                    <button
                      type="button"
                      onClick={saveData}
                      disabled={uiState.saving}
                      className="btn-primary"
                    >
                      {uiState.saving ? '儲存中...' : '儲存更變'}
                    </button>
                  )}
                </div>

                <LineLinkingSection
                  lineLinked={profile?.line_linked || false}
                  onRefresh={() => {
                    apiService.getProfile().then(setProfile).catch(err => logger.error('Error refreshing profile:', err));
                  }}
                  clinicName={(() => {
                    // Get clinic name from available clinics
                    if (user?.available_clinics && activeClinicId) {
                      const activeClinic = user.available_clinics.find(c => c.id === activeClinicId);
                      return activeClinic?.display_name || activeClinic?.name || undefined;
                    }
                    return undefined;
                  })()}
                />

                {/* Practitioner Next Day Notification Time (Only for practitioners) */}
                {profile?.roles?.includes('practitioner') && (
                  <PractitionerNotificationTimeSettings
                    notificationTime={profileData?.settings?.next_day_notification_time || '21:00'}
                    onNotificationTimeChange={(time) => updateData({
                      settings: {
                        compact_schedule_enabled: profileData?.settings?.compact_schedule_enabled || false,
                        next_day_notification_time: time,
                        auto_assigned_notification_time: profileData?.settings?.auto_assigned_notification_time || '21:00'
                      }
                    })}
                  />
                )}

                {/* Admin Auto-Assigned Notification Time (Only for admins) */}
                {profile?.roles?.includes('admin') && (
                  <AdminAutoAssignedNotificationTimeSettings
                    notificationTime={profileData?.settings?.auto_assigned_notification_time || '21:00'}
                    onNotificationTimeChange={(time) => updateData({
                      settings: {
                        compact_schedule_enabled: profileData?.settings?.compact_schedule_enabled || false,
                        next_day_notification_time: profileData?.settings?.next_day_notification_time || '21:00',
                        auto_assigned_notification_time: time
                      }
                    })}
                  />
                )}
              </div>
          </form>
        </div>

        {/* System Admin Notice */}
        {profile.user_type === 'system_admin' && (
          <div className="bg-blue-50 rounded-lg p-6">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-blue-800">系統管理員</h3>
                <div className="mt-2 text-sm text-blue-700">
                  <p>您正在以系統管理員身份使用此應用程式。</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProfilePage;
import React, { useState, useEffect } from 'react';
import { TimeInterval } from '../types';
import { logger } from '../utils/logger';
import { LoadingSpinner } from '../components/shared';
import { useAuth } from '../hooks/useAuth';
import { useSettingsPage } from '../hooks/useSettingsPage';
import { useModal } from '../contexts/ModalContext';
import { validateProfileSettings, getProfileSectionChanges } from '../utils/profileSettings';
import { apiService } from '../services/api';
import { invalidateCacheByPattern } from '../hooks/useApiData';
import ProfileForm from '../components/ProfileForm';
import { getErrorMessage } from '../types/api';
import AvailabilitySettings from '../components/AvailabilitySettings';
import CompactScheduleSettings from '../components/CompactScheduleSettings';
import PractitionerNotificationTimeSettings from '../components/PractitionerNotificationTimeSettings';
import AdminAutoAssignedNotificationTimeSettings from '../components/AdminAutoAssignedNotificationTimeSettings';
import AdminAppointmentChangeSubscriptionSettings from '../components/AdminAppointmentChangeSubscriptionSettings';
import PractitionerStepSizeSettings from '../components/PractitionerStepSizeSettings';
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
    } catch (err: unknown) {
      logger.error('Error generating link code:', err);
      alert('產生連結代碼失敗', getErrorMessage(err) || '請稍後再試');
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
    } catch (err: unknown) {
      logger.error('Error unlinking LINE account:', err);
      alert('取消連結失敗', getErrorMessage(err) || '請稍後再試');
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
  step_size_minutes?: number | null;
  // Admin-only fields
  subscribe_to_appointment_changes?: boolean;
  auto_assigned_notification_mode?: 'immediate' | 'scheduled';
}

interface ProfileData {
  fullName: string;
  title: string;
  schedule: Record<string, TimeInterval[]>;
  settings?: PractitionerSettings;
  clinicDefaultStep?: number;
}

const ProfilePage: React.FC = () => {
  const { user, isLoading, user: authUser } = useAuth();
  const activeClinicId = authUser?.active_clinic_id;
  const { alert } = useModal();

  // Scroll to top when component mounts
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Profile state for display (set from useSettingsPage fetchData)
  const [profile, setProfile] = React.useState<{ full_name?: string; title?: string; settings?: PractitionerSettings; roles?: string[]; line_linked?: boolean; user_type?: string; schedule?: Record<string, TimeInterval[]> } | null>(null);

  const {
    data: profileData,
    uiState,
    sectionChanges,
    saveData,
    updateData,
    fetchData,
  } = useSettingsPage<ProfileData & { clinicDefaultStep?: number } & Record<string, unknown>>({
    fetchData: async () => {
      const result: ProfileData & { clinicDefaultStep?: number } = {
        fullName: '',
        title: '',
        schedule: {},
        settings: {
          compact_schedule_enabled: false,
          step_size_minutes: null,
        },
        clinicDefaultStep: 30,
      };

      // Fetch profile
      let profileToUse: any = null;
      try {
        profileToUse = await apiService.getProfile();
        setProfile(profileToUse);
      } catch (err) {
        logger.error('Error fetching profile:', err);
      }

      // Set the full name and title from the profile
      if (profileToUse) {
        result.fullName = profileToUse.full_name || '';
        result.title = profileToUse.title || '';
        // Set settings from profile
        if (profileToUse.settings) {
          const settings = profileToUse.settings as PractitionerSettings;
          result.settings = {
            compact_schedule_enabled: Boolean(settings?.compact_schedule_enabled),
            next_day_notification_time: settings?.next_day_notification_time || '21:00',
            auto_assigned_notification_time: settings?.auto_assigned_notification_time || '21:00',
            step_size_minutes: settings?.step_size_minutes ?? null,
            subscribe_to_appointment_changes: settings?.subscribe_to_appointment_changes ?? false,
            auto_assigned_notification_mode: settings?.auto_assigned_notification_mode || 'scheduled',
          };
        } else {
          // Initialize with defaults if no settings exist
          result.settings = {
            compact_schedule_enabled: false,
            next_day_notification_time: '21:00',
            auto_assigned_notification_time: '21:00',
            step_size_minutes: null,
            subscribe_to_appointment_changes: false,
            auto_assigned_notification_mode: 'scheduled',
          };
        }
      }

      // Fetch clinic default step size
      if (activeClinicId) {
        try {
          const clinicSettings = await apiService.getClinicSettings();
          result.clinicDefaultStep = Number(clinicSettings.booking_restriction_settings.step_size_minutes);
        } catch (err) {
          logger.warn('Could not fetch clinic settings for default step size:', err);
        }
      }

      // Fetch availability schedule (only for practitioners)
      if (user?.roles?.includes('practitioner') && user.user_id) {
        try {
          const scheduleData = await apiService.getPractitionerDefaultSchedule(user.user_id);
          result.schedule = scheduleData as any;
        } catch (err) {
          logger.warn('Could not fetch availability schedule:', err);
        }
      }

      return result;
    },
    saveData: async (data: ProfileData) => {
      // Prepare profile update data
      const profileUpdate: { full_name?: string; title?: string; settings?: PractitionerSettings } = {};

      // Check if full name changed
      if (data.fullName !== profile?.full_name) {
        profileUpdate.full_name = data.fullName;
      }

      // Check if title changed
      if (data.title !== (profile?.title || '')) {
        profileUpdate.title = data.title;
      }

      // Check if settings changed (for practitioners and admins)
      if ((user?.roles?.includes('practitioner') || user?.roles?.includes('admin')) && data.settings) {
        const currentSettings = (profile?.settings as PractitionerSettings | undefined) || {
          compact_schedule_enabled: false,
          next_day_notification_time: '21:00',
          auto_assigned_notification_time: '21:00',
          step_size_minutes: null,
          subscribe_to_appointment_changes: false,
          auto_assigned_notification_mode: 'scheduled',
        };
        const newSettings = data.settings;

        // Check if any setting changed
        const settingsChanged =
          currentSettings.compact_schedule_enabled !== newSettings.compact_schedule_enabled ||
          (currentSettings.next_day_notification_time || '21:00') !== (newSettings.next_day_notification_time || '21:00') ||
          (currentSettings.auto_assigned_notification_time || '21:00') !== (newSettings.auto_assigned_notification_time || '21:00') ||
          currentSettings.step_size_minutes !== newSettings.step_size_minutes ||
          (currentSettings.subscribe_to_appointment_changes ?? false) !== (newSettings.subscribe_to_appointment_changes ?? false) ||
          (currentSettings.auto_assigned_notification_mode || 'scheduled') !== (newSettings.auto_assigned_notification_mode || 'scheduled');

        if (settingsChanged) {
          profileUpdate.settings = newSettings;
        }
      }

      // Save profile changes if any
      if (Object.keys(profileUpdate).length > 0) {
        const updatedProfile = await apiService.updateProfile(profileUpdate);
        setProfile(updatedProfile);
      }

      // Save schedule changes (only for practitioners)
      if (user?.roles?.includes('practitioner') && user.user_id) {
        // Always save schedule for practitioners
        await apiService.updatePractitionerDefaultSchedule(user.user_id, data.schedule);
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
    onSuccess: async () => {
      // Invalidate practitioner status cache so warnings update after profile changes
      invalidateCacheByPattern('api_getPractitionerStatus_');
      invalidateCacheByPattern('api_getBatchPractitionerStatus_');

      // Show success message using modal
      await alert('設定已更新', '成功');
    },
  }, { isLoading });

  // Refresh profile data when clinic changes (skip initial mount to avoid duplicate fetch)
  const previousClinicIdRef = React.useRef<number | null | undefined>(activeClinicId);
  React.useEffect(() => {
    // Only fetch if clinic actually changed (not on initial mount)
    if (!isLoading && activeClinicId !== undefined && fetchData && previousClinicIdRef.current !== activeClinicId) {
      fetchData();
    }
    previousClinicIdRef.current = activeClinicId ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClinicId, isLoading]);

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
    const updatedIntervals = daySchedule.map((interval: TimeInterval, i: number) =>
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
      [dayKey]: daySchedule.filter((_interval: TimeInterval, i: number) => i !== index),
    };

    updateData({ schedule: updatedSchedule });
  };

  // Helper function to update settings while preserving all existing fields
  const updateSettings = (updates: Partial<PractitionerSettings>) => {
    const currentSettings: PractitionerSettings = profileData?.settings || {
      compact_schedule_enabled: false,
      next_day_notification_time: '21:00',
      auto_assigned_notification_time: '21:00',
      step_size_minutes: null,
      subscribe_to_appointment_changes: false,
      auto_assigned_notification_mode: 'scheduled',
    };
    updateData({
      settings: {
        compact_schedule_enabled: currentSettings.compact_schedule_enabled ?? false,
        next_day_notification_time: currentSettings.next_day_notification_time || '21:00',
        auto_assigned_notification_time: currentSettings.auto_assigned_notification_time || '21:00',
        step_size_minutes: currentSettings.step_size_minutes ?? null,
        subscribe_to_appointment_changes: currentSettings.subscribe_to_appointment_changes ?? false,
        auto_assigned_notification_mode: currentSettings.auto_assigned_notification_mode || 'scheduled',
        ...updates,
      },
    });
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
    <>
      {/* Header */}
      <PageHeader title="個人設定" />

      <div className="space-y-8">
        {/* Single Form */}
        <div className="bg-white md:rounded-lg md:shadow-md p-0 md:p-6">
          <form onSubmit={(e) => { e.preventDefault(); saveData(); }}>
            {/* Profile Form */}
            <ProfileForm
              profile={profile as any}
              fullName={profileData?.fullName || ''}
              title={profileData?.title || ''}
              onFullNameChange={(name) => updateData({ fullName: name })}
              onTitleChange={(title) => updateData({ title })}
              showSaveButton={sectionChanges.profile || false}
              onSave={saveData}
              saving={uiState.saving}
            />

            {/* Availability Settings (Only for practitioners) */}
            {profile?.roles?.includes('practitioner') && (
              <div className="pt-6 border-t border-gray-200 md:pt-0 md:border-t-0">
                <AvailabilitySettings
                  schedule={profileData?.schedule as any || {}}
                  onAddInterval={handleAddInterval}
                  onUpdateInterval={handleUpdateInterval}
                  onRemoveInterval={handleRemoveInterval}
                  showSaveButton={sectionChanges.schedule || false}
                  onSave={saveData}
                  saving={uiState.saving}
                />
              </div>
            )}

            {/* Compact Schedule Settings (Only for practitioners) */}
            {profile?.roles?.includes('practitioner') && (
              <div className="pt-6 border-t border-gray-200 md:pt-0 md:border-t-0">
                <CompactScheduleSettings
                  compactScheduleEnabled={profileData?.settings?.compact_schedule_enabled || false}
                  onToggle={(enabled) => updateSettings({
                    compact_schedule_enabled: enabled
                  })}
                  showSaveButton={sectionChanges.settings || false}
                  onSave={saveData}
                  saving={uiState.saving}
                />

                <PractitionerStepSizeSettings
                  stepSizeMinutes={profileData?.settings?.step_size_minutes ?? null}
                  clinicDefaultStep={profileData?.clinicDefaultStep ?? 30}
                  onStepSizeChange={(value: number | null) => updateSettings({
                    step_size_minutes: value
                  })}
                  showSaveButton={sectionChanges.settings || false}
                  onSave={saveData}
                  saving={uiState.saving}
                />
              </div>
            )}

            {/* LINE Notification Settings */}
            <div className="pt-6 border-t border-gray-200 md:pt-0 md:border-t-0">
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
                  onNotificationTimeChange={(time) => updateSettings({
                    next_day_notification_time: time
                  })}
                />
              )}

              {/* Admin Notification Settings (Only for admins) */}
              {profile?.roles?.includes('admin') && (
                <>
                  <div className="mt-6 pt-6 border-t border-gray-200">
                    <h4 className="text-md font-medium text-gray-900 mb-4">管理員通知設定</h4>
                    
                    {/* Appointment Change Subscription */}
                    <AdminAppointmentChangeSubscriptionSettings
                      subscribed={profileData?.settings?.subscribe_to_appointment_changes ?? false}
                      onToggle={(enabled) => updateSettings({
                        subscribe_to_appointment_changes: enabled
                      })}
                    />


                    {/* Auto-Assigned Notification */}
                    <AdminAutoAssignedNotificationTimeSettings
                      notificationTime={profileData?.settings?.auto_assigned_notification_time || '21:00'}
                      notificationMode={profileData?.settings?.auto_assigned_notification_mode || 'scheduled'}
                      onNotificationTimeChange={(time) => updateSettings({
                        auto_assigned_notification_time: time
                      })}
                      onNotificationModeChange={(mode) => updateSettings({
                        auto_assigned_notification_mode: mode
                      })}
                    />
                  </div>
                </>
              )}
            </div>
          </form>
        </div>

        {/* System Admin Notice */}
        {profile.user_type === 'system_admin' && (
          <div className="bg-blue-50 rounded-lg p-4 md:p-6">
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
    </>
  );
};

export default ProfilePage;
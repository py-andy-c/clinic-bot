import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import { User } from '../types';

interface CalendarSettings {
  gcal_sync_enabled: boolean;
  gcal_watch_resource_id?: string;
}

const ProfilePage: React.FC = () => {
  const [profile, setProfile] = useState<User | null>(null);
  const [calendarSettings, setCalendarSettings] = useState<CalendarSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [fullName, setFullName] = useState('');
  const [gcalSyncEnabled, setGcalSyncEnabled] = useState(false);

  useEffect(() => {
    fetchProfileData();
  }, []);

  const fetchProfileData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch profile information
      const profileData = await apiService.getProfile();
      setProfile(profileData);
      setFullName(profileData.full_name);

      // Fetch calendar settings (only for clinic users)
      if (profileData.user_type === 'clinic_user') {
        try {
          const calendarData = await apiService.getCalendarSettings();
          setCalendarSettings(calendarData);
          setGcalSyncEnabled(calendarData.gcal_sync_enabled);
        } catch (err) {
          console.warn('Could not fetch calendar settings:', err);
          // Calendar settings might not be available for system admins
        }
      }
    } catch (err) {
      setError('無法載入個人資料');
      console.error('Fetch profile error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!profile) return;

    try {
      setSaving(true);
      setError(null);

      // Update profile information
      const updatedProfile = await apiService.updateProfile({
        full_name: fullName,
      });

      setProfile(updatedProfile);
      alert('個人資料已更新');
    } catch (err) {
      setError('更新個人資料失敗');
      console.error('Update profile error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCalendarSettings = async () => {
    if (!profile || profile.user_type === 'system_admin') return;

    try {
      setSaving(true);
      setError(null);

      // Update calendar settings
      const updatedSettings = await apiService.updateCalendarSettings({
        gcal_sync_enabled: gcalSyncEnabled,
      });

      setCalendarSettings(updatedSettings);
      alert('行事曆設定已更新');
    } catch (err) {
      setError('更新行事曆設定失敗');
      console.error('Update calendar settings error:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-600 text-xl mb-4">❌ {error}</div>
          <button
            onClick={fetchProfileData}
            className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700"
          >
            重新載入
          </button>
        </div>
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
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">個人資料</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Profile Information */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-6">基本資訊</h2>
            
            <div className="space-y-4">
              {/* Email (Read-only) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  電子郵件
                </label>
                <div className="relative">
                  <input
                    type="email"
                    value={profile.email}
                    disabled
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500 cursor-not-allowed"
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                      無法修改
                    </span>
                  </div>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  電子郵件與您的 Google 帳號綁定，無法修改
                </p>
              </div>

              {/* Full Name (Editable) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  姓名 *
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="請輸入您的姓名"
                />
              </div>

              {/* User Type and Roles */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  使用者類型
                </label>
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                    {profile.user_type === 'system_admin' ? '系統管理員' : '診所使用者'}
                  </span>
                  {profile.roles && profile.roles.length > 0 ? (
                    profile.roles.map((role) => (
                      <span
                        key={role}
                        className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800"
                      >
                        {role === 'admin' ? '管理員' : role === 'practitioner' ? '治療師' : role}
                      </span>
                    ))
                  ) : (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-800">
                      一般成員
                    </span>
                  )}
                </div>
              </div>

              {/* Account Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-200">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    帳號建立時間
                  </label>
                  <p className="text-sm text-gray-600">
                    {new Date(profile.created_at).toLocaleDateString('zh-TW')}
                  </p>
                </div>
                {profile.last_login_at && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      最後登入
                    </label>
                    <p className="text-sm text-gray-600">
                      {new Date(profile.last_login_at).toLocaleDateString('zh-TW')}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Save Button */}
            <div className="mt-6">
              <button
                onClick={handleSaveProfile}
                disabled={saving || fullName === profile.full_name}
                className="w-full px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {saving ? '儲存中...' : '儲存個人資料'}
              </button>
            </div>
          </div>

          {/* Calendar Settings (Only for clinic users) */}
          {profile.user_type === 'clinic_user' && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-6">行事曆設定</h2>
              
              <div className="space-y-4">
                {/* Google Calendar Sync */}
                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={gcalSyncEnabled}
                      onChange={(e) => setGcalSyncEnabled(e.target.checked)}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm font-medium text-gray-700">
                      啟用 Google 日曆同步
                    </span>
                  </label>
                  <p className="mt-1 text-xs text-gray-500">
                    啟用後，您的預約將自動同步到 Google 日曆
                  </p>
                </div>

                {/* Calendar Status */}
                {calendarSettings && (
                  <div className="pt-4 border-t border-gray-200">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">同步狀態</span>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        calendarSettings.gcal_sync_enabled 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {calendarSettings.gcal_sync_enabled ? '已啟用' : '未啟用'}
                      </span>
                    </div>
                    {calendarSettings.gcal_watch_resource_id && (
                      <p className="mt-1 text-xs text-gray-500">
                        監聽資源 ID: {calendarSettings.gcal_watch_resource_id}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Save Button */}
              <div className="mt-6">
                <button
                  onClick={handleSaveCalendarSettings}
                  disabled={saving}
                  className="w-full px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {saving ? '儲存中...' : '儲存行事曆設定'}
                </button>
              </div>
            </div>
          )}

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
                  <h3 className="text-sm font-medium text-blue-800">
                    系統管理員
                  </h3>
                  <div className="mt-2 text-sm text-blue-700">
                    <p>
                      您以系統管理員身份登入，可以管理所有診所和系統設定。
                      個人資料設定僅適用於診所使用者。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;

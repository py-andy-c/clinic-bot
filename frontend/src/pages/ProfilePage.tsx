import React from 'react';
import { TimeInterval } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useSettingsPage } from '../hooks/useSettingsPage';
import { validateProfileSettings, getProfileSectionChanges } from '../utils/profileSettings';
import { apiService } from '../services/api';
import ProfileForm from '../components/ProfileForm';
import AvailabilitySettings from '../components/AvailabilitySettings';
import PractitionerAppointmentTypes from '../components/PractitionerAppointmentTypes';

interface ProfileData {
  fullName: string;
  schedule: any;
  selectedAppointmentTypeIds: number[];
}

const ProfilePage: React.FC = () => {
  const { user } = useAuth();

  // Fetch user profile separately (needed for display)
  const [profile, setProfile] = React.useState<any>(null);

  React.useEffect(() => {
    const fetchProfile = async () => {
      try {
        const profileData = await apiService.getProfile();
        setProfile(profileData);
      } catch (err) {
        console.error('Error fetching profile:', err);
      }
    };
    fetchProfile();
  }, []);

  const {
    data: profileData,
    uiState,
    sectionChanges,
    saveData,
    updateData,
  } = useSettingsPage<ProfileData>({
    fetchData: async () => {
      const result: ProfileData = {
        fullName: '',
        schedule: {},
        selectedAppointmentTypeIds: [],
      };

      // Fetch availability schedule (only for practitioners)
      if (user?.roles?.includes('practitioner') && user.id) {
        try {
          const scheduleData = await apiService.getPractitionerDefaultSchedule(user.id);
          result.schedule = scheduleData;
        } catch (err) {
          console.warn('Could not fetch availability schedule:', err);
        }

        // Fetch practitioner's appointment types
        try {
          const practitionerData = await apiService.getPractitionerAppointmentTypes(user.id);
          result.selectedAppointmentTypeIds = practitionerData.appointment_types.map((at: any) => at.id);
        } catch (err) {
          console.warn('Could not fetch practitioner appointment types:', err);
        }
      }

      // Set the full name from the profile we already fetched
      if (profile) {
        result.fullName = profile.full_name;
      }

      return result;
    },
    saveData: async (data: ProfileData) => {
      // Save profile changes
      if (data.fullName !== profile?.full_name) {
        const updatedProfile = await apiService.updateProfile({ full_name: data.fullName });
        setProfile(updatedProfile);
      }

      // Save schedule and appointment types changes (only for practitioners)
      if (user?.roles?.includes('practitioner') && user.id) {
        // Always save schedule and appointment types for practitioners
        await apiService.updatePractitionerDefaultSchedule(user.id, data.schedule);
        await apiService.updatePractitionerAppointmentTypes(user.id, data.selectedAppointmentTypeIds);
      }
    },
    validateData: validateProfileSettings,
    getSectionChanges: getProfileSectionChanges,
  });

  const handleAddInterval = (dayKey: keyof typeof profileData.schedule) => {
    if (!profileData) return;

    const newInterval: TimeInterval = {
      start_time: '09:00',
      end_time: '18:00',
    };

    const updatedSchedule = {
      ...profileData.schedule,
      [dayKey]: [...profileData.schedule[dayKey], newInterval],
    };

    updateData({ schedule: updatedSchedule });
  };

  const handleUpdateInterval = (
    dayKey: keyof typeof profileData.schedule,
    index: number,
    field: keyof TimeInterval,
    value: string
  ) => {
    if (!profileData) return;

    const updatedIntervals = profileData.schedule[dayKey].map((interval, i) =>
      i === index ? { ...interval, [field]: value } : interval
    );

    const updatedSchedule = {
      ...profileData.schedule,
      [dayKey]: updatedIntervals,
    };

    updateData({ schedule: updatedSchedule });
  };

  const handleRemoveInterval = (dayKey: keyof typeof profileData.schedule, index: number) => {
    if (!profileData) return;

    const updatedSchedule = {
      ...profileData.schedule,
      [dayKey]: profileData.schedule[dayKey].filter((_, i) => i !== index),
    };

    updateData({ schedule: updatedSchedule });
  };

  if (uiState.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
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
          <h1 className="text-3xl font-bold text-gray-900">個人設定</h1>
        </div>

        <div className="space-y-8">
          {/* Single Form */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <form onSubmit={(e) => { e.preventDefault(); saveData(); }}>
              {/* Profile Form */}
              <ProfileForm
                profile={profile}
                fullName={profileData?.fullName || ''}
                onFullNameChange={(name) => updateData({ fullName: name })}
                showSaveButton={sectionChanges.profile}
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
                  showSaveButton={sectionChanges.schedule}
                  onSave={saveData}
                  saving={uiState.saving}
                />
              )}

              {/* Practitioner Appointment Types (Only for practitioners) */}
              {profile?.roles?.includes('practitioner') && (
                <div className="pt-6">
                  <PractitionerAppointmentTypes
                    selectedAppointmentTypeIds={profileData?.selectedAppointmentTypeIds || []}
                    onAppointmentTypeChange={(selectedTypeIds) => updateData({ selectedAppointmentTypeIds: selectedTypeIds })}
                    showSaveButton={sectionChanges.appointmentTypes}
                    onSave={saveData}
                    saving={uiState.saving}
                  />
                </div>
              )}

              {/* Error Display */}
              {uiState.error && (
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
                        <p>{uiState.error}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
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
    </div>
  );
};

export default ProfilePage;
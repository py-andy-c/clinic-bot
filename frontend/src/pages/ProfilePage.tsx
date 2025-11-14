import React from 'react';
import { TimeInterval } from '../types';
import { logger } from '../utils/logger';
import { LoadingSpinner } from '../components/shared';
import { useAuth } from '../hooks/useAuth';
import { useSettingsPage } from '../hooks/useSettingsPage';
import { useModal } from '../contexts/ModalContext';
import { validateProfileSettings, getProfileSectionChanges } from '../utils/profileSettings';
import { apiService } from '../services/api';
import ProfileForm from '../components/ProfileForm';
import AvailabilitySettings from '../components/AvailabilitySettings';
import PractitionerAppointmentTypes from '../components/PractitionerAppointmentTypes';
import PageHeader from '../components/PageHeader';

interface ProfileData {
  fullName: string;
  schedule: any;
  selectedAppointmentTypeIds: number[];
}

const ProfilePage: React.FC = () => {
  const { user, isLoading, user: authUser } = useAuth();
  const activeClinicId = authUser?.active_clinic_id;
  const { alert } = useModal();


  // Fetch user profile separately (needed for display)
  const [profile, setProfile] = React.useState<any>(null);

  React.useEffect(() => {
    // Wait for auth to complete before fetching profile
    if (!isLoading) {
      const fetchProfile = async () => {
        try {
          const profileData = await apiService.getProfile();
          setProfile(profileData);
        } catch (err) {
          logger.error('Error fetching profile:', err);
        }
      };
      fetchProfile();
    }
  }, [isLoading, activeClinicId]); // Refresh when clinic changes

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
      };

      // Fetch profile if not already loaded
      let profileToUse = profile;
      if (!profileToUse) {
        try {
          profileToUse = await apiService.getProfile();
          setProfile(profileToUse);
        } catch (err) {
          logger.error('Error fetching profile:', err);
        }
      }

      // Set the full name from the profile
      if (profileToUse) {
        result.fullName = profileToUse.full_name || '';
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
      // Save profile changes
      if (data.fullName !== profile?.full_name) {
        const updatedProfile = await apiService.updateProfile({ full_name: data.fullName });
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
                    onAppointmentTypeChange={(selectedTypeIds) => updateData({ selectedAppointmentTypeIds: selectedTypeIds })}
                    showSaveButton={sectionChanges.appointmentTypes || false}
                    onSave={saveData}
                    saving={uiState.saving}
                  />
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
  );
};

export default ProfilePage;
import React from 'react';
import { TimeInterval } from '../types';
import { useProfileForm } from '../hooks/useProfileForm';
import { useUnsavedChangesDetection } from '../hooks/useUnsavedChangesDetection';
import ProfileForm from '../components/ProfileForm';
import AvailabilitySettings from '../components/AvailabilitySettings';
import PractitionerAppointmentTypes from '../components/PractitionerAppointmentTypes';

const ProfilePage: React.FC = () => {
  const {
    profile,
    formData,
    originalData,
    uiState,
    saveData,
    hasUnsavedChanges,
    updateFormData,
    updateSchedule,
    updateSelectedAppointmentTypeIds,
  } = useProfileForm();

  // Setup navigation warnings
  useUnsavedChangesDetection({ hasUnsavedChanges });

  // Check which sections have changes
  const hasProfileChanges = formData.fullName !== originalData.fullName;
  const hasScheduleChanges = originalData.schedule ?
    JSON.stringify(formData.schedule) !== JSON.stringify(originalData.schedule) : false;
  const hasAppointmentTypeChanges = JSON.stringify(formData.selectedAppointmentTypeIds) !== JSON.stringify(originalData.selectedAppointmentTypeIds);

  const handleAddInterval = (dayKey: keyof typeof formData.schedule) => {
    const newInterval: TimeInterval = {
      start_time: '09:00',
      end_time: '18:00',
    };
    updateSchedule(dayKey, [...formData.schedule[dayKey], newInterval]);
  };

  const handleUpdateInterval = (
    dayKey: keyof typeof formData.schedule,
    index: number,
    field: keyof TimeInterval,
    value: string
  ) => {
    const updatedIntervals = formData.schedule[dayKey].map((interval, i) =>
      i === index ? { ...interval, [field]: value } : interval
    );
    updateSchedule(dayKey, updatedIntervals);
  };

  const handleRemoveInterval = (dayKey: keyof typeof formData.schedule, index: number) => {
    updateSchedule(dayKey, formData.schedule[dayKey].filter((_, i) => i !== index));
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
                fullName={formData.fullName}
                onFullNameChange={(name) => updateFormData({ fullName: name })}
                showSaveButton={hasProfileChanges}
                onSave={saveData}
                saving={uiState.saving}
              />

              {/* Availability Settings (Only for practitioners) */}
              {profile.roles?.includes('practitioner') && (
                <AvailabilitySettings
                  schedule={formData.schedule}
                  onAddInterval={handleAddInterval}
                  onUpdateInterval={handleUpdateInterval}
                  onRemoveInterval={handleRemoveInterval}
                  showSaveButton={hasScheduleChanges}
                  onSave={saveData}
                  saving={uiState.saving}
                />
              )}

              {/* Practitioner Appointment Types (Only for practitioners) */}
              {profile.roles?.includes('practitioner') && (
                <div className="pt-6">
                  <PractitionerAppointmentTypes
                    selectedAppointmentTypeIds={formData.selectedAppointmentTypeIds}
                    onAppointmentTypeChange={updateSelectedAppointmentTypeIds}
                    showSaveButton={hasAppointmentTypeChanges}
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
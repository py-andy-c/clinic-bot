import { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import { User, DefaultScheduleResponse, TimeInterval } from '../types';

interface ProfileFormData {
  fullName: string;
  schedule: DefaultScheduleResponse;
  selectedAppointmentTypeIds: number[];
}

interface OriginalData {
  fullName: string;
  schedule: DefaultScheduleResponse | null;
  selectedAppointmentTypeIds: number[];
}

interface UIState {
  loading: boolean;
  saving: boolean;
  error: string | null;
}

const DAYS_OF_WEEK = [
  { value: 0, label: '星期一', labelEn: 'Monday' },
  { value: 1, label: '星期二', labelEn: 'Tuesday' },
  { value: 2, label: '星期三', labelEn: 'Wednesday' },
  { value: 3, label: '星期四', labelEn: 'Thursday' },
  { value: 4, label: '星期五', labelEn: 'Friday' },
  { value: 5, label: '星期六', labelEn: 'Saturday' },
  { value: 6, label: '星期日', labelEn: 'Sunday' },
];

export const useProfileForm = () => {
  const [profile, setProfile] = useState<User | null>(null);
  const [formData, setFormData] = useState<ProfileFormData>({
    fullName: '',
    schedule: {
      monday: [],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    },
    selectedAppointmentTypeIds: [],
  });
  const [originalData, setOriginalData] = useState<OriginalData>({
    fullName: '',
    schedule: null,
    selectedAppointmentTypeIds: [],
  });
  const [uiState, setUiState] = useState<UIState>({
    loading: true,
    saving: false,
    error: null,
  });

  const validateIntervals = (intervals: TimeInterval[]): string | null => {
    for (let i = 0; i < intervals.length; i++) {
      for (let j = i + 1; j < intervals.length; j++) {
        const interval1 = intervals[i];
        const interval2 = intervals[j];

        if (interval1 && interval2 &&
          ((interval1.start_time <= interval2.start_time && interval1.end_time > interval2.start_time) ||
           (interval2.start_time <= interval1.start_time && interval2.end_time > interval1.start_time))) {
          return '時間區間不能重疊';
        }
      }
    }
    return null;
  };

  const loadData = async () => {
    try {
      setUiState(prev => ({ ...prev, loading: true, error: null }));

      // Fetch profile information
      const profileData = await apiService.getProfile();
      setProfile(profileData);
      
      const newFormData: ProfileFormData = {
        fullName: profileData.full_name,
        schedule: {
          monday: [],
          tuesday: [],
          wednesday: [],
          thursday: [],
          friday: [],
          saturday: [],
          sunday: [],
        },
        selectedAppointmentTypeIds: [],
      };

      // Fetch availability schedule (only for practitioners)
      if (profileData.roles?.includes('practitioner') && profileData.id) {
        try {
          const scheduleData = await apiService.getPractitionerDefaultSchedule(profileData.id);
          newFormData.schedule = scheduleData;
        } catch (err) {
          console.warn('Could not fetch availability schedule:', err);
        }

        // Fetch practitioner's appointment types
        try {
          const practitionerData = await apiService.getPractitionerAppointmentTypes(profileData.id);
          newFormData.selectedAppointmentTypeIds = practitionerData.appointment_types.map((at: any) => at.id);
        } catch (err) {
          console.warn('Could not fetch practitioner appointment types:', err);
        }
      }

      setFormData(newFormData);
      setOriginalData({
        fullName: profileData.full_name,
        schedule: newFormData.schedule,
        selectedAppointmentTypeIds: newFormData.selectedAppointmentTypeIds,
      });
    } catch (err) {
      setUiState(prev => ({ ...prev, error: '無法載入個人資料' }));
      console.error('Fetch profile error:', err);
    } finally {
      setUiState(prev => ({ ...prev, loading: false }));
    }
  };

  const saveData = async () => {
    if (!profile) return;

    try {
      setUiState(prev => ({ ...prev, saving: true, error: null }));

      let hasProfileChanges = false;
      let hasScheduleChanges = false;

      // Save profile changes if needed
      if (formData.fullName !== originalData.fullName) {
        const updatedProfile = await apiService.updateProfile({ full_name: formData.fullName });
        setProfile(updatedProfile);
        setOriginalData(prev => ({ ...prev, fullName: formData.fullName }));
        hasProfileChanges = true;
      }

      // Save schedule changes if needed (only for practitioners)
      if (profile.roles?.includes('practitioner') && originalData.schedule &&
          JSON.stringify(formData.schedule) !== JSON.stringify(originalData.schedule)) {

        // Validate all intervals first
        for (const dayKey of Object.keys(formData.schedule) as Array<keyof DefaultScheduleResponse>) {
          const validationError = validateIntervals(formData.schedule[dayKey]);
          if (validationError) {
            setUiState(prev => ({
              ...prev,
              error: `${DAYS_OF_WEEK.find(d => d.labelEn.toLowerCase() === dayKey)?.label}: ${validationError}`
            }));
            return;
          }
        }

        await apiService.updatePractitionerDefaultSchedule(profile.id, formData.schedule);
        setOriginalData(prev => ({ ...prev, schedule: JSON.parse(JSON.stringify(formData.schedule)) }));
        hasScheduleChanges = true;
      }

      // Save appointment types changes if needed (only for practitioners)
      if (profile.roles?.includes('practitioner') &&
          JSON.stringify(formData.selectedAppointmentTypeIds) !== JSON.stringify(originalData.selectedAppointmentTypeIds)) {
        await apiService.updatePractitionerAppointmentTypes(profile.id, formData.selectedAppointmentTypeIds);
        setOriginalData(prev => ({ ...prev, selectedAppointmentTypeIds: [...formData.selectedAppointmentTypeIds] }));
        hasScheduleChanges = true; // Reuse the same flag for any practitioner changes
      }

      // Only show success message if we actually saved something
      if (hasProfileChanges || hasScheduleChanges) {
        alert('設定已更新');
      }
    } catch (err: any) {
      console.error('Update settings error:', err);
        setUiState(prev => ({ 
          ...prev, 
          error: err.response?.data?.message || '更新設定失敗' 
        }));
    } finally {
      setUiState(prev => ({ ...prev, saving: false }));
    }
  };

  const resetData = () => {
    setFormData({
      fullName: originalData.fullName,
      schedule: originalData.schedule || {
        monday: [],
        tuesday: [],
        wednesday: [],
        thursday: [],
        friday: [],
        saturday: [],
        sunday: [],
      },
      selectedAppointmentTypeIds: originalData.selectedAppointmentTypeIds,
    });
  };


  const hasUnsavedChanges = () => {
    const profileChanged = formData.fullName !== originalData.fullName;
    const scheduleChanged = originalData.schedule ?
      JSON.stringify(formData.schedule) !== JSON.stringify(originalData.schedule) : false;
    const appointmentTypesChanged = JSON.stringify(formData.selectedAppointmentTypeIds) !== JSON.stringify(originalData.selectedAppointmentTypeIds);
    return profileChanged || scheduleChanged || appointmentTypesChanged;
  };

  const updateFormData = (updates: Partial<ProfileFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  };

  const updateSchedule = (dayKey: keyof DefaultScheduleResponse, updates: any) => {
    setFormData(prev => ({
      ...prev,
      schedule: {
        ...prev.schedule,
        [dayKey]: updates,
      },
    }));
  };

  const updateSelectedAppointmentTypeIds = (selectedTypeIds: number[]) => {
    setFormData(prev => ({
      ...prev,
      selectedAppointmentTypeIds: selectedTypeIds,
    }));
  };

  useEffect(() => {
    loadData();
  }, []);

  return {
    profile,
    formData,
    originalData,
    uiState,
    loadData,
    saveData,
    resetData,
    hasUnsavedChanges,
    updateFormData,
    updateSchedule,
    updateSelectedAppointmentTypeIds,
    validateIntervals,
  };
};

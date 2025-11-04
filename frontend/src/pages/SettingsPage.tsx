import React from 'react';
import { apiService } from '../services/api';
import { ClinicSettings } from '../schemas/api';
import { AppointmentType } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useSettingsPage } from '../hooks/useSettingsPage';
import { useModal } from '../contexts/ModalContext';
import { validateClinicSettings, getClinicSectionChanges } from '../utils/clinicSettings';
import ClinicAppointmentTypes from '../components/ClinicAppointmentTypes';
import ClinicReminderSettings from '../components/ClinicReminderSettings';
import ClinicBookingRestrictionSettings from '../components/ClinicBookingRestrictionSettings';
import PageHeader from '../components/PageHeader';

const SettingsPage: React.FC = () => {
  const { isClinicAdmin, isClinicUser, isLoading } = useAuth();
  const { alert } = useModal();

  // Only clinic users can access clinic settings
  if (!isClinicUser) {
    return (
      <div className="space-y-8">
        <PageHeader title="診所設定" />

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

  // Use generic settings page hook
  const {
    data: settings,
    uiState,
    sectionChanges,
    saveData,
    updateData,
  } = useSettingsPage({
    fetchData: async () => {
      const data = await apiService.getClinicSettings();
      return data;
    },
    saveData: async (data: ClinicSettings) => {
      // Convert reminder hours and booking restriction hours to numbers for backend
      const settingsToSave = {
        ...data,
        notification_settings: {
          ...data.notification_settings,
          reminder_hours_before: parseInt(String(data.notification_settings.reminder_hours_before)) || 24
        },
        booking_restriction_settings: {
          ...data.booking_restriction_settings,
          minimum_booking_hours_ahead: parseInt(String(data.booking_restriction_settings.minimum_booking_hours_ahead)) || 24
        }
      };
      try {
        await apiService.updateClinicSettings(settingsToSave);
      } catch (error: any) {
        // Handle appointment type deletion error
        if (error.response?.status === 400 && error.response?.data?.detail?.error === 'cannot_delete_appointment_types') {
          const errorDetail = error.response.data.detail;
          // For simplicity, show only the first blocked appointment type
          // (in practice, this usually happens one at a time)
          const blockedType = errorDetail.appointment_types[0];
          const practitionerNames = blockedType.practitioners.join('、');
          const errorMessage = `「${blockedType.name}」正在被以下治療師使用：${practitionerNames}\n\n請先移除治療師的此服務設定後再刪除。`;
          throw new Error(errorMessage);
        }
        throw error;
      }
    },
    validateData: validateClinicSettings,
    getSectionChanges: getClinicSectionChanges,
    onValidationError: async (error: string) => {
      await alert(error, '錯誤');
    },
  }, { isLoading });

  const addAppointmentType = () => {
    if (!settings) return;

    const newType: AppointmentType = {
      id: Date.now(), // Temporary ID for UI
      clinic_id: settings.clinic_id || 0, // Use clinic_id from settings or default
      name: '',
      duration_minutes: 30,
    };

    updateData({
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

    updateData({
      appointment_types: updatedTypes,
    });
  };

  const removeAppointmentType = async (index: number) => {
    if (!settings) return;

    const appointmentType = settings.appointment_types[index];
    if (!appointmentType || !appointmentType.id) {
      // New appointment type (no ID yet), can remove immediately
      const updatedTypes = settings.appointment_types.filter((_, i) => i !== index);
      updateData({
        appointment_types: updatedTypes,
      });
      return;
    }

    // Validate deletion before removing from UI
    try {
      const validation = await apiService.validateAppointmentTypeDeletion([appointmentType.id]);
      
      if (!validation.can_delete && validation.error) {
        // Show error immediately
        const errorDetail = validation.error;
        // For simplicity, show only the first blocked appointment type
        // (in practice, only one type is being deleted at a time)
        const blockedType = errorDetail.appointment_types[0];
        const practitionerNames = blockedType.practitioners.join('、');
        const errorMessage = `「${blockedType.name}」正在被以下治療師使用：${practitionerNames}\n\n請先移除治療師的此服務設定後再刪除。`;
        
        // Show error in popup modal
        await alert(errorMessage, '無法刪除預約類型');
        return; // Don't remove from UI
      }

      // Validation passed, remove from UI
      const updatedTypes = settings.appointment_types.filter((_, i) => i !== index);
      updateData({
        appointment_types: updatedTypes,
      });
    } catch (error: any) {
      console.error('Error validating appointment type deletion:', error);
      const errorMessage = error.response?.data?.detail || error.message || '驗證刪除失敗，請稍後再試';
      await alert(errorMessage, '驗證失敗');
    }
  };

  if (uiState.loading) {
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
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <PageHeader title="診所設定" />

      <div className="space-y-8">
        {/* Single Form */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <form onSubmit={(e) => { e.preventDefault(); saveData(); }}>
              {/* Appointment Types */}
              <ClinicAppointmentTypes
                appointmentTypes={settings.appointment_types}
                onAddType={addAppointmentType}
                onUpdateType={updateAppointmentType}
                onRemoveType={removeAppointmentType}
                showSaveButton={sectionChanges.appointmentTypes || false}
                onSave={saveData}
                saving={uiState.saving}
                isClinicAdmin={isClinicAdmin}
              />

              {/* Reminder Settings */}
              <ClinicReminderSettings
                reminderHoursBefore={settings.notification_settings.reminder_hours_before}
                onReminderHoursChange={(value) => {
                  updateData({
                    notification_settings: {
                      ...settings.notification_settings,
                      reminder_hours_before: value
                    }
                  });
                }}
                showSaveButton={sectionChanges.reminderSettings || false}
                onSave={saveData}
                saving={uiState.saving}
                isClinicAdmin={isClinicAdmin}
              />

              {/* Booking Restriction Settings */}
              <ClinicBookingRestrictionSettings
                bookingRestrictionSettings={settings.booking_restriction_settings}
                onBookingRestrictionSettingsChange={(bookingSettings) => {
                  updateData({
                    booking_restriction_settings: bookingSettings
                  });
                }}
                showSaveButton={sectionChanges.bookingRestrictionSettings || false}
                onSave={saveData}
                saving={uiState.saving}
                isClinicAdmin={isClinicAdmin}
              />

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
                      <div className="mt-2 text-sm text-red-700 whitespace-pre-line">
                        {uiState.error}
                      </div>
                    </div>
                  </div>
                </div>
              )}
          </form>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;


import React from 'react';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../hooks/useAuth';
import { useModal } from '../../contexts/ModalContext';
import { apiService } from '../../services/api';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../types/api';
import { AppointmentType } from '../../types';
import { LoadingSpinner } from '../../components/shared';
import ServiceItemsSettings from '../../components/ServiceItemsSettings';
import SettingsBackButton from '../../components/SettingsBackButton';
import PageHeader from '../../components/PageHeader';
import { useServiceItemsStore } from '../../stores/serviceItemsStore';
import { sharedFetchFunctions } from '../../services/api';

// Temporary IDs are generated using Date.now(), which produces large timestamps
// Real IDs from the backend are small integers, so we use this threshold to distinguish them
const TEMPORARY_ID_THRESHOLD = 1000000000000;

const SettingsServiceItemsPage: React.FC = () => {
  const { 
    settings, 
    uiState, 
    sectionChanges, 
    saveData: saveSettingsData, 
    updateData,
  } = useSettings();
  const { isClinicAdmin } = useAuth();
  const { alert } = useModal();
  const {
    loadPractitionerAssignments,
    savePractitionerAssignments,
    saveBillingScenarios,
    hasUnsavedChanges: hasServiceItemsUnsavedChanges,
  } = useServiceItemsStore();

  // Scroll to top when component mounts
  React.useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Load practitioner assignments when appointment types are loaded
  React.useEffect(() => {
    if (settings?.appointment_types && settings.appointment_types.length > 0) {
      loadPractitionerAssignments(settings.appointment_types);
    }
  }, [settings?.appointment_types, loadPractitionerAssignments]);

  if (uiState.loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
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

  const addAppointmentType = () => {
    if (!settings) return;

    const newType: AppointmentType = {
      id: Date.now(), // Temporary ID for UI
      clinic_id: settings.clinic_id || 0, // Use clinic_id from settings or default
      name: '',
      duration_minutes: 30,
      receipt_name: undefined,
      allow_patient_booking: true,
      allow_patient_practitioner_selection: true,
      description: undefined,
      scheduling_buffer_minutes: 0,
    };

    updateData({
      appointment_types: [...settings.appointment_types, newType],
    });
  };

  const updateAppointmentType = (index: number, field: keyof AppointmentType, value: string | number | boolean | null) => {
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
      logger.error('Error validating appointment type deletion:', error);
      const errorMessage = getErrorMessage(error) || '驗證刪除失敗，請稍後再試';
      await alert(errorMessage, '驗證失敗');
    }
  };

  // Coordinated save function
  const handleSave = async () => {
    try {
      // 1. Save appointment types first (to get real IDs for new types)
      let appointmentTypeIdMapping: Record<number, number> = {};
      
      // Capture temporary IDs from current settings BEFORE saving
      const currentSettingsSnapshot = settings ? JSON.parse(JSON.stringify(settings)) : null;
      const allAppointmentTypes = currentSettingsSnapshot?.appointment_types || [];
      const tempTypesBeforeSave = allAppointmentTypes.filter((at: AppointmentType) => 
        at.id > TEMPORARY_ID_THRESHOLD
      );

      // Save appointment types
      await saveSettingsData();

      // Map temporary IDs to real IDs
      if (tempTypesBeforeSave.length > 0) {
        try {
          const freshSettings = await sharedFetchFunctions.getClinicSettings();
          const savedTypes = freshSettings?.appointment_types || [];
          
          for (const tempType of tempTypesBeforeSave) {
            const realType = savedTypes.find((at: AppointmentType) => 
              at.name === tempType.name && 
              at.duration_minutes === tempType.duration_minutes &&
              at.id < TEMPORARY_ID_THRESHOLD
            );
            if (realType) {
              appointmentTypeIdMapping[tempType.id] = realType.id;
            }
          }
        } catch (fetchErr) {
          logger.warn('Failed to fetch fresh settings after save, using current settings:', fetchErr);
          if (settings && tempTypesBeforeSave.length > 0) {
            const savedTypes = settings.appointment_types;
            for (const tempType of tempTypesBeforeSave) {
              const realType = savedTypes.find((at: AppointmentType) => 
                at.name === tempType.name && 
                at.duration_minutes === tempType.duration_minutes &&
                at.id < TEMPORARY_ID_THRESHOLD
              );
              if (realType) {
                appointmentTypeIdMapping[tempType.id] = realType.id;
              }
            }
          }
        }
      }

      // 2. Save practitioner assignments and billing scenarios with ID mapping
      const assignmentResult = await savePractitionerAssignments(
        Object.keys(appointmentTypeIdMapping).length > 0 ? appointmentTypeIdMapping : undefined
      );
      const scenarioResult = await saveBillingScenarios(
        Object.keys(appointmentTypeIdMapping).length > 0 ? appointmentTypeIdMapping : undefined
      );

      // 3. Show results
      const errors: string[] = [];
      if (!assignmentResult.success) {
        errors.push(...assignmentResult.errors);
      }
      if (!scenarioResult.success) {
        errors.push(...scenarioResult.errors);
      }

      if (errors.length > 0) {
        await alert(errors.join('\n\n'), '部分設定儲存失敗');
      } else {
        await alert('設定已成功儲存', '成功');
      }
    } catch (err: any) {
      logger.error('Error saving service items settings:', err);
      const errorMessage = err instanceof Error ? err.message : '儲存失敗';
      await alert(errorMessage, '錯誤');
    }
  };

  // Check if there are any unsaved changes
  const hasUnsavedChanges = sectionChanges.serviceItemsSettings || hasServiceItemsUnsavedChanges();

  return (
    <>
      <SettingsBackButton />
      <div className="flex justify-between items-center mb-6">
        <PageHeader title="服務項目設定" />
        {hasUnsavedChanges && (
          <button
            type="button"
            onClick={handleSave}
            disabled={uiState.saving}
            className="btn-primary text-sm px-4 py-2"
          >
            {uiState.saving ? '儲存中...' : '儲存更變'}
          </button>
        )}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className="space-y-4">
        <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm p-0 md:p-6">
          <ServiceItemsSettings
            appointmentTypes={settings.appointment_types}
            onAddType={addAppointmentType}
            onUpdateType={updateAppointmentType}
            onRemoveType={removeAppointmentType}
            isClinicAdmin={isClinicAdmin}
          />
        </div>

        {/* Error Display */}
        {uiState.error && (
          <div className="bg-white rounded-lg border border-red-200 shadow-sm p-4 md:p-6">
            <div className="p-4 bg-red-50 border border-red-200 rounded-md">
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
          </div>
        )}
      </form>
    </>
  );
};

export default SettingsServiceItemsPage;


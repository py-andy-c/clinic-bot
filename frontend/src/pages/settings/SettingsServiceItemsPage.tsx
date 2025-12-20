import React, { useState } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../hooks/useAuth';
import { useModal } from '../../contexts/ModalContext';
import { apiService } from '../../services/api';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../types/api';
import { AppointmentType } from '../../types';
import { LoadingSpinner } from '../../components/shared';
import ServiceItemsSettings from '../../components/ServiceItemsSettings';
import { ServiceTypeGroupManagement } from '../../components/ServiceTypeGroupManagement';
import SettingsBackButton from '../../components/SettingsBackButton';
import PageHeader from '../../components/PageHeader';
import { useServiceItemsStore } from '../../stores/serviceItemsStore';
import { useUnsavedChangesDetection } from '../../hooks/useUnsavedChangesDetection';
import { useFormErrorScroll } from '../../hooks/useFormErrorScroll';
import { sharedFetchFunctions } from '../../services/api';
import { handleBackendError } from '../../utils/formErrors';

// Temporary IDs are generated using Date.now(), which produces large timestamps
// Real IDs from the backend are small integers, so we use this threshold to distinguish them
const TEMPORARY_ID_THRESHOLD = 1000000000000;

type TabType = 'service-items' | 'group-management';

// Form Schema for Service Items
const ServiceItemsFormSchema = z.object({
  appointment_types: z.array(z.object({
    id: z.number(),
    clinic_id: z.number(),
    name: z.string().min(1, '項目名稱不能為空'),
    duration_minutes: z.coerce.number().min(15, '時長至少需 15 分鐘').max(480, '時長最多 480 分鐘'),
    receipt_name: z.string().nullable().optional(),
    allow_patient_booking: z.boolean().optional(),
    allow_patient_practitioner_selection: z.boolean().optional(),
    description: z.string().nullable().optional(),
    scheduling_buffer_minutes: z.coerce.number().min(0).max(60).optional(),
    service_type_group_id: z.number().nullable().optional(),
    display_order: z.number().optional(),
  })),
});

type ServiceItemsFormData = z.infer<typeof ServiceItemsFormSchema>;

const SettingsServiceItemsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('service-items');
  const { 
    settings, 
    uiState, 
    saveData: saveSettingsData, 
    updateData,
  } = useSettings();
  const { isClinicAdmin } = useAuth();
  const { alert } = useModal();
  const { onInvalid: scrollOnError } = useFormErrorScroll();
  const {
    loadPractitionerAssignments,
    savePractitionerAssignments,
    saveBillingScenarios,
    saveResourceRequirements,
    hasUnsavedChanges: hasServiceItemsUnsavedChanges,
  } = useServiceItemsStore();

  const methods = useForm<ServiceItemsFormData>({
    resolver: zodResolver(ServiceItemsFormSchema),
    defaultValues: {
      appointment_types: settings?.appointment_types || [],
    },
    mode: 'onBlur',
  });

  const { reset, handleSubmit, formState: { isDirty }, getValues, setValue } = methods;

  // Setup navigation warnings for unsaved changes
  useUnsavedChangesDetection({ hasUnsavedChanges: () => isDirty || hasServiceItemsUnsavedChanges() });

  const onInvalid = (errors: any) => {
    scrollOnError(errors, methods, { expandType: 'appointmentType' });
  };

  // Sync form with settings data when it loads
  React.useEffect(() => {
    if (settings?.appointment_types) {
      reset({ appointment_types: settings.appointment_types });
    }
  }, [settings?.appointment_types, reset]);

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
    const currentTypes = getValues('appointment_types');
    const maxOrder = currentTypes.length > 0 
      ? Math.max(...currentTypes.map((at: AppointmentType) => at.display_order || 0))
      : -1;
    
    const newType: AppointmentType = {
      id: Date.now(), // Temporary ID for UI
      clinic_id: settings.clinic_id || 0,
      name: '',
      duration_minutes: 30,
      receipt_name: undefined,
      allow_patient_booking: true,
      allow_patient_practitioner_selection: true,
      description: undefined,
      scheduling_buffer_minutes: 0,
      service_type_group_id: undefined,
      display_order: maxOrder + 1,
    };
    setValue('appointment_types', [...currentTypes, newType], { shouldDirty: true });
  };

  const removeAppointmentType = async (index: number) => {
    const currentTypes = getValues('appointment_types');
    const appointmentType = currentTypes[index];
    
    if (!appointmentType || appointmentType.id > TEMPORARY_ID_THRESHOLD) {
      // New appointment type, can remove immediately
      setValue('appointment_types', currentTypes.filter((_, i) => i !== index), { shouldDirty: true });
      return;
    }

    // Validate deletion before removing from UI
    try {
      const validation = await apiService.validateAppointmentTypeDeletion([appointmentType.id]);

      if (!validation.can_delete && validation.error) {
        const errorDetail = validation.error;
        const blockedType = errorDetail.appointment_types[0];
        const practitionerNames = blockedType.practitioners.join('、');
        const errorMessage = `「${blockedType.name}」正在被以下治療師使用：${practitionerNames}\n\n請先移除治療師的此服務設定後再刪除。`;
        await alert(errorMessage, '無法刪除預約類型');
        return;
      }

      setValue('appointment_types', currentTypes.filter((_, i) => i !== index), { shouldDirty: true });
    } catch (error: any) {
      logger.error('Error validating appointment type deletion:', error);
      const errorMessage = getErrorMessage(error) || '驗證刪除失敗，請稍後再試';
      await alert(errorMessage, '驗證失敗');
    }
  };

  // Coordinated save function
  const onFormSubmit = async (formData: ServiceItemsFormData) => {
    try {
      // 1. Update the context data with form data
      updateData({ appointment_types: formData.appointment_types });

      // 2. Save appointment types first (to get real IDs for new types)
      let appointmentTypeIdMapping: Record<number, number> = {};
      
      const tempTypesBeforeSave = formData.appointment_types.filter((at: any) => 
        at.id > TEMPORARY_ID_THRESHOLD
      );

      // Save appointment types via context
      try {
        await saveSettingsData();
      } catch (err) {
        if (handleBackendError(err, methods, { stripPrefix: 'appointment_types' })) {
          return;
        }
        throw err;
      }

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
          logger.warn('Failed to fetch fresh settings after save', fetchErr);
        }
      }

      // 3. Save associations
      const assignmentResult = await savePractitionerAssignments(
        Object.keys(appointmentTypeIdMapping).length > 0 ? appointmentTypeIdMapping : undefined
      );
      const scenarioResult = await saveBillingScenarios(
        Object.keys(appointmentTypeIdMapping).length > 0 ? appointmentTypeIdMapping : undefined
      );
      const requirementsResult = await saveResourceRequirements(
        Object.keys(appointmentTypeIdMapping).length > 0 ? appointmentTypeIdMapping : undefined
      );

      // 4. Show results
      const errors: string[] = [];
      if (!assignmentResult.success) errors.push(...assignmentResult.errors);
      if (!scenarioResult.success) errors.push(...scenarioResult.errors);
      if (!requirementsResult.success) errors.push(...requirementsResult.errors);

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

  const handleGroupChange = async () => {
    // Reload settings to get updated groups
    try {
      const freshSettings = await sharedFetchFunctions.getClinicSettings();
      if (freshSettings?.appointment_types) {
        reset({ appointment_types: freshSettings.appointment_types });
        updateData({ appointment_types: freshSettings.appointment_types });
      }
    } catch (err) {
      logger.warn('Failed to reload settings after group change', err);
    }
  };

  const hasUnsavedChanges = isDirty || hasServiceItemsUnsavedChanges();

  return (
    <FormProvider {...methods}>
      <SettingsBackButton />
      <div className="flex justify-between items-center mb-6">
        <PageHeader title="服務項目設定" />
        {activeTab === 'service-items' && hasUnsavedChanges && (
          <button
            type="button"
            onClick={handleSubmit(onFormSubmit, onInvalid)}
            disabled={uiState.saving}
            className="btn-primary text-sm px-4 py-2"
          >
            {uiState.saving ? '儲存中...' : '儲存變更'}
          </button>
        )}
      </div>

      {/* Tab Switcher */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            type="button"
            onClick={() => setActiveTab('service-items')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'service-items'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            服務項目
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('group-management')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'group-management'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            群組管理
          </button>
        </nav>
      </div>

      {activeTab === 'service-items' ? (
        <form onSubmit={handleSubmit(onFormSubmit, onInvalid)} className="space-y-4">
          <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm p-0 md:p-6">
            <ServiceItemsSettings
              onAddType={addAppointmentType}
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
      ) : (
        <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm p-0 md:p-6">
          <ServiceTypeGroupManagement
            isClinicAdmin={isClinicAdmin}
            onGroupChange={handleGroupChange}
            appointmentTypes={getValues('appointment_types').map(at => ({
              id: at.id,
              service_type_group_id: at.service_type_group_id ?? null,
            }))}
          />
        </div>
      )}
    </FormProvider>
  );
};

export default SettingsServiceItemsPage;

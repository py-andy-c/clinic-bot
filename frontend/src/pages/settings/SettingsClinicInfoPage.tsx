import React from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../hooks/useAuth';
import { LoadingSpinner } from '../../components/shared';
import ClinicInfoSettings from '../../components/ClinicInfoSettings';
import SettingsBackButton from '../../components/SettingsBackButton';
import PageHeader from '../../components/PageHeader';
import { useUnsavedChangesDetection } from '../../hooks/useUnsavedChangesDetection';
import { useFormErrorScroll } from '../../hooks/useFormErrorScroll';
import { ClinicInfoFormSchema } from '../../schemas/api';
import { handleBackendError } from '../../utils/formErrors';
import { useModal } from '../../contexts/ModalContext';

type ClinicInfoFormData = z.infer<typeof ClinicInfoFormSchema>;

const SettingsClinicInfoPage: React.FC = () => {
  const { settings, uiState, saveData, updateData } = useSettings();
  const { isClinicAdmin } = useAuth();
  const { alert } = useModal();
  const { onInvalid: scrollOnError } = useFormErrorScroll();

  const methods = useForm<ClinicInfoFormData>({
    resolver: zodResolver(ClinicInfoFormSchema),
    defaultValues: settings?.clinic_info_settings || {},
    mode: 'onBlur',
  });

  const {
    handleSubmit,
    reset,
    formState: { isDirty },
  } = methods;

  // Setup navigation warnings for unsaved changes
  useUnsavedChangesDetection({ hasUnsavedChanges: () => isDirty });

  const onInvalid = (errors: any) => {
    scrollOnError(errors, methods);
  };

  // Sync form with settings data when it loads
  React.useEffect(() => {
    if (settings?.clinic_info_settings) {
      reset(settings.clinic_info_settings);
    }
  }, [settings?.clinic_info_settings, reset]);

  // Scroll to top when component mounts
  React.useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const onFormSubmit = async (data: ClinicInfoFormData) => {
    try {
      updateData({ clinic_info_settings: data });
      
      // Use setTimeout to ensure updateData state is processed
      setTimeout(async () => {
        try {
          await saveData();
          alert('設定已成功儲存');
        } catch (err) {
          handleBackendError(err, methods, { stripPrefix: 'clinic_info_settings' });
        }
      }, 0);
    } catch (err: any) {
      if (!handleBackendError(err, methods, { stripPrefix: 'clinic_info_settings' })) {
        alert(err.response?.data?.detail || '儲存設定失敗', '錯誤');
      }
    }
  };

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

  return (
    <FormProvider {...methods}>
      <SettingsBackButton />
      <div className="flex justify-between items-center mb-6">
        <PageHeader title="診所資訊" />
        {isDirty && (
          <button
            type="button"
            onClick={handleSubmit(onFormSubmit, onInvalid)}
            disabled={uiState.saving}
            className="btn-primary text-sm px-4 py-2"
          >
            {uiState.saving ? '儲存中...' : '儲存更變'}
          </button>
        )}
      </div>
      <form onSubmit={handleSubmit(onFormSubmit, onInvalid)} className="space-y-4">
        <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm p-0 md:p-6">
          <ClinicInfoSettings
            clinicName={settings.clinic_name}
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
    </FormProvider>
  );
};

export default SettingsClinicInfoPage;


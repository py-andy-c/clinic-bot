import React, { useEffect } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../hooks/useAuth';
import { LoadingSpinner } from '../../components/shared';
import ClinicReminderSettings from '../../components/ClinicReminderSettings';
import SettingsBackButton from '../../components/SettingsBackButton';
import PageHeader from '../../components/PageHeader';
import { useUnsavedChangesDetection } from '../../hooks/useUnsavedChangesDetection';
import { useFormErrorScroll } from '../../hooks/useFormErrorScroll';
import { handleBackendError } from '../../utils/formErrors';
import { RemindersSettingsFormSchema } from '../../schemas/api';
import { useModal } from '../../contexts/ModalContext';

export type RemindersSettingsFormData = z.infer<typeof RemindersSettingsFormSchema>;

const SettingsRemindersPage: React.FC = () => {
  const { settings, uiState, saveData, updateData, refreshTrigger } = useSettings();
  const { isClinicAdmin } = useAuth();
  const { alert } = useModal();
  const { onInvalid: scrollOnError } = useFormErrorScroll();
  const isSavingRef = React.useRef(false);
  const pendingFormDataRef = React.useRef<RemindersSettingsFormData | null>(null);

  const methods = useForm<RemindersSettingsFormData>({
    resolver: zodResolver(RemindersSettingsFormSchema),
    defaultValues: {
      notification_settings: settings?.notification_settings || { reminder_hours_before: 24 },
    },
    mode: 'onBlur',
  });

  const { reset, handleSubmit, formState: { isDirty } } = methods;

  // Setup navigation warnings for unsaved changes
  useUnsavedChangesDetection({ hasUnsavedChanges: () => isDirty });

  // Sync form with settings data when it loads
  // Skip reset during save to prevent race condition
  useEffect(() => {
    if (isSavingRef.current) {
      return;
    }
    if (settings) {
      reset({
        notification_settings: settings.notification_settings,
      });
    }
  }, [settings, reset]);

  // Watch for settings update after updateData, then trigger save
  useEffect(() => {
    if (pendingFormDataRef.current && isSavingRef.current && settings?.notification_settings) {
      // Check if settings match what we're trying to save
      const pendingStr = JSON.stringify(pendingFormDataRef.current.notification_settings);
      const currentStr = JSON.stringify(settings.notification_settings);
      
      if (pendingStr === currentStr) {
        // Settings have been updated, now save
        const performSave = async () => {
          try {
            await saveData();
            // Reset form with saved data to clear isDirty flag
            reset(pendingFormDataRef.current!);
            pendingFormDataRef.current = null;
            isSavingRef.current = false;
            alert('設定已成功儲存');
          } catch (err) {
            isSavingRef.current = false;
            pendingFormDataRef.current = null;
            handleBackendError(err, methods);
          }
        };
        performSave();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.notification_settings]);

  const onInvalid = (errors: Record<string, unknown>) => {
    scrollOnError(errors, methods);
  };

  const onFormSubmit = async (data: RemindersSettingsFormData) => {
    if (!isClinicAdmin) return;

    isSavingRef.current = true;
    pendingFormDataRef.current = data;
    try {
      // Update context - this will trigger the useEffect above to save once state is updated
      updateData({
        notification_settings: data.notification_settings,
      });
    } catch (err: unknown) {
      isSavingRef.current = false;
      pendingFormDataRef.current = null;
      if (!handleBackendError(err, methods)) {
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
        <PageHeader title="LINE提醒設定" />
        {isDirty && (
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
      <form onSubmit={handleSubmit(onFormSubmit, onInvalid)} className="space-y-4">
        <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm p-0 md:p-6">
          <ClinicReminderSettings
            isClinicAdmin={isClinicAdmin}
            refreshTrigger={refreshTrigger}
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

export default SettingsRemindersPage;

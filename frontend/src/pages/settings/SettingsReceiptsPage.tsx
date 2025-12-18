import React, { useEffect } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../hooks/useAuth';
import { LoadingSpinner } from '../../components/shared';
import ReceiptSettings from '../../components/ReceiptSettings';
import SettingsBackButton from '../../components/SettingsBackButton';
import PageHeader from '../../components/PageHeader';
import { useUnsavedChangesDetection } from '../../hooks/useUnsavedChangesDetection';
import { useFormErrorScroll } from '../../hooks/useFormErrorScroll';
import { handleBackendError } from '../../utils/formErrors';
import { ReceiptsSettingsFormSchema } from '../../schemas/api';
import { useModal } from '../../contexts/ModalContext';

export type ReceiptsSettingsFormData = z.infer<typeof ReceiptsSettingsFormSchema>;

const SettingsReceiptsPage: React.FC = () => {
  const { settings, uiState, saveData, updateData } = useSettings();
  const { isClinicAdmin } = useAuth();
  const { alert } = useModal();
  const { onInvalid: scrollOnError } = useFormErrorScroll();

  const methods = useForm<ReceiptsSettingsFormData>({
    resolver: zodResolver(ReceiptsSettingsFormSchema),
    defaultValues: {
      receipt_settings: settings?.receipt_settings || { custom_notes: null, show_stamp: false },
    },
    mode: 'onBlur',
  });

  const { reset, handleSubmit, formState: { isDirty } } = methods;

  // Setup navigation warnings for unsaved changes
  useUnsavedChangesDetection({ hasUnsavedChanges: () => isDirty });

  // Sync form with settings data when it loads
  useEffect(() => {
    if (settings) {
      reset({
        receipt_settings: settings.receipt_settings || { custom_notes: null, show_stamp: false },
      });
    }
  }, [settings, reset]);

  const onInvalid = (errors: any) => {
    scrollOnError(errors, methods);
  };

  const onFormSubmit = async (data: ReceiptsSettingsFormData) => {
    if (!isClinicAdmin) return;

    try {
      updateData({
        receipt_settings: data.receipt_settings,
      });

      // Use setTimeout to ensure updateData state is processed
      setTimeout(async () => {
        try {
          await saveData();
          alert('設定已成功儲存');
        } catch (err) {
          handleBackendError(err, methods);
        }
      }, 0);
    } catch (err: any) {
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

  if (!isClinicAdmin) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">只有診所管理員可以存取此設定</p>
      </div>
    );
  }

  return (
    <FormProvider {...methods}>
      <SettingsBackButton />
      <div className="flex justify-between items-center mb-6">
        <PageHeader title="收據設定" />
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
          <ReceiptSettings isClinicAdmin={isClinicAdmin} />
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

export default SettingsReceiptsPage;

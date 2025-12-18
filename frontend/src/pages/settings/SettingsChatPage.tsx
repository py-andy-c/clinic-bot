import React, { useEffect } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../hooks/useAuth';
import { useModal } from '../../contexts/ModalContext';
import { LoadingSpinner } from '../../components/shared';
import ChatSettings from '../../components/ChatSettings';
import SettingsBackButton from '../../components/SettingsBackButton';
import PageHeader from '../../components/PageHeader';
import { useUnsavedChangesDetection } from '../../hooks/useUnsavedChangesDetection';
import { useFormErrorScroll } from '../../hooks/useFormErrorScroll';
import { handleBackendError } from '../../utils/formErrors';
import { ChatSettingsFormSchema } from '../../schemas/api';

export type ChatSettingsFormData = z.infer<typeof ChatSettingsFormSchema>;

const SettingsChatPage: React.FC = () => {
  const { settings, originalData, uiState, saveData, updateData } = useSettings();
  const { isClinicAdmin } = useAuth();
  const { alert, confirm } = useModal();
  const { onInvalid: scrollOnError } = useFormErrorScroll();

  const methods = useForm<ChatSettingsFormData>({
    resolver: zodResolver(ChatSettingsFormSchema),
    defaultValues: {
      chat_settings: settings?.chat_settings || { chat_enabled: false },
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
        chat_settings: settings.chat_settings,
      });
    }
  }, [settings, reset]);

  const onInvalid = (errors: any) => {
    scrollOnError(errors, methods);
  };

  const onFormSubmit = async (data: ChatSettingsFormData) => {
    if (!isClinicAdmin || !settings || !originalData) return;

    const wasEnabled = originalData.chat_settings.chat_enabled;
    const isEnabled = data.chat_settings.chat_enabled;

    // Case 1: Off -> On
    if (!wasEnabled && isEnabled) {
      const confirmed = await confirm(
        '您即將開啟 AI 聊天功能，病患將開始收到 AI 的自動回覆。確定要開啟嗎？',
        '開啟 AI 聊天功能'
      );
      if (!confirmed) return;
    }
    // Case 2: On -> Off
    else if (wasEnabled && !isEnabled) {
      const confirmed = await confirm(
        '您即將關閉 AI 聊天功能，病患將不再收到 AI 的自動回覆。確定要關閉嗎？',
        '關閉 AI 聊天功能'
      );
      if (!confirmed) return;
    }
    // Case 3: Off -> Off (but changes made)
    else if (!wasEnabled && !isEnabled) {
      const confirmed = await confirm(
        '您的變更將被儲存，但 AI 聊天功能目前仍處於關閉狀態，病患不會收到 AI 回覆。',
        '儲存設定'
      );
      if (!confirmed) return;
    }

    try {
      updateData({
        chat_settings: data.chat_settings,
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

  if (!settings || !originalData) {
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
        <PageHeader title="AI 聊天功能" />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              const event = new CustomEvent('open-chat-test');
              window.dispatchEvent(event);
            }}
            className="px-4 py-2 bg-[#EFF6FF] text-[#1E40AF] rounded-lg font-medium text-sm hover:bg-[#DBEAFE] transition-colors flex items-center gap-2"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
              />
            </svg>
            測試聊天機器人
          </button>
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
      </div>
      <form onSubmit={handleSubmit(onFormSubmit, onInvalid)} className="space-y-4">
        <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm p-0 md:p-6">
          <ChatSettings isClinicAdmin={isClinicAdmin} />
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

export default SettingsChatPage;

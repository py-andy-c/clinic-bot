import React, { useEffect } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../hooks/useAuth';
import { useModal } from '../../contexts/ModalContext';
import { LoadingSpinner } from '../../components/shared';
import ChatSettings from '../../components/ChatSettings';
import SettingsBackButton from '../../components/SettingsBackButton';
import PageHeader from '../../components/PageHeader';
import { useUnsavedChangesDetection } from '../../hooks/useUnsavedChangesDetection';
import { ChatSettingsFormSchema } from '../../schemas/api';
import { useClinicSettings } from '../../hooks/queries/useClinicSettings';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import SettingsActionFooter from '../../components/shared/SettingsActionFooter';
import { logger } from '../../utils/logger';
import { extractErrorMessage } from '../../utils/errorTracking';

export type ChatSettingsFormData = z.infer<typeof ChatSettingsFormSchema>;

const SettingsChatPage: React.FC = () => {
    const queryClient = useQueryClient();
    const { data: settings, isLoading } = useClinicSettings();
    const { isClinicAdmin } = useAuth();
    const { alert, confirm } = useModal();

    const methods = useForm<ChatSettingsFormData>({
        resolver: zodResolver(ChatSettingsFormSchema),
        defaultValues: {
            chat_settings: {
                chat_enabled: false,
                label_ai_replies: true
            },
        },
    });

    const { reset, handleSubmit, formState: { isDirty } } = methods;

    useEffect(() => {
        if (settings) {
            reset({
                chat_settings: settings.chat_settings,
            });
        }
    }, [settings, reset]);

    // Setup navigation warnings for unsaved changes
    useUnsavedChangesDetection({ hasUnsavedChanges: () => isDirty });

    const mutation = useMutation({
        mutationFn: (data: ChatSettingsFormData) =>
            apiService.updateClinicSettings({ chat_settings: data.chat_settings }),
        onSuccess: async (_, variables) => {
            reset(variables);
            await queryClient.invalidateQueries({ queryKey: ['settings'] });
            alert('設定已成功儲存');
        },
        onError: (err: any) => {
            logger.error('Failed to save chat settings:', err);
            alert(extractErrorMessage(err, '儲存設定失敗'), '錯誤');
        }
    });

    const onFormSubmit = async (data: ChatSettingsFormData) => {
        if (!isClinicAdmin || !settings) return;

        const wasEnabled = settings.chat_settings.chat_enabled;
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

        mutation.mutate(data);
    };

    const handleDiscard = () => {
        if (settings) {
            reset({
                chat_settings: settings.chat_settings,
            });
        }
    };

    if (isLoading) {
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
                <PageHeader title="AI 聊天功能" />
                <button
                    type="button"
                    onClick={() => {
                        const event = new CustomEvent('open-chat-test');
                        window.dispatchEvent(event);
                    }}
                    className="px-4 py-2 bg-[#EFF6FF] text-[#1E40AF] rounded-lg font-medium text-sm hover:bg-[#DBEAFE] transition-colors flex items-center gap-2"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                    測試聊天機器人
                </button>
            </div>

            <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4 pb-24">
                <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm p-0 md:p-6">
                    <ChatSettings isClinicAdmin={isClinicAdmin} />
                </div>
            </form>

            <SettingsActionFooter
                isVisible={isDirty}
                isSubmitting={mutation.isPending}
                onDiscard={handleDiscard}
                onSave={handleSubmit(onFormSubmit)}
            />
        </FormProvider>
    );
};

export default SettingsChatPage;

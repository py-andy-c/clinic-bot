import React, { useEffect, useCallback } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../hooks/useAuth';
import { LoadingSpinner } from '../../components/shared';
import ClinicReminderSettings from '../../components/ClinicReminderSettings';
import SettingsBackButton from '../../components/SettingsBackButton';
import PageHeader from '../../components/PageHeader';
import { useUnsavedChangesDetection } from '../../hooks/useUnsavedChangesDetection';
import { RemindersSettingsFormSchema } from '../../schemas/api';
import { useModal } from '../../contexts/ModalContext';
import { useClinicSettings } from '../../hooks/queries/useClinicSettings';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import SettingsActionFooter from '../../components/shared/SettingsActionFooter';
import { logger } from '../../utils/logger';
import { extractErrorMessage } from '../../utils/errorTracking';

export type RemindersSettingsFormData = z.infer<typeof RemindersSettingsFormSchema>;

const SettingsRemindersPage: React.FC = () => {
    const queryClient = useQueryClient();
    const { data: settings, isLoading } = useClinicSettings();
    const { isClinicAdmin } = useAuth();
    const { alert } = useModal();

    const methods = useForm<RemindersSettingsFormData>({
        resolver: zodResolver(RemindersSettingsFormSchema),
        defaultValues: {
            notification_settings: {
                reminder_timing_mode: 'hours_before',
                reminder_hours_before: 24,
                reminder_previous_day_time: '21:00',
            },
        },
    });

    const { reset, handleSubmit, formState: { isDirty } } = methods;

    const resetForm = useCallback(() => {
        if (settings) {
            reset({
                notification_settings: {
                    reminder_hours_before: typeof settings.notification_settings.reminder_hours_before === 'string'
                        ? parseInt(settings.notification_settings.reminder_hours_before, 10)
                        : settings.notification_settings.reminder_hours_before,
                    reminder_timing_mode: settings.notification_settings.reminder_timing_mode,
                    reminder_previous_day_time: settings.notification_settings.reminder_previous_day_time,
                },
            });
        }
    }, [settings, reset]);

    useEffect(() => {
        resetForm();
    }, [resetForm]);

    // Setup navigation warnings for unsaved changes
    useUnsavedChangesDetection({ hasUnsavedChanges: () => isDirty });

    const mutation = useMutation({
        mutationFn: (data: RemindersSettingsFormData) =>
            apiService.updateClinicSettings({
                notification_settings: {
                    ...data.notification_settings,
                    reminder_previous_day_time: data.notification_settings.reminder_previous_day_time || '21:00'
                }
            }),
        onSuccess: async (_, variables) => {
            reset(variables);
            await queryClient.invalidateQueries({ queryKey: ['settings'] });
            alert('設定已成功儲存');
        },
        onError: (err: any) => {
            logger.error('Failed to save reminder settings:', err);
            alert(extractErrorMessage(err, '儲存設定失敗'), '錯誤');
        }
    });

    const onFormSubmit = (data: RemindersSettingsFormData) => {
        mutation.mutate(data);
    };

    const handleDiscard = () => {
        resetForm();
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
                <PageHeader title="LINE提醒設定" />
            </div>

            <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4 pb-24">
                <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm p-0 md:p-6">
                    <ClinicReminderSettings
                        isClinicAdmin={isClinicAdmin}
                    />
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

export default SettingsRemindersPage;

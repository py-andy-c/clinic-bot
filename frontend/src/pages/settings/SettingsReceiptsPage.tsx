import React, { useEffect } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../hooks/useAuth';
import { LoadingSpinner } from '../../components/shared';
import ReceiptSettings from '../../components/ReceiptSettings';
import SettingsBackButton from '../../components/SettingsBackButton';
import PageHeader from '../../components/PageHeader';
import { useUnsavedChangesDetection } from '../../hooks/useUnsavedChangesDetection';
import { ReceiptsSettingsFormSchema } from '../../schemas/api';
import { useModal } from '../../contexts/ModalContext';
import { useClinicSettings } from '../../hooks/queries/useClinicSettings';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import SettingsActionFooter from '../../components/shared/SettingsActionFooter';
import { logger } from '../../utils/logger';

export type ReceiptsSettingsFormData = z.infer<typeof ReceiptsSettingsFormSchema>;

const SettingsReceiptsPage: React.FC = () => {
    const queryClient = useQueryClient();
    const { data: settings, isLoading } = useClinicSettings();
    const { isClinicAdmin } = useAuth();
    const { alert } = useModal();

    const methods = useForm<ReceiptsSettingsFormData>({
        resolver: zodResolver(ReceiptsSettingsFormSchema),
        defaultValues: {
            receipt_settings: { custom_notes: null, show_stamp: false },
        },
    });

    const { reset, handleSubmit, formState: { isDirty } } = methods;

    useEffect(() => {
        if (settings) {
            reset({
                receipt_settings: settings.receipt_settings || { custom_notes: null, show_stamp: false },
            });
        }
    }, [settings, reset]);

    // Setup navigation warnings for unsaved changes
    useUnsavedChangesDetection({ hasUnsavedChanges: () => isDirty });

    const mutation = useMutation({
        mutationFn: (data: ReceiptsSettingsFormData) =>
            apiService.updateClinicSettings({ receipt_settings: data.receipt_settings }),
        onSuccess: async (_, variables) => {
            reset(variables);
            await queryClient.invalidateQueries({ queryKey: ['settings'] });
            alert('設定已成功儲存');
        },
        onError: (err: any) => {
            logger.error('Failed to save receipt settings:', err);
            alert(err.response?.data?.detail || '儲存設定失敗', '錯誤');
        }
    });

    const onFormSubmit = (data: ReceiptsSettingsFormData) => {
        mutation.mutate(data);
    };

    const handleDiscard = () => {
        if (settings) {
            reset({
                receipt_settings: settings.receipt_settings || { custom_notes: null, show_stamp: false },
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
            </div>

            <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4 pb-24">
                <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm p-0 md:p-6">
                    <ReceiptSettings isClinicAdmin={isClinicAdmin} />
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

export default SettingsReceiptsPage;

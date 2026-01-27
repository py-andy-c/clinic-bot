import React, { useEffect } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../hooks/useAuth';
import { LoadingSpinner } from '../../components/shared';
import ClinicInfoSettings from '../../components/ClinicInfoSettings';
import SettingsBackButton from '../../components/SettingsBackButton';
import PageHeader from '../../components/PageHeader';
import { useUnsavedChangesDetection } from '../../hooks/useUnsavedChangesDetection';
import { ClinicInfoFormSchema } from '../../schemas/api';
import { useModal } from '../../contexts/ModalContext';
import { useClinicSettings } from '../../hooks/queries/useClinicSettings';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import SettingsActionFooter from '../../components/shared/SettingsActionFooter';
import { logger } from '../../utils/logger';
import { extractErrorMessage } from '../../utils/errorTracking';

type ClinicInfoFormData = z.infer<typeof ClinicInfoFormSchema>;

const SettingsClinicInfoPage: React.FC = () => {
    const queryClient = useQueryClient();
    const { data: settings, isLoading } = useClinicSettings();
    const { isClinicAdmin } = useAuth();
    const { alert } = useModal();

    const methods = useForm<ClinicInfoFormData>({
        resolver: zodResolver(ClinicInfoFormSchema),
        defaultValues: settings?.clinic_info_settings || {},
    });

    const {
        handleSubmit,
        reset,
        formState: { isDirty },
    } = methods;

    // Sync form with data when it loads
    useEffect(() => {
        if (settings?.clinic_info_settings) {
            reset(settings.clinic_info_settings);
        }
    }, [settings?.clinic_info_settings, reset]);

    // Setup navigation warnings for unsaved changes
    useUnsavedChangesDetection({ hasUnsavedChanges: () => isDirty });

    const mutation = useMutation({
        mutationFn: (data: ClinicInfoFormData) =>
            apiService.updateClinicSettings({ clinic_info_settings: data }),
        onSuccess: async (_, variables) => {
            reset(variables);
            await queryClient.invalidateQueries({ queryKey: ['settings'] });
            alert('設定已成功儲存');
        },
        onError: (err: any) => {
            logger.error('Error saving clinic info:', err);
            alert(extractErrorMessage(err, '儲存設定失敗'), '錯誤');
        }
    });

    const onFormSubmit = (data: ClinicInfoFormData) => {
        mutation.mutate(data);
    };

    const handleDiscard = () => {
        if (settings?.clinic_info_settings) {
            reset(settings.clinic_info_settings);
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
                <PageHeader title="診所資訊" />
            </div>

            <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4 pb-24">
                <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm p-0 md:p-6">
                    <ClinicInfoSettings
                        clinicName={settings.clinic_name}
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

export default SettingsClinicInfoPage;

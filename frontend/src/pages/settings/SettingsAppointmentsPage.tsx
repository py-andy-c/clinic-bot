import React, { useState, useEffect, useCallback } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../hooks/useAuth';
import { useModal } from '../../contexts/ModalContext';
import { logger } from '../../utils/logger';
import { extractErrorMessage } from '../../utils/errorTracking';
import { LoadingSpinner, BaseModal } from '../../components/shared';
import { ModalHeader, ModalBody } from '../../components/shared/ModalParts';
import ClinicAppointmentSettings from '../../components/ClinicAppointmentSettings';
import SettingsBackButton from '../../components/SettingsBackButton';
import PageHeader from '../../components/PageHeader';
import { apiService } from '../../services/api';
import { useMembers } from '../../hooks/queries';
import { useUnsavedChangesDetection } from '../../hooks/useUnsavedChangesDetection';
import { AppointmentsSettingsFormSchema } from '../../schemas/api';
import { useClinicSettings } from '../../hooks/queries/useClinicSettings';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import SettingsActionFooter from '../../components/shared/SettingsActionFooter';

export type AppointmentsSettingsFormData = z.infer<typeof AppointmentsSettingsFormSchema>;

const SettingsAppointmentsPage: React.FC = () => {
    const queryClient = useQueryClient();
    const { data: settings, isLoading: settingsLoading } = useClinicSettings();
    const { data: membersData, isLoading: membersLoading } = useMembers();
    const { isClinicAdmin } = useAuth();
    const { alert } = useModal();

    const [showLiffInfoModal, setShowLiffInfoModal] = useState(false);

    const methods = useForm<AppointmentsSettingsFormData>({
        resolver: zodResolver(AppointmentsSettingsFormSchema),
        defaultValues: {
            clinic_info_settings: {},
            booking_restriction_settings: {
                booking_restriction_type: 'minimum_hours_required',
                minimum_booking_hours_ahead: 24,
                step_size_minutes: 30,
                max_future_appointments: 3,
                max_booking_window_days: 90,
                minimum_cancellation_hours_before: 24,
                allow_patient_deletion: true,
            },
            practitioners: [],
        },
    });

    const { reset, handleSubmit, formState: { isDirty } } = methods;

    const resetForm = useCallback(() => {
        if (settings && membersData) {
            const practitioners = membersData
                .filter(m => m.roles.includes('practitioner'))
                .map(p => ({
                    id: p.id,
                    full_name: p.full_name,
                    patient_booking_allowed: p.patient_booking_allowed ?? true,
                }));

            reset({
                clinic_info_settings: {
                    appointment_type_instructions: settings.clinic_info_settings.appointment_type_instructions || '',
                    appointment_notes_instructions: settings.clinic_info_settings.appointment_notes_instructions || '',
                    require_birthday: settings.clinic_info_settings.require_birthday || false,
                    require_gender: settings.clinic_info_settings.require_gender || false,
                    restrict_to_assigned_practitioners: settings.clinic_info_settings.restrict_to_assigned_practitioners || false,
                    query_page_instructions: settings.clinic_info_settings.query_page_instructions || '',
                    settings_page_instructions: settings.clinic_info_settings.settings_page_instructions || '',
                    notifications_page_instructions: settings.clinic_info_settings.notifications_page_instructions || '',
                },
                booking_restriction_settings: {
                    booking_restriction_type: settings.booking_restriction_settings.booking_restriction_type,
                    minimum_booking_hours_ahead: typeof settings.booking_restriction_settings.minimum_booking_hours_ahead === 'string'
                        ? parseInt(settings.booking_restriction_settings.minimum_booking_hours_ahead, 10)
                        : settings.booking_restriction_settings.minimum_booking_hours_ahead,
                    deadline_time_day_before: settings.booking_restriction_settings.deadline_time_day_before || '00:00',
                    deadline_on_same_day: settings.booking_restriction_settings.deadline_on_same_day || false,
                    step_size_minutes: typeof settings.booking_restriction_settings.step_size_minutes === 'string'
                        ? parseInt(settings.booking_restriction_settings.step_size_minutes, 10)
                        : settings.booking_restriction_settings.step_size_minutes || 15,
                    max_future_appointments: typeof settings.booking_restriction_settings.max_future_appointments === 'string'
                        ? parseInt(settings.booking_restriction_settings.max_future_appointments, 10)
                        : settings.booking_restriction_settings.max_future_appointments || 10,
                    max_booking_window_days: typeof settings.booking_restriction_settings.max_booking_window_days === 'string'
                        ? parseInt(settings.booking_restriction_settings.max_booking_window_days, 10)
                        : settings.booking_restriction_settings.max_booking_window_days || 90,
                    minimum_cancellation_hours_before: typeof settings.booking_restriction_settings.minimum_cancellation_hours_before === 'string'
                        ? parseInt(settings.booking_restriction_settings.minimum_cancellation_hours_before, 10)
                        : settings.booking_restriction_settings.minimum_cancellation_hours_before || 24,
                    allow_patient_deletion: settings.booking_restriction_settings.allow_patient_deletion ?? true,
                },
                practitioners,
            });
        }
    }, [settings, membersData, reset]);

    useEffect(() => {
        resetForm();
    }, [resetForm]);

    // Setup navigation warnings for unsaved changes
    useUnsavedChangesDetection({ hasUnsavedChanges: () => isDirty });

    const mutation = useMutation({
        mutationFn: async (data: AppointmentsSettingsFormData) => {
            // 1. Update clinic settings
            const normalizedClinicInfo = {
                ...data.clinic_info_settings,
                appointment_type_instructions: data.clinic_info_settings.appointment_type_instructions?.trim() || null,
                appointment_notes_instructions: data.clinic_info_settings.appointment_notes_instructions?.trim() || null,
                query_page_instructions: data.clinic_info_settings.query_page_instructions?.trim() || null,
                settings_page_instructions: data.clinic_info_settings.settings_page_instructions?.trim() || null,
                notifications_page_instructions: data.clinic_info_settings.notifications_page_instructions?.trim() || null,
            };

            await apiService.updateClinicSettings({
                clinic_info_settings: normalizedClinicInfo,
                booking_restriction_settings: data.booking_restriction_settings,
            });

            // 2. Save practitioner settings if changed
            const changedPractitioners = data.practitioners.filter(current => {
                const member = membersData?.find(m => m.id === current.id);
                const originalBookingAllowed = member?.patient_booking_allowed ?? true;
                return current.patient_booking_allowed !== originalBookingAllowed;
            });

            if (changedPractitioners.length > 0) {
                await Promise.all(
                    changedPractitioners.map(practitioner =>
                        apiService.updatePractitionerSettings(practitioner.id, {
                            patient_booking_allowed: practitioner.patient_booking_allowed,
                        })
                    )
                );
            }
        },
        onSuccess: async (_, variables) => {
            reset(variables);
            await queryClient.invalidateQueries({ queryKey: ['settings'] });
            await queryClient.invalidateQueries({ queryKey: ['members'] });
            alert('設定已成功儲存');
        },
        onError: (err: any) => {
            logger.error('Failed to save appointment settings:', err);
            alert(extractErrorMessage(err, '儲存設定失敗'), '錯誤');
        }
    });

    const onFormSubmit = (data: AppointmentsSettingsFormData) => {
        mutation.mutate(data);
    };

    const handleDiscard = () => {
        resetForm();
    };

    if (settingsLoading || membersLoading) {
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
                <PageHeader title="預約設定" />
            </div>

            <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4 pb-24">
                <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm p-0 md:p-6">
                    <ClinicAppointmentSettings isClinicAdmin={isClinicAdmin} />

                    {/* 預約系統連結 Section */}
                    {settings.liff_urls && Object.keys(settings.liff_urls).length > 0 && (
                        <div className="mt-8 pt-8 border-t border-gray-200">
                            <div className="flex items-center gap-2 mb-4">
                                <h3 className="text-lg font-semibold text-gray-900">預約系統連結</h3>
                                <button
                                    type="button"
                                    onClick={() => setShowLiffInfoModal(true)}
                                    className="inline-flex items-center justify-center p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"
                                    aria-label="查看設定說明"
                                >
                                    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                    </svg>
                                </button>
                            </div>
                            <p className="text-sm text-gray-600 mb-4">
                                請將以下連結加入您的 LINE 官方帳號圖文選單，讓病患可以透過選單使用各項功能：
                            </p>
                            <div className="space-y-2">
                                {Object.entries(settings.liff_urls as Record<string, string>).map(([mode, url]) => {
                                    const modeInfo = {
                                        home: { name: '預約系統主頁', description: '預約系統首頁，提供所有功能的快速入口' },
                                        book: { name: '預約', description: '病患可預約新的就診時間' },
                                        query: { name: '預約管理', description: '病患可查詢、取消預約' },
                                        settings: { name: '就診人管理', description: '病患可新增、刪除、修改就診人資訊' },
                                        notifications: { name: '空位提醒', description: '病患可設定提醒，當有符合條件的空位時會收到通知' },
                                    }[mode as 'home' | 'book' | 'query' | 'settings' | 'notifications'] || { name: mode, description: '' };

                                    return (
                                        <div key={mode} className="bg-gray-50 rounded-lg p-2.5 border border-gray-200">
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex-1">
                                                    <h4 className="text-sm font-semibold text-gray-900 inline">{modeInfo.name}</h4>
                                                    <span className="text-xs text-gray-600 ml-2">{modeInfo.description}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <input
                                                    type="text"
                                                    readOnly
                                                    value={url as string}
                                                    onFocus={(e) => e.target.select()}
                                                    className="flex-1 block w-full rounded-md border border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm font-mono text-xs bg-white px-2 py-1.5"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={async () => {
                                                        try {
                                                            await navigator.clipboard.writeText(url as string);
                                                            await alert(`${modeInfo.name}連結已複製到剪貼簿！`, '成功');
                                                        } catch (err) {
                                                            logger.error('Failed to copy to clipboard:', err);
                                                            await alert('複製失敗', '錯誤');
                                                        }
                                                    }}
                                                    className="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 whitespace-nowrap"
                                                >
                                                    <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                    </svg>
                                                    複製
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </form>

            <SettingsActionFooter
                isVisible={isDirty}
                isSubmitting={mutation.isPending}
                onDiscard={handleDiscard}
                onSave={handleSubmit(onFormSubmit)}
            />

            {/* Info Modal for 預約系統連結 setup steps */}
            {showLiffInfoModal && (
                <BaseModal
                    onClose={() => setShowLiffInfoModal(false)}
                    aria-label="預約系統連結設定說明"
                >
                    <ModalHeader title="預約系統連結設定步驟" showClose onClose={() => setShowLiffInfoModal(false)} />
                    <ModalBody>
                        <div className="text-sm text-gray-700 space-y-4">
                            <p>請將上述連結加入您的 LINE 官方帳號圖文選單，讓病患可以透過選單使用各項功能：</p>
                            <ol className="list-decimal list-inside space-y-2">
                                <li>前往 <a href="https://manager.line.biz/" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">LINE 官方帳號管理頁面</a></li>
                                <li>點選診所的 LINE 官方帳號</li>
                                <li>在目錄中，選擇「聊天室相關」底下的「圖文選單」</li>
                                <li>為每個功能新增選單項目，並將對應的連結設為動作類型</li>
                                <li>儲存並發布選單</li>
                            </ol>
                        </div>
                    </ModalBody>
                </BaseModal>
            )}
        </FormProvider>
    );
};

export default SettingsAppointmentsPage;

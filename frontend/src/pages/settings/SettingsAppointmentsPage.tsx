import React, { useState, useEffect } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../hooks/useAuth';
import { useModal } from '../../contexts/ModalContext';
import { logger } from '../../utils/logger';
import { LoadingSpinner, BaseModal } from '../../components/shared';
import ClinicAppointmentSettings from '../../components/ClinicAppointmentSettings';
import SettingsBackButton from '../../components/SettingsBackButton';
import PageHeader from '../../components/PageHeader';
import { LINE_THEME } from '../../constants/lineTheme';
import { apiService } from '../../services/api';
import { useMembers } from '../../hooks/queries';
import { useUnsavedChangesDetection } from '../../hooks/useUnsavedChangesDetection';
import { useFormErrorScroll } from '../../hooks/useFormErrorScroll';
import { handleBackendError } from '../../utils/formErrors';
import { AppointmentsSettingsFormSchema } from '../../schemas/api';

export type AppointmentsSettingsFormData = z.infer<typeof AppointmentsSettingsFormSchema>;

const SettingsAppointmentsPage: React.FC = () => {
  const { settings, uiState, saveData, updateData } = useSettings();
  const { isClinicAdmin } = useAuth();
  const { alert } = useModal();
  const { onInvalid: scrollOnError } = useFormErrorScroll();
  const [showLiffInfoModal, setShowLiffInfoModal] = useState(false);
  const [savingPractitionerSettings, setSavingPractitionerSettings] = useState(false);
  const isSavingRef = React.useRef(false);
  const pendingFormDataRef = React.useRef<AppointmentsSettingsFormData | null>(null);

  // Fetch practitioners and their booking settings
  const { data: membersData, isLoading: membersLoading } = useMembers();

  const methods = useForm<AppointmentsSettingsFormData>({
    resolver: zodResolver(AppointmentsSettingsFormSchema),
    defaultValues: {
      clinic_info_settings: {
        appointment_type_instructions: settings?.clinic_info_settings.appointment_type_instructions || '',
        appointment_notes_instructions: settings?.clinic_info_settings.appointment_notes_instructions || '',
        require_birthday: settings?.clinic_info_settings.require_birthday || false,
        require_gender: settings?.clinic_info_settings.require_gender || false,
        restrict_to_assigned_practitioners: settings?.clinic_info_settings.restrict_to_assigned_practitioners || false,
        query_page_instructions: settings?.clinic_info_settings.query_page_instructions || '',
        settings_page_instructions: settings?.clinic_info_settings.settings_page_instructions || '',
        notifications_page_instructions: settings?.clinic_info_settings.notifications_page_instructions || '',
      },
      booking_restriction_settings: settings?.booking_restriction_settings as any || {},
      practitioners: [],
    },
    mode: 'onBlur',
  });

  const { reset, handleSubmit, formState: { isDirty } } = methods;

  // Setup navigation warnings for unsaved changes
  useUnsavedChangesDetection({ hasUnsavedChanges: () => isDirty });

  const onInvalid = (errors: any) => {
    scrollOnError(errors, methods);
  };

  // Sync form with settings data when it loads
  // Skip reset during save to prevent race condition
  useEffect(() => {
    if (isSavingRef.current) {
      return;
    }
    if (settings && membersData) {
      const practitioners = membersData
        .filter(m => m.roles.includes('practitioner'))
        .map(p => ({
          id: p.id,
          full_name: p.full_name,
          patient_booking_allowed: p.patient_booking_allowed ?? true,
          step_size_minutes: p.step_size_minutes ?? null,
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
        booking_restriction_settings: settings.booking_restriction_settings as any,
        practitioners,
      });
    }
  }, [settings, membersData, reset]);

  // Watch for settings update after updateData, then trigger save
  useEffect(() => {
    if (pendingFormDataRef.current && isSavingRef.current && settings) {
      // Check if both settings sections match what we're trying to save
      // Normalize null/empty strings for consistent comparison (both sides use same normalization)
      const normalizeForComparison = (value: string | null | undefined): string => {
        if (!value) return '';
        return value.trim() || '';
      };
      
      const pendingClinicInfo = pendingFormDataRef.current.clinic_info_settings;
      const pendingClinicInfoStr = JSON.stringify({
        appointment_type_instructions: normalizeForComparison(pendingClinicInfo.appointment_type_instructions),
        appointment_notes_instructions: normalizeForComparison(pendingClinicInfo.appointment_notes_instructions),
        require_birthday: pendingClinicInfo.require_birthday || false,
        require_gender: pendingClinicInfo.require_gender || false,
        restrict_to_assigned_practitioners: pendingClinicInfo.restrict_to_assigned_practitioners || false,
        query_page_instructions: normalizeForComparison(pendingClinicInfo.query_page_instructions),
        settings_page_instructions: normalizeForComparison(pendingClinicInfo.settings_page_instructions),
        notifications_page_instructions: normalizeForComparison(pendingClinicInfo.notifications_page_instructions),
      });
      
      const currentClinicInfoStr = JSON.stringify({
        appointment_type_instructions: normalizeForComparison(settings.clinic_info_settings.appointment_type_instructions),
        appointment_notes_instructions: normalizeForComparison(settings.clinic_info_settings.appointment_notes_instructions),
        require_birthday: settings.clinic_info_settings.require_birthday || false,
        require_gender: settings.clinic_info_settings.require_gender || false,
        restrict_to_assigned_practitioners: settings.clinic_info_settings.restrict_to_assigned_practitioners || false,
        query_page_instructions: normalizeForComparison(settings.clinic_info_settings.query_page_instructions),
        settings_page_instructions: normalizeForComparison(settings.clinic_info_settings.settings_page_instructions),
        notifications_page_instructions: normalizeForComparison(settings.clinic_info_settings.notifications_page_instructions),
      });

      const pendingBookingStr = JSON.stringify(pendingFormDataRef.current.booking_restriction_settings);
      const currentBookingStr = JSON.stringify(settings.booking_restriction_settings);

      if (pendingClinicInfoStr === currentClinicInfoStr && pendingBookingStr === currentBookingStr) {
        // Settings have been updated, now save
        const performSave = async () => {
          try {
            await saveData();
            // Reset form with saved data to clear isDirty flag
            // Convert null back to empty string for form display (form expects strings, not null)
            const formDataForReset = {
              ...pendingFormDataRef.current!,
              clinic_info_settings: {
                ...pendingFormDataRef.current!.clinic_info_settings,
                appointment_type_instructions: pendingFormDataRef.current!.clinic_info_settings.appointment_type_instructions || '',
                appointment_notes_instructions: pendingFormDataRef.current!.clinic_info_settings.appointment_notes_instructions || '',
                query_page_instructions: pendingFormDataRef.current!.clinic_info_settings.query_page_instructions || '',
                settings_page_instructions: pendingFormDataRef.current!.clinic_info_settings.settings_page_instructions || '',
                notifications_page_instructions: pendingFormDataRef.current!.clinic_info_settings.notifications_page_instructions || '',
              },
            };
            reset(formDataForReset);
            pendingFormDataRef.current = null;
            isSavingRef.current = false;
            setSavingPractitionerSettings(false);
            alert('設定已成功儲存');
          } catch (err) {
            isSavingRef.current = false;
            pendingFormDataRef.current = null;
            setSavingPractitionerSettings(false);
            handleBackendError(err, methods);
          }
        };
        performSave();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.clinic_info_settings, settings?.booking_restriction_settings]);

  const onFormSubmit = async (data: AppointmentsSettingsFormData) => {
    if (!isClinicAdmin) return;

    setSavingPractitionerSettings(true);
    isSavingRef.current = true;
    
    // Normalize empty strings to null for optional string fields
    // Store normalized data in pendingFormDataRef so comparison works correctly
    const normalizedClinicInfo = {
      ...data.clinic_info_settings,
      appointment_type_instructions: data.clinic_info_settings.appointment_type_instructions?.trim() || null,
      appointment_notes_instructions: data.clinic_info_settings.appointment_notes_instructions?.trim() || null,
      query_page_instructions: data.clinic_info_settings.query_page_instructions?.trim() || null,
      settings_page_instructions: data.clinic_info_settings.settings_page_instructions?.trim() || null,
      notifications_page_instructions: data.clinic_info_settings.notifications_page_instructions?.trim() || null,
    };
    
    // Store normalized data for comparison
    pendingFormDataRef.current = {
      ...data,
      clinic_info_settings: normalizedClinicInfo,
    };
    
    try {
      // 1. Update clinic settings in context
      updateData({
        clinic_info_settings: {
          ...settings?.clinic_info_settings,
          ...normalizedClinicInfo,
        } as any,
        booking_restriction_settings: data.booking_restriction_settings as any,
      });

      // 2. Save practitioner settings
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

      // 3. Save all via context - the useEffect above will trigger save once state is updated

    } catch (err: any) {
      logger.error('Failed to save appointment settings:', err);
      isSavingRef.current = false;
      pendingFormDataRef.current = null;
      setSavingPractitionerSettings(false);
      if (!handleBackendError(err, methods)) {
        alert(err.response?.data?.detail || '儲存設定失敗', '錯誤');
      }
    }
  };

  if (uiState.loading || membersLoading) {
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
        {isDirty && (
          <button
            type="button"
            onClick={handleSubmit(onFormSubmit, onInvalid)}
            disabled={uiState.saving || savingPractitionerSettings}
            className="btn-primary text-sm px-4 py-2"
          >
            {(uiState.saving || savingPractitionerSettings) ? '儲存中...' : '儲存變更'}
          </button>
        )}
      </div>
      <form onSubmit={handleSubmit(onFormSubmit, onInvalid)} className="space-y-4">
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
                    book: { name: '預約', description: '病患可預約新的就診時間' },
                    query: { name: '預約管理', description: '病患可查詢、取消預約' },
                    settings: { name: '就診人管理', description: '病患可新增、刪除、修改就診人資訊' },
                    notifications: { name: '空位提醒', description: '病患可設定提醒，當有符合條件的空位時會收到通知' },
                  }[mode as 'book' | 'query' | 'settings' | 'notifications'] || { name: mode, description: '' };

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

          {/* Info Modal for 預約系統連結 setup steps */}
          {showLiffInfoModal && (
            <BaseModal
              onClose={() => setShowLiffInfoModal(false)}
              aria-label="預約系統連結設定說明"
            >
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3 flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">預約系統連結設定步驟</h3>
                  <div className="text-sm text-gray-700 space-y-2">
                    <p className="mb-3">請將上述連結加入您的 LINE 官方帳號圖文選單，讓病患可以透過選單使用各項功能：</p>
                    <ol className="list-decimal list-inside space-y-2 text-gray-700">
                      <li>
                        前往{' '}
                        <a
                          href="https://manager.line.biz/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 underline font-medium"
                        >
                          LINE 官方帳號管理頁面
                        </a>
                      </li>
                      <li>點選診所的 LINE 官方帳號</li>
                      <li>在目錄中，選擇「聊天室相關」底下的「圖文選單」</li>
                      <li>為每個功能新增選單項目，並將對應的連結設為動作類型</li>
                      <li>儲存並發布選單</li>
                    </ol>
                  </div>

                  {/* LINE Official Account UI Mockup */}
                  {settings.liff_urls && Object.keys(settings.liff_urls).length > 0 && (
                    <div className="mt-6">
                      <div className="text-xs text-gray-500 mb-2 text-center">LINE 官方帳號預覽</div>
                      <div className="bg-white rounded-lg border-2 border-gray-300 shadow-xl overflow-hidden max-w-[280px] mx-auto">
                        {/* Header */}
                        <div className="bg-[#06C755] px-4 py-3 flex items-center gap-3">
                          <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center">
                            <span className="text-[#06C755] text-lg font-bold">
                              {settings.clinic_name?.[0] || '診'}
                            </span>
                          </div>
                          <div className="flex-1">
                            <div className="text-white font-semibold text-sm">
                              {settings.clinic_name || '診所名稱'}
                            </div>
                          </div>
                        </div>

                        {/* Chat Interface */}
                        <div
                          className="p-4 min-h-[250px] flex flex-col justify-start gap-3 pt-6"
                          style={{ backgroundColor: LINE_THEME.chatBackground }}
                        >
                          {/* Clinic greeting message */}
                          <div className="flex items-start gap-2">
                            <div className="w-6 h-6 bg-[#06C755] rounded-full flex items-center justify-center flex-shrink-0">
                              <span className="text-white text-xs font-bold">
                                {settings.clinic_name?.[0] || '診'}
                              </span>
                            </div>
                            <div className="bg-white rounded-lg px-3 py-2 shadow-sm max-w-[75%]">
                              <p className="text-sm text-gray-800">
                                歡迎加入好友！請點擊下方選單進行預約
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Rich Menu */}
                        <div className="bg-white border-t-2 border-gray-200 p-2">
                          <div className="grid grid-cols-4 gap-1.5">
                            {Object.entries(settings.liff_urls).map(([mode]) => {
                              const modeInfo = {
                                book: { name: '預約', icon: '📅' },
                                query: { name: '預約管理', icon: '🔍' },
                                settings: { name: '就診人管理', icon: '👤' },
                                notifications: { name: '空位提醒', icon: '🔔' },
                              }[mode] || { name: mode, icon: '📌' };

                              return (
                                <button
                                  key={mode}
                                  type="button"
                                  className="bg-gray-50 border border-gray-200 rounded-lg p-1.5 text-center hover:bg-gray-100 transition-colors active:bg-gray-200 aspect-square flex flex-col items-center justify-center"
                                >
                                  <div className="text-base mb-0.5">{modeInfo.icon}</div>
                                  <div className="text-[9px] font-medium text-gray-700 leading-tight">
                                    {modeInfo.name}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setShowLiffInfoModal(false)}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                    >
                      關閉
                    </button>
                  </div>
                </div>
              </div>
            </BaseModal>
          )}
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

export default SettingsAppointmentsPage;

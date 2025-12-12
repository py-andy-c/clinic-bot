import React, { useState } from 'react';
import { apiService, sharedFetchFunctions } from '../services/api';
import { logger } from '../utils/logger';
import { LoadingSpinner, BaseModal } from '../components/shared';
import { ClinicSettings } from '../schemas/api';
import { AppointmentType } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useSettingsPage } from '../hooks/useSettingsPage';
import { useModal } from '../contexts/ModalContext';
import { useApiData, invalidateCacheForFunction, invalidateCacheByPattern } from '../hooks/useApiData';
import { validateClinicSettings, getClinicSectionChanges } from '../utils/clinicSettings';
import { getErrorMessage } from '../types/api';
import ClinicAppointmentSettings from '../components/ClinicAppointmentSettings';
import ClinicReminderSettings from '../components/ClinicReminderSettings';
import ClinicInfoSettings from '../components/ClinicInfoSettings';
import ChatSettings from '../components/ChatSettings';
import ServiceItemsSettings from '../components/ServiceItemsSettings';
import ReceiptSettings from '../components/ReceiptSettings';
import SettingsSection from '../components/SettingsSection';
import PageHeader from '../components/PageHeader';
import { LINE_THEME } from '../constants/lineTheme';

const SettingsPage: React.FC = () => {
  const { isClinicAdmin, isClinicUser, isLoading, user } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const { alert, confirm } = useModal();
  const [clinicInfoRefreshTrigger, setClinicInfoRefreshTrigger] = React.useState(0);
  const [showLiffInfoModal, setShowLiffInfoModal] = useState(false);

  // Scroll to top when component mounts
  React.useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Only clinic users can access clinic settings
  if (!isClinicUser) {
    return (
      <div className="space-y-8">
        <PageHeader title="診所設定" />

        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-6 text-center">
          <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-yellow-600 text-xl">⚠️</span>
          </div>
          <h3 className="text-lg font-medium text-yellow-800 mb-2">無權限存取設定</h3>
          <p className="text-yellow-700">
            只有診所成員才能查看此頁面。
          </p>
        </div>
      </div>
    );
  }

  // Fetch clinic settings with caching (shares cache with GlobalWarnings)
  const { data: cachedSettings, loading: settingsLoading } = useApiData(
    sharedFetchFunctions.getClinicSettings,
    {
      enabled: !isLoading,
      dependencies: [isLoading],
      cacheTTL: 5 * 60 * 1000, // 5 minutes cache
    }
  );

  // Use settings page hook with cached data to avoid duplicate fetch
  const {
    data: settings,
    originalData,
    uiState,
    sectionChanges,
    saveData,
    updateData,
    fetchData,
  } = useSettingsPage({
    fetchData: async () => {
      return await sharedFetchFunctions.getClinicSettings();
    },
    saveData: async (data: ClinicSettings) => {
      // Convert reminder hours and booking restriction hours to numbers for backend
      const settingsToSave = {
        ...data,
        notification_settings: {
          ...data.notification_settings,
          reminder_hours_before: parseInt(String(data.notification_settings.reminder_hours_before)) || 24
        },
        booking_restriction_settings: {
          ...data.booking_restriction_settings,
          minimum_booking_hours_ahead: parseInt(String(data.booking_restriction_settings.minimum_booking_hours_ahead)) || 24,
          max_future_appointments: parseInt(String(data.booking_restriction_settings.max_future_appointments || 3)) || 3,
          max_booking_window_days: parseInt(String(data.booking_restriction_settings.max_booking_window_days || 90)) || 90,
          minimum_cancellation_hours_before: parseInt(String(data.booking_restriction_settings.minimum_cancellation_hours_before || 24)) || 24,
          allow_patient_deletion: data.booking_restriction_settings.allow_patient_deletion ?? true
        }
      };
      try {
        await apiService.updateClinicSettings(settingsToSave);
      } catch (error: any) {
        // Handle appointment type deletion error
        if (error.response?.status === 400 && error.response?.data?.detail?.error === 'cannot_delete_appointment_types') {
          const errorDetail = error.response.data.detail;
          // For simplicity, show only the first blocked appointment type
          // (in practice, this usually happens one at a time)
          const blockedType = errorDetail.appointment_types[0];
          const practitionerNames = blockedType.practitioners.join('、');
          const errorMessage = `「${blockedType.name}」正在被以下治療師使用：${practitionerNames}\n\n請先移除治療師的此服務設定後再刪除。`;
          throw new Error(errorMessage);
        }
        throw error;
      }
    },
    validateData: validateClinicSettings,
    getSectionChanges: getClinicSectionChanges,
    onValidationError: async (error: string) => {
      await alert(error, '錯誤');
    },
    onSuccess: () => {
      // Invalidate cache after successful save so other components see fresh data
      invalidateCacheForFunction(sharedFetchFunctions.getClinicSettings);

      // Check if clinic info was changed and saved by comparing with the data before save
      if (settings && originalData) {
        const changes = getClinicSectionChanges(settings, originalData);
        if (changes.clinicInfoSettings) {
          // Clinic info was saved, refresh the preview
          setClinicInfoRefreshTrigger(prev => prev + 1);
        }
      }
    },
  }, {
    isLoading: isLoading || settingsLoading,
    ...(cachedSettings ? { initialData: cachedSettings } : {}),
    skipFetch: !!cachedSettings // Only skip fetch if we have cached data
  });

  // Refresh settings when clinic changes
  // Invalidate cache to ensure fresh data for the new clinic
  const previousClinicIdRef = React.useRef<number | null | undefined>(activeClinicId ?? null);
  React.useEffect(() => {
    const currentClinicId = activeClinicId;
    if (!isLoading && currentClinicId && previousClinicIdRef.current !== currentClinicId && previousClinicIdRef.current !== null && previousClinicIdRef.current !== undefined) {
      // Invalidate cache when clinic changes
      invalidateCacheForFunction(sharedFetchFunctions.getClinicSettings);
      invalidateCacheByPattern('api_getPractitionerStatus_');
      invalidateCacheByPattern('api_getBatchPractitionerStatus_');
      // Force refetch by calling fetchData (skipFetch will be false after invalidation)
      if (fetchData) {
        fetchData();
      }
    }
    // Update ref value
    previousClinicIdRef.current = currentClinicId ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClinicId, isLoading]);

  const addAppointmentType = () => {
    if (!settings) return;

    const newType: AppointmentType = {
      id: Date.now(), // Temporary ID for UI
      clinic_id: settings.clinic_id || 0, // Use clinic_id from settings or default
      name: '',
      duration_minutes: 30,
      receipt_name: undefined,
      allow_patient_booking: true,
      description: undefined,
      scheduling_buffer_minutes: 0,
    };

    updateData({
      appointment_types: [...settings.appointment_types, newType],
    });
  };

  const updateAppointmentType = (index: number, field: keyof AppointmentType, value: string | number | boolean | null) => {
    if (!settings) return;

    const updatedTypes = [...settings.appointment_types];
    updatedTypes[index] = {
      ...updatedTypes[index],
      [field]: value
    } as AppointmentType;

    updateData({
      appointment_types: updatedTypes,
    });
  };

  const removeAppointmentType = async (index: number) => {
    if (!settings) return;

    const appointmentType = settings.appointment_types[index];
    if (!appointmentType || !appointmentType.id) {
      // New appointment type (no ID yet), can remove immediately
      const updatedTypes = settings.appointment_types.filter((_, i) => i !== index);
      updateData({
        appointment_types: updatedTypes,
      });
      return;
    }

    // Validate deletion before removing from UI
    try {
      const validation = await apiService.validateAppointmentTypeDeletion([appointmentType.id]);

      if (!validation.can_delete && validation.error) {
        // Show error immediately
        const errorDetail = validation.error;
        // For simplicity, show only the first blocked appointment type
        // (in practice, only one type is being deleted at a time)
        const blockedType = errorDetail.appointment_types[0];
        const practitionerNames = blockedType.practitioners.join('、');
        const errorMessage = `「${blockedType.name}」正在被以下治療師使用：${practitionerNames}\n\n請先移除治療師的此服務設定後再刪除。`;

        // Show error in popup modal
        await alert(errorMessage, '無法刪除預約類型');
        return; // Don't remove from UI
      }

      // Validation passed, remove from UI
      const updatedTypes = settings.appointment_types.filter((_, i) => i !== index);
      updateData({
        appointment_types: updatedTypes,
      });
    } catch (error: any) {
      logger.error('Error validating appointment type deletion:', error);
      const errorMessage = getErrorMessage(error) || '驗證刪除失敗，請稍後再試';
      await alert(errorMessage, '驗證失敗');
    }
  };

  const handleChatSettingsSave = async () => {
    if (!settings || !originalData) return;

    const wasEnabled = originalData.chat_settings.chat_enabled;
    const isEnabled = settings.chat_settings.chat_enabled;

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

    // Proceed to save
    saveData();
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
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <PageHeader title="診所設定" />

      <form onSubmit={(e) => { e.preventDefault(); saveData(); }} className="space-y-4">
        {/* Service Items Settings - New section for service items with billing */}
        <SettingsSection
          title="服務項目設定"
          showSaveButton={sectionChanges.appointmentSettings || false}
          onSave={saveData}
          saving={uiState.saving}
        >
          <ServiceItemsSettings
            appointmentTypes={settings.appointment_types}
            onAddType={addAppointmentType}
            onUpdateType={updateAppointmentType}
            onRemoveType={removeAppointmentType}
            isClinicAdmin={isClinicAdmin}
          />
        </SettingsSection>

        {/* Appointment Settings - Booking restrictions and instructions */}
        <SettingsSection
          title="預約設定"
          showSaveButton={sectionChanges.appointmentSettings || false}
          onSave={saveData}
          saving={uiState.saving}
        >
          <ClinicAppointmentSettings
            appointmentTypeInstructions={settings.clinic_info_settings.appointment_type_instructions ?? null}
            appointmentNotesInstructions={settings.clinic_info_settings.appointment_notes_instructions ?? null}
            bookingRestrictionSettings={settings.booking_restriction_settings}
            requireBirthday={settings.clinic_info_settings.require_birthday || false}
            onAppointmentTypeInstructionsChange={(instructions) => {
              updateData((prev) => ({
                clinic_info_settings: {
                  ...prev.clinic_info_settings,
                  appointment_type_instructions: instructions
                }
              }));
            }}
            onAppointmentNotesInstructionsChange={(instructions) => {
              updateData((prev) => ({
                clinic_info_settings: {
                  ...prev.clinic_info_settings,
                  appointment_notes_instructions: instructions
                }
              }));
            }}
            onBookingRestrictionSettingsChange={(bookingSettings) => {
              updateData({
                booking_restriction_settings: bookingSettings
              });
            }}
            onRequireBirthdayChange={(value) => {
              updateData((prev) => ({
                clinic_info_settings: {
                  ...prev.clinic_info_settings,
                  require_birthday: value
                }
              }));
            }}
            isClinicAdmin={isClinicAdmin}
          />

          {/* 預約系統連結 Section - Unique block */}
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
                {Object.entries(settings.liff_urls).map(([mode, url]) => {
                  const modeInfo = {
                    book: { name: '預約', description: '病患可預約新的就診時間' },
                    query: { name: '預約管理', description: '病患可查詢、取消預約' },
                    settings: { name: '就診人管理', description: '病患可新增、刪除、修改就診人資訊' },
                    notifications: { name: '空位提醒', description: '病患可設定提醒，當有符合條件的空位時會收到通知' },
                  }[mode] || { name: mode, description: '' };

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
                          value={url}
                          onFocus={(e) => e.target.select()}
                          className="flex-1 block w-full rounded-md border border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm font-mono text-xs bg-white px-2 py-1.5"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(url);
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
        </SettingsSection>

        {/* Clinic Info Settings */}
        <SettingsSection
          title="診所資訊"
          showSaveButton={sectionChanges.clinicInfoSettings || false}
          onSave={saveData}
          saving={uiState.saving}
        >
          <ClinicInfoSettings
            clinicInfoSettings={settings.clinic_info_settings}
            clinicName={settings.clinic_name}
            onClinicInfoSettingsChange={(clinicInfoSettings) => {
              updateData((prev) => ({
                clinic_info_settings: {
                  ...prev.clinic_info_settings,
                  ...clinicInfoSettings
                }
              }));
            }}
            isClinicAdmin={isClinicAdmin}
          />
        </SettingsSection>

        {/* Reminder Settings */}
        <SettingsSection
          title="LINE提醒設定"
          showSaveButton={sectionChanges.reminderSettings || false}
          onSave={saveData}
          saving={uiState.saving}
        >
          <ClinicReminderSettings
            reminderHoursBefore={settings.notification_settings.reminder_hours_before}
            onReminderHoursChange={(value) => {
              updateData({
                notification_settings: {
                  ...settings.notification_settings,
                  reminder_hours_before: value
                }
              });
            }}
            isClinicAdmin={isClinicAdmin}
            refreshTrigger={clinicInfoRefreshTrigger}
          />
        </SettingsSection>

        {/* Chat Settings */}
        <SettingsSection
          title="AI 聊天功能"
          showSaveButton={sectionChanges.chatSettings || false}
          onSave={handleChatSettingsSave}
          saving={uiState.saving}
          headerActions={
            <button
              type="button"
              onClick={() => {
                // This will be handled by ChatSettings component
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
          }
        >
          <ChatSettings
            chatSettings={settings.chat_settings}
            onChatSettingsChange={(chatSettings) => {
              updateData({
                chat_settings: chatSettings
              });
            }}
            isClinicAdmin={isClinicAdmin}
          />
        </SettingsSection>

        {/* Receipt Settings - Admin only */}
        {isClinicAdmin && (
          <SettingsSection
            title="收據設定"
            showSaveButton={sectionChanges.receiptSettings || false}
            onSave={saveData}
            saving={uiState.saving}
          >
            <ReceiptSettings
              receiptSettings={settings.receipt_settings || { custom_notes: null, show_stamp: false }}
              onReceiptSettingsChange={(receiptSettings) => {
                updateData((prev) => ({
                  ...prev,
                  receipt_settings: receiptSettings
                }));
              }}
              isClinicAdmin={isClinicAdmin}
            />
          </SettingsSection>
        )}

        {/* Error Display */}
        {uiState.error && (
          <div className="bg-white rounded-lg border border-red-200 shadow-sm p-6">
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
    </div>
  );
};

export default SettingsPage;


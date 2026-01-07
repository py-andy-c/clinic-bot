import React, { useState, useEffect } from 'react';
import { useFormContext } from 'react-hook-form';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { InfoButton, InfoModal } from './shared';
import { FormField, FormInput } from './forms';
import { TimeInput } from './shared';
import { RemindersSettingsFormData } from '../pages/settings/SettingsRemindersPage';

interface ClinicReminderSettingsProps {
  isClinicAdmin?: boolean;
  refreshTrigger?: number;
}

const ClinicReminderSettings: React.FC<ClinicReminderSettingsProps> = ({
  isClinicAdmin = false,
  refreshTrigger = 0,
}) => {
  const [previewMessage, setPreviewMessage] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showTimingModeModal, setShowTimingModeModal] = useState(false);

  const { watch, setValue, formState: { errors } } = useFormContext<RemindersSettingsFormData>();
  const reminderTimingMode = watch('notification_settings.reminder_timing_mode') || 'hours_before';

  // Generate preview when settings are saved (refreshTrigger changes)
  useEffect(() => {
    const generatePreview = async () => {
      setPreviewLoading(true);
      setPreviewError(null);

      try {
        const response = await apiService.generateReminderPreview({
          appointment_type: '一般診療',
          appointment_time: '12/25 (三) 1:30 PM',
          therapist_name: '王大明',
        });
        setPreviewMessage(response.preview_message);
      } catch (error) {
        logger.error('Failed to generate reminder preview:', error);
        setPreviewError('無法載入預覽');
        // Fallback to a basic message
        setPreviewMessage('提醒您，您預約的【一般診療】預計於【12/25 (三) 1:30 PM】開始，由【王大明治療師】為您服務。\n\n請準時前往診所，期待為您服務！');
      } finally {
        setPreviewLoading(false);
      }
    };

    generatePreview();
  }, [refreshTrigger]);

  return (
    <div className="max-w-md">
        {/* Timing Mode Selector */}
        <div className="flex items-center gap-2 mb-2">
          <label className="block text-sm font-medium text-gray-700">
            提醒時間設定
          </label>
          <InfoButton onClick={() => setShowTimingModeModal(true)} />
        </div>
        <div className="space-y-3 mb-4">
          <div>
            <div className="flex items-center">
              <input
                id="timing-mode-hours-before"
                type="radio"
                value="hours_before"
                checked={reminderTimingMode === 'hours_before'}
                onChange={(e) => setValue('notification_settings.reminder_timing_mode', e.target.value as 'hours_before' | 'previous_day', { shouldDirty: true })}
                disabled={!isClinicAdmin}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
              />
              <label htmlFor="timing-mode-hours-before" className="ml-2 block text-sm text-gray-900">
                預約前幾小時發送提醒
              </label>
            </div>
            {reminderTimingMode === 'hours_before' && (
              <div className="ml-6 mt-2">
                <FormField name="notification_settings.reminder_hours_before">
                  <FormInput
                    name="notification_settings.reminder_hours_before"
                    type="number"
                    min="1"
                    max="72"
                    disabled={!isClinicAdmin}
                    placeholder="24"
                  />
                </FormField>
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center">
              <input
                id="timing-mode-previous-day"
                type="radio"
                value="previous_day"
                checked={reminderTimingMode === 'previous_day'}
                onChange={(e) => setValue('notification_settings.reminder_timing_mode', e.target.value as 'hours_before' | 'previous_day', { shouldDirty: true })}
                disabled={!isClinicAdmin}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
              />
              <label htmlFor="timing-mode-previous-day" className="ml-2 block text-sm text-gray-900">
                前一天特定時間發送提醒
              </label>
            </div>
            {reminderTimingMode === 'previous_day' && (
              <div className="ml-6 mt-2">
                <FormField name="notification_settings.reminder_previous_day_time">
                  <TimeInput
                    value={watch('notification_settings.reminder_previous_day_time') || ''}
                    onChange={(value) => setValue('notification_settings.reminder_previous_day_time', value, { shouldDirty: true })}
                    error={errors?.notification_settings?.reminder_previous_day_time?.message || null}
                    disabled={!isClinicAdmin}
                  />
                </FormField>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-gray-200 md:pt-0 md:border-t-0">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            訊息預覽
          </label>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            {previewLoading ? (
              <div className="text-sm text-gray-500">載入中...</div>
            ) : previewError ? (
              <div className="text-sm text-red-600">{previewError}</div>
            ) : (
              <div className="text-sm text-gray-700 whitespace-pre-line">
                {previewMessage}
              </div>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            * 預約類型、時間及治療師姓名為範例資料，實際訊息將使用真實預約資訊
          </div>
        </div>

        {/* Info Modal */}
        <InfoModal
          isOpen={showTimingModeModal}
          onClose={() => setShowTimingModeModal(false)}
          title="提醒時間設定說明"
          ariaLabel="提醒時間設定說明"
        >
          <div className="space-y-3">
            <div>
              <h4 className="font-medium text-gray-900">預約前幾小時發送提醒</h4>
              <p className="text-sm text-gray-600">系統會在預約時間前 X 小時自動發送 LINE 提醒訊息給病患。例如設定 24 小時，病患會在預約前一天相同時間收到提醒。</p>
            </div>
            <div>
              <h4 className="font-medium text-gray-900">前一天特定時間發送提醒</h4>
              <p className="text-sm text-gray-600">系統會在前一天的指定時間發送提醒訊息。例如設定 21:00，病患會在前一天晚上 9 點收到提醒。適用於希望在固定時間發送提醒的診所。</p>
            </div>
          </div>
        </InfoModal>
    </div>
  );
};

export default ClinicReminderSettings;

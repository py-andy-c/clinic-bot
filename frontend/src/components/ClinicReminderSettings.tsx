import React, { useState } from 'react';
import { useFormContext, Controller } from 'react-hook-form';
import { InfoButton, InfoModal, TimeInput } from './shared';
import { FormField, FormInput } from './forms';
import { RemindersSettingsFormData } from '../pages/settings/SettingsRemindersPage';

interface ClinicReminderSettingsProps {
  isClinicAdmin?: boolean;
}

const ClinicReminderSettings: React.FC<ClinicReminderSettingsProps> = ({
  isClinicAdmin = false,
}) => {
  const [showTimingModeModal, setShowTimingModeModal] = useState(false);

  const { watch, register, control, formState: { errors } } = useFormContext<RemindersSettingsFormData>();
  const reminderTimingMode = watch('notification_settings.reminder_timing_mode') || 'hours_before';

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
              {...register('notification_settings.reminder_timing_mode')}
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
                  step="1"
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
              {...register('notification_settings.reminder_timing_mode')}
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
                <Controller
                  name="notification_settings.reminder_previous_day_time"
                  control={control}
                  render={({ field }) => (
                    <TimeInput
                      value={field.value || ''}
                      onChange={field.onChange}
                      error={errors?.notification_settings?.reminder_previous_day_time?.message || null}
                      disabled={!isClinicAdmin}
                    />
                  )}
                />
              </FormField>
            </div>
          )}
        </div>
      </div>

      {/* Reminder Days Ahead */}
      {/* Moved to per-practitioner profile settings */}

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

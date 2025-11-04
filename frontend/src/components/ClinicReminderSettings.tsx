import React from 'react';
import { formatReminderMessage, generateDummyReminderData, ClinicInfo } from '../utils/messageFormatting';

interface ClinicReminderSettingsProps {
  reminderHoursBefore: string | number;
  onReminderHoursChange: (value: string) => void;
  showSaveButton?: boolean;
  onSave?: () => void;
  saving?: boolean;
  isClinicAdmin?: boolean;
  clinicName: string;
  clinicInfoSettings: {
    display_name?: string | null | undefined;
    address?: string | null | undefined;
    phone_number?: string | null | undefined;
  };
}

const ClinicReminderSettings: React.FC<ClinicReminderSettingsProps> = ({
  reminderHoursBefore,
  onReminderHoursChange,
  showSaveButton = false,
  onSave,
  saving = false,
  isClinicAdmin = false,
  clinicName,
  clinicInfoSettings,
}) => {
  // Generate dummy data for preview
  const clinicInfo: ClinicInfo = {
    name: clinicName,
    display_name: clinicInfoSettings.display_name,
    address: clinicInfoSettings.address,
    phone_number: clinicInfoSettings.phone_number,
  };
  const dummyData = generateDummyReminderData(clinicInfo);
  const previewMessage = formatReminderMessage(dummyData);
  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-gray-900">提醒設定</h2>
        {showSaveButton && onSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="btn-primary"
          >
            {saving ? '儲存中...' : '儲存更變'}
          </button>
        )}
      </div>

      <div className="max-w-md">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          預約前幾小時發送提醒
        </label>
        <input
          type="number"
          value={reminderHoursBefore}
          onChange={(e) => onReminderHoursChange(e.target.value)}
          className="input"
          min="1"
          max="168"
          disabled={!isClinicAdmin}
        />
        <p className="text-sm text-gray-500 mt-1">
          預設為 24 小時前發送提醒
        </p>
      </div>

      {/* Message Preview */}
      <div className="mt-8">
        <h3 className="text-lg font-medium text-gray-900 mb-3">LINE提醒訊息預覽</h3>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-700 whitespace-pre-line">
            {previewMessage}
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-2">
          這是發送給病患的LINE提醒訊息格式，使用目前診所資訊設定
        </p>
      </div>
    </div>
  );
};

export default ClinicReminderSettings;

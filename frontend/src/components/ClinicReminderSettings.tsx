import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';

interface ClinicReminderSettingsProps {
  reminderHoursBefore: string | number;
  onReminderHoursChange: (value: string) => void;
  showSaveButton?: boolean;
  onSave?: () => void;
  saving?: boolean;
  isClinicAdmin?: boolean;
  clinicInfoSettings: {
    display_name?: string | null | undefined;
    address?: string | null | undefined;
    phone_number?: string | null | undefined;
  };
  refreshTrigger?: number;
}

const ClinicReminderSettings: React.FC<ClinicReminderSettingsProps> = ({
  reminderHoursBefore,
  onReminderHoursChange,
  showSaveButton = false,
  onSave,
  saving = false,
  isClinicAdmin = false,
  clinicInfoSettings,
  refreshTrigger = 0,
}) => {
  const [previewMessage, setPreviewMessage] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Generate preview when clinic info changes
  useEffect(() => {
    const generatePreview = async () => {
      setPreviewLoading(true);
      setPreviewError(null);

      try {
        const response = await apiService.generateReminderPreview({
          appointment_type: '一般診療',
          appointment_time: '12/25 (三) 14:30',
          therapist_name: '王大明',
        });
        setPreviewMessage(response.preview_message);
      } catch (error) {
        console.error('Failed to generate reminder preview:', error);
        setPreviewError('無法載入預覽');
        // Fallback to a basic message
        setPreviewMessage('提醒您，您預約的【一般診療】預計於【12/25 (三) 14:30】開始，由【王大明治療師】為您服務。\n\n請準時前往診所，期待為您服務！');
      } finally {
        setPreviewLoading(false);
      }
    };

    generatePreview();
  }, [clinicInfoSettings, refreshTrigger]);
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
        <p className="text-sm text-gray-500 mt-2">
          這是發送給病患的LINE提醒訊息格式，使用目前診所資訊設定
        </p>
      </div>
    </div>
  );
};

export default ClinicReminderSettings;

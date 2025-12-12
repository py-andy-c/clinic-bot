import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { preventScrollWheelChange } from '../utils/inputUtils';
import { InfoButton, InfoModal } from './shared';

interface ClinicReminderSettingsProps {
  reminderHoursBefore: string | number;
  onReminderHoursChange: (value: string) => void;
  isClinicAdmin?: boolean;
  refreshTrigger?: number;
}

const ClinicReminderSettings: React.FC<ClinicReminderSettingsProps> = ({
  reminderHoursBefore,
  onReminderHoursChange,
  isClinicAdmin = false,
  refreshTrigger = 0,
}) => {
  const [previewMessage, setPreviewMessage] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showReminderHoursModal, setShowReminderHoursModal] = useState(false);

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
        <div className="flex items-center gap-2 mb-2">
          <label className="block text-sm font-medium text-gray-700">
            預約前幾小時發送提醒
          </label>
          <InfoButton onClick={() => setShowReminderHoursModal(true)} />
        </div>
        <input
          type="number"
          value={reminderHoursBefore}
          onChange={(e) => onReminderHoursChange(e.target.value)}
          onWheel={preventScrollWheelChange}
          className="input"
          min="1"
          max="168"
          disabled={!isClinicAdmin}
        />

        <div className="mt-6">
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
          isOpen={showReminderHoursModal}
          onClose={() => setShowReminderHoursModal(false)}
          title="預約前幾小時發送提醒"
          ariaLabel="預約前幾小時發送提醒說明"
        >
          <p>系統會在預約時間前 X 小時自動發送 LINE 提醒訊息給病患。例如設定 24 小時，病患會在預約前一天相同時間收到提醒。此提醒包含預約時間、服務項目和治療師資訊。</p>
        </InfoModal>
    </div>
  );
};

export default ClinicReminderSettings;

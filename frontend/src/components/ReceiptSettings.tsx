import React from 'react';
import { ReceiptSettings as ReceiptSettingsType } from '../schemas/api';

interface ReceiptSettingsProps {
  receiptSettings: ReceiptSettingsType;
  onReceiptSettingsChange: (settings: ReceiptSettingsType) => void;
  isClinicAdmin: boolean;
}

const ReceiptSettings: React.FC<ReceiptSettingsProps> = ({
  receiptSettings,
  onReceiptSettingsChange,
  isClinicAdmin,
}) => {
  if (!isClinicAdmin) {
    return null; // Admin-only section
  }

  const handleCustomNotesChange = (value: string) => {
    onReceiptSettingsChange({
      ...receiptSettings,
      custom_notes: value || null,
    });
  };

  const handleShowStampChange = (value: boolean) => {
    onReceiptSettingsChange({
      ...receiptSettings,
      show_stamp: value,
    });
  };

  return (
    <div className="space-y-6">
      {/* Custom Notes */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          收據備註
        </label>
        <textarea
          value={receiptSettings.custom_notes || ''}
          onChange={(e) => handleCustomNotesChange(e.target.value)}
          className="input min-h-[120px] resize-vertical"
          placeholder="例如：&#10;地址：台北市信義區信義路五段7號&#10;電話：02-1234-5678&#10;統一編號：12345678"
          maxLength={2000}
          rows={6}
        />
      </div>

      {/* Show Stamp Toggle */}
      <div>
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={receiptSettings.show_stamp || false}
            onChange={(e) => handleShowStampChange(e.target.checked)}
            className="mr-2"
          />
          <span className="text-sm font-medium text-gray-700">顯示收訖章</span>
        </label>
        <p className="text-sm text-gray-500 mt-1 ml-6">
          在收據上顯示收訖章，包含診所名稱及結帳日期
        </p>
      </div>
    </div>
  );
};

export default ReceiptSettings;



import React, { useState } from 'react';
import { ReceiptSettings as ReceiptSettingsType } from '../schemas/api';
import { InfoButton, InfoModal } from './shared';

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
  const [showCustomNotesModal, setShowCustomNotesModal] = useState(false);
  const [showStampModal, setShowStampModal] = useState(false);

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
        <div className="flex items-center gap-2 mb-2">
          <label className="block text-sm font-medium text-gray-700">
            收據備註
          </label>
          <InfoButton onClick={() => setShowCustomNotesModal(true)} />
        </div>
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
          <InfoButton onClick={() => setShowStampModal(true)} />
        </label>
        <p className="text-sm text-gray-500 mt-1 ml-6">
          在收據上顯示收訖章，包含診所名稱及結帳日期
        </p>
      </div>

      {/* Info Modals */}
      <InfoModal
        isOpen={showCustomNotesModal}
        onClose={() => setShowCustomNotesModal(false)}
        title="收據備註"
        ariaLabel="收據備註說明"
      >
        <p>此內容會顯示在每張收據的底部。常用於顯示診所地址、電話、統一編號等資訊。</p>
      </InfoModal>

      <InfoModal
        isOpen={showStampModal}
        onClose={() => setShowStampModal(false)}
        title="顯示收訖章"
        ariaLabel="顯示收訖章說明"
      >
        <p>啟用後，收據上會顯示收訖章，包含診所名稱和結帳日期。</p>
      </InfoModal>
    </div>
  );
};

export default ReceiptSettings;



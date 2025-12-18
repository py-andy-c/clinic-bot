import React, { useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { InfoButton, InfoModal } from './shared';
import { ReceiptPreviewModal } from './ReceiptPreviewModal';
import { FormField, FormTextarea } from './forms';
import { ReceiptsSettingsFormData } from '../pages/settings/SettingsReceiptsPage';

interface ReceiptSettingsProps {
  isClinicAdmin: boolean;
}

const ReceiptSettings: React.FC<ReceiptSettingsProps> = ({
  isClinicAdmin,
}) => {
  const [showCustomNotesModal, setShowCustomNotesModal] = useState(false);
  const [showStampModal, setShowStampModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  const { control, watch } = useFormContext<ReceiptsSettingsFormData>();
  const customNotes = watch('receipt_settings.custom_notes');
  const showStamp = watch('receipt_settings.show_stamp');

  if (!isClinicAdmin) {
    return null; // Admin-only section
  }

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
        <FormField name="receipt_settings.custom_notes">
          <FormTextarea
            name="receipt_settings.custom_notes"
            className="min-h-[120px]"
            placeholder="例如：&#10;地址：台北市信義區信義路五段7號&#10;電話：02-1234-5678&#10;統一編號：12345678"
            maxLength={2000}
            rows={6}
          />
        </FormField>
      </div>

      {/* Show Stamp Toggle */}
      <div className="pt-6 border-t border-gray-200 md:pt-0 md:border-t-0">
        <label className="flex items-center">
          <input
            type="checkbox"
            {...control.register('receipt_settings.show_stamp')}
            className="mr-2 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
          />
          <span className="text-sm font-medium text-gray-700">顯示收訖章</span>
          <InfoButton onClick={() => setShowStampModal(true)} />
        </label>
        <p className="text-sm text-gray-500 mt-1 ml-6">
          在收據上顯示收訖章，包含診所名稱及結帳日期
        </p>
      </div>

      {/* Preview Button */}
      <div className="pt-6 border-t border-gray-200">
        <button
          type="button"
          onClick={() => setShowPreviewModal(true)}
          className="btn-secondary w-full sm:w-auto"
        >
          <svg
            className="w-5 h-5 inline-block mr-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
            />
          </svg>
          預覽收據
        </button>
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

      {/* Receipt Preview Modal */}
      <ReceiptPreviewModal
        isOpen={showPreviewModal}
        onClose={() => setShowPreviewModal(false)}
        customNotes={customNotes ?? null}
        showStamp={showStamp || false}
      />
    </div>
  );
};

export default ReceiptSettings;

import React, { useState } from 'react';
import { BaseModal } from './shared/BaseModal';
import { ModalHeader, ModalBody } from './shared/ModalParts';
import { TimeInput } from './shared/TimeInput';

interface PractitionerNotificationTimeSettingsProps {
  notificationTime: string; // HH:MM format
  onNotificationTimeChange: (time: string) => void;
}

const PractitionerNotificationTimeSettings: React.FC<PractitionerNotificationTimeSettingsProps> = ({
  notificationTime,
  onNotificationTimeChange,
}) => {
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);

  return (
    <>
      <div className="mt-4">
        <div className="flex items-center gap-2 mb-2">
          <label className="block text-sm font-medium text-gray-700">
            明日預約提醒時間
          </label>
          <button
            type="button"
            onClick={() => setIsInfoModalOpen(true)}
            className="inline-flex items-center justify-center p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"
            aria-label="查看說明"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <TimeInput
          value={notificationTime}
          onChange={onNotificationTimeChange}
          className="w-full max-w-xs"
        />
      </div>

      {isInfoModalOpen && (
        <BaseModal
          onClose={() => setIsInfoModalOpen(false)}
          aria-label="明日預約提醒時間說明"
         
        >
          <ModalHeader title="明日預約提醒時間" showClose onClose={() => setIsInfoModalOpen(false)} />
          <ModalBody>
            <div className="text-sm text-gray-700 space-y-2">
              <p><strong>即時通知：</strong>當有預約被自動指派給您時，系統會立即發送通知，讓您能夠即時處理。</p>
              <p><strong>定時通知：</strong>系統將在您設定的時間統一發送當天的預約提醒，幫助您做好準備。</p>
              <p>您可以在「我的預約」頁面查看所有需要處理的預約。</p>
            </div>
          </ModalBody>
        </BaseModal>
      )}
    </>
  );
};

export default PractitionerNotificationTimeSettings;


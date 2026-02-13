import React, { useState } from 'react';
import { BaseModal } from './shared/BaseModal';
import { ModalHeader, ModalBody } from './shared/ModalParts';
import { TimeInput } from './shared/TimeInput';

interface PractitionerNotificationTimeSettingsProps {
  notificationTime: string; // HH:MM format
  reminderDaysAhead: number;
  onNotificationTimeChange: (time: string) => void;
  onReminderDaysAheadChange: (days: number) => void;
}

const PractitionerNotificationTimeSettings: React.FC<PractitionerNotificationTimeSettingsProps> = ({
  notificationTime,
  reminderDaysAhead,
  onNotificationTimeChange,
  onReminderDaysAheadChange,
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

      <div className="mt-4">
        <div className="flex items-center gap-2 mb-2">
          <label className="block text-sm font-medium text-gray-700">
            預約提醒天數
          </label>
        </div>
        <p className="text-xs text-gray-500 mb-2">
          設定每日預約提醒中要包含未來幾天的預約資訊（1-14 天）。
        </p>
        <input
          type="number"
          min="1"
          max="14"
          value={reminderDaysAhead}
          onChange={(e) => {
            const value = parseInt(e.target.value, 10);
            if (!isNaN(value)) {
              onReminderDaysAheadChange(Math.min(14, Math.max(1, value)));
            }
          }}
          className="block w-full max-w-[120px] rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
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


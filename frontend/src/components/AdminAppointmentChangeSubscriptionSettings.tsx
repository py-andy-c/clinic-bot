import React, { useState } from 'react';
import { BaseModal } from './shared/BaseModal';

interface AdminAppointmentChangeSubscriptionSettingsProps {
  subscribed: boolean;
  onToggle: (enabled: boolean) => void;
}

const AdminAppointmentChangeSubscriptionSettings: React.FC<AdminAppointmentChangeSubscriptionSettingsProps> = ({
  subscribed,
  onToggle,
}) => {
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);

  return (
    <>
      <div className="mt-4">
        <div className="flex items-center gap-2 mb-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={subscribed}
              onChange={(e) => onToggle(e.target.checked)}
              className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-gray-700">
              訂閱預約變更通知
            </span>
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
        <p className="text-xs text-gray-500 ml-6">
          當診所內任何治療師的預約發生變更時（新預約、取消、編輯或重新安排），您將收到即時通知
        </p>
      </div>

      {isInfoModalOpen && (
        <BaseModal
          onClose={() => setIsInfoModalOpen(false)}
          aria-label="預約變更通知說明"
        >
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">預約變更通知</h3>
              <div className="text-sm text-gray-700 space-y-2">
                <p>當您啟用此功能時，系統會在以下情況發送通知：</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>新預約：當預約被手動指派給任何治療師時（不包含自動指派的預約）</li>
                  <li>取消預約：當預約被取消時（由病患或診所取消）</li>
                  <li>編輯/重新安排：當預約時間或治療師變更時</li>
                </ul>
                <p className="mt-2">
                  <strong>注意：</strong>自動指派的預約不會觸發此通知，它們由「待審核預約提醒」系統處理。
                </p>
              </div>
            </div>
          </div>
        </BaseModal>
      )}
    </>
  );
};

export default AdminAppointmentChangeSubscriptionSettings;


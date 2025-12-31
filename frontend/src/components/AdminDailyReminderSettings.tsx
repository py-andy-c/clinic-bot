import React, { useState } from 'react';
import { BaseModal } from './shared/BaseModal';
import { TimeInput } from './shared/TimeInput';

interface AdminDailyReminderSettingsProps {
  reminderTime: string; // HH:MM format
  onTimeChange: (time: string) => void;
}

const AdminDailyReminderSettings: React.FC<AdminDailyReminderSettingsProps> = ({
  reminderTime,
  onTimeChange,
}) => {
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);

  return (
    <>
      <div className="mt-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-medium text-gray-700">
            每日預約總覽提醒
          </span>
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
        <div className="ml-6 mt-2">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            提醒時間
          </label>
          <TimeInput
            value={reminderTime}
            onChange={onTimeChange}
            className="w-full max-w-xs"
          />
          <p className="text-xs text-gray-500 mt-1">
            系統將在您設定的時間發送隔天所有治療師的預約總覽
          </p>
        </div>
      </div>

      {isInfoModalOpen && (
        <BaseModal
          onClose={() => setIsInfoModalOpen(false)}
          aria-label="每日預約總覽提醒說明"
        >
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">每日預約總覽提醒</h3>
              <div className="text-sm text-gray-700 space-y-2">
                <p>系統將在您設定的時間發送隔天所有治療師的預約總覽，幫助您提前了解診所的預約狀況。</p>
                <p>通知內容包括：</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>所有治療師的預約列表</li>
                  <li>每個預約的時間、病患姓名和類型</li>
                  <li>按治療師分組顯示</li>
                </ul>
                <p className="mt-2">
                  <strong>注意：</strong>如果隔天沒有預約，系統將不會發送通知。
                </p>
              </div>
            </div>
          </div>
        </BaseModal>
      )}
    </>
  );
};

export default AdminDailyReminderSettings;


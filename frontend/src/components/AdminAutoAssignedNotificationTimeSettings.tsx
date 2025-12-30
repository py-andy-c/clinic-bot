import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { BaseModal } from './shared/BaseModal';
import { TimeInput } from './shared/TimeInput';

interface AdminAutoAssignedNotificationTimeSettingsProps {
  notificationTime: string; // HH:MM format
  notificationMode: 'immediate' | 'scheduled'; // New field
  onNotificationTimeChange: (time: string) => void;
  onNotificationModeChange: (mode: 'immediate' | 'scheduled') => void;
}

const AdminAutoAssignedNotificationTimeSettings: React.FC<AdminAutoAssignedNotificationTimeSettingsProps> = ({
  notificationTime,
  notificationMode,
  onNotificationTimeChange,
  onNotificationModeChange,
}) => {
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);

  return (
    <>
      <div className="mt-4">
        <div className="flex items-center gap-2 mb-2">
          <label className="block text-sm font-medium text-gray-700">
            待審核預約提醒
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
        
        {/* Notification Mode Selection */}
        <div className="mb-3">
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="notificationMode"
                value="immediate"
                checked={notificationMode === 'immediate'}
                onChange={(e) => onNotificationModeChange(e.target.value as 'immediate' | 'scheduled')}
                className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">即時通知</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="notificationMode"
                value="scheduled"
                checked={notificationMode === 'scheduled'}
                onChange={(e) => onNotificationModeChange(e.target.value as 'immediate' | 'scheduled')}
                className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">定時通知</span>
            </label>
          </div>
          <p className="text-xs text-gray-500 mt-1 ml-6">
            {notificationMode === 'immediate' 
              ? '當有預約被自動指派時，立即發送通知'
              : '在設定的時間統一發送待審核的預約資訊'}
          </p>
        </div>

        {/* Time Input (only shown for scheduled mode) */}
        {notificationMode === 'scheduled' && (
          <div className="ml-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              提醒時間
            </label>
            <TimeInput
              value={notificationTime}
              onChange={onNotificationTimeChange}
              className="w-full max-w-xs"
            />
          </div>
        )}
      </div>

      {isInfoModalOpen && (
        <BaseModal
          onClose={() => setIsInfoModalOpen(false)}
          aria-label="待審核預約提醒說明"
        >
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">待審核預約提醒</h3>
              <div className="text-sm text-gray-700 space-y-2">
                <p><strong>即時通知：</strong>當有預約被自動指派時，系統會立即發送通知，讓您能夠即時處理。</p>
                <p><strong>定時通知：</strong>系統將在您設定的時間統一發送待審核的預約資訊，提醒您進行確認或重新指派。</p>
                <p>
                  您可以在{' '}
                  <Link
                    to="/admin/clinic/pending-review-appointments"
                    onClick={() => setIsInfoModalOpen(false)}
                    className="text-blue-600 hover:text-blue-800 underline"
                  >
                    待審核預約
                  </Link>
                  {' '}頁面查看和管理這些預約。
                </p>
              </div>
            </div>
          </div>
        </BaseModal>
      )}
    </>
  );
};

export default AdminAutoAssignedNotificationTimeSettings;


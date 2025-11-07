import React from 'react';
import { ChatSettings as ChatSettingsType } from '../schemas/api';

interface ChatSettingsProps {
  chatSettings: ChatSettingsType;
  onChatSettingsChange: (chatSettings: ChatSettingsType) => void;
  showSaveButton?: boolean;
  onSave?: () => void;
  saving?: boolean;
  isClinicAdmin?: boolean;
}

const ChatSettings: React.FC<ChatSettingsProps> = ({
  chatSettings,
  onChatSettingsChange,
  showSaveButton = false,
  onSave,
  saving = false,
  isClinicAdmin = false,
}) => {
  const handleToggle = (enabled: boolean) => {
    onChatSettingsChange({
      ...chatSettings,
      chat_enabled: enabled,
    });
  };

  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-gray-900">AI 聊天功能</h2>
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

      <div className="space-y-6 max-w-2xl">
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-900 mb-1">
              啟用 AI 聊天功能
            </label>
            <p className="text-sm text-gray-600">
              當病患透過 LINE 發送訊息時，AI 會自動回覆病患的問題
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={chatSettings.chat_enabled}
              onChange={(e) => handleToggle(e.target.checked)}
              disabled={!isClinicAdmin}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"></div>
          </label>
        </div>
      </div>
    </div>
  );
};

export default ChatSettings;


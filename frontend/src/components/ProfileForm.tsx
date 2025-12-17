import React, { useState } from 'react';
import { User } from '../types';
import { InfoButton, InfoModal } from './shared';

interface ProfileFormProps {
  profile: User | null;
  fullName: string;
  title: string;
  onFullNameChange: (name: string) => void;
  onTitleChange: (title: string) => void;
  showSaveButton?: boolean;
  onSave?: () => void;
  saving?: boolean;
}

const ProfileForm: React.FC<ProfileFormProps> = ({
  profile,
  fullName,
  title,
  onFullNameChange,
  onTitleChange,
  showSaveButton = false,
  onSave,
  saving = false,
}) => {
  const [showTitleInfoModal, setShowTitleInfoModal] = useState(false);

  if (!profile) return null;

  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-gray-900">基本資訊</h2>
        {showSaveButton && onSave && (
          <button
            onClick={onSave}
            disabled={saving}
            className="btn-primary"
          >
            {saving ? '儲存中...' : '儲存更變'}
          </button>
        )}
      </div>
      
      <div className="space-y-4">
        {/* Email (Read-only) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            電子郵件
          </label>
          <div className="relative">
            <input
              type="email"
              value={profile.email}
              disabled
              className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500 cursor-not-allowed"
            />
            <div className="absolute inset-y-0 right-0 flex items-center pr-3">
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                無法修改
              </span>
            </div>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            電子郵件與您的 Google 帳號綁定，無法修改
          </p>
        </div>

        {/* Full Name (Editable) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            姓名 *
          </label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => onFullNameChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            placeholder="請輸入您的姓名"
          />
        </div>

        {/* Title (Editable) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            <span className="flex items-center gap-2">
              稱謂
              <InfoButton 
                onClick={() => setShowTitleInfoModal(true)} 
                ariaLabel="查看稱謂說明"
              />
            </span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            maxLength={50}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            placeholder="例如：治療師、醫師、復健師"
          />
        </div>
      </div>

      {/* Title Info Modal */}
      {showTitleInfoModal && (
        <InfoModal
          isOpen={showTitleInfoModal}
          onClose={() => setShowTitleInfoModal(false)}
          title="稱謂說明"
          ariaLabel="稱謂說明"
        >
          <p><strong>內部顯示：</strong>行事曆、診所內部系統等顯示時，只會顯示姓名，不會顯示稱謂。</p>
          <p><strong>外部顯示：</strong>收據、LINE 訊息、預約系統 等對外顯示時，會顯示「姓名 + 稱謂」，例如「王小明治療師」。</p>
          <p>如果未設定稱謂，外部顯示時只會顯示姓名。</p>
        </InfoModal>
      )}
    </div>
  );
};

export default ProfileForm;

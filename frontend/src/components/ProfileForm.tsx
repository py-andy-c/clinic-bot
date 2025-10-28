import React from 'react';
import { User } from '../types';

interface ProfileFormProps {
  profile: User | null;
  fullName: string;
  onFullNameChange: (name: string) => void;
}

const ProfileForm: React.FC<ProfileFormProps> = ({
  profile,
  fullName,
  onFullNameChange,
}) => {
  if (!profile) return null;

  return (
    <div className="mb-8">
      <h2 className="text-xl font-semibold text-gray-900 mb-6">基本資訊</h2>
      
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
      </div>
    </div>
  );
};

export default ProfileForm;

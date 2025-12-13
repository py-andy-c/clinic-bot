import React, { useState } from 'react';
import { ClinicInfoSettings as ClinicInfoSettingsType } from '../schemas/api';
import { InfoButton, InfoModal } from './shared';

interface ClinicInfoSettingsProps {
  clinicInfoSettings: ClinicInfoSettingsType;
  clinicName: string;
  onClinicInfoSettingsChange: (clinicInfoSettings: ClinicInfoSettingsType) => void;
  isClinicAdmin?: boolean;
}

const ClinicInfoSettings: React.FC<ClinicInfoSettingsProps> = ({
  clinicInfoSettings,
  clinicName,
  onClinicInfoSettingsChange,
  isClinicAdmin = false,
}) => {
  const [showDisplayNameModal, setShowDisplayNameModal] = useState(false);

  const handleFieldChange = (field: keyof ClinicInfoSettingsType, value: string) => {
    onClinicInfoSettingsChange({
      ...clinicInfoSettings,
      [field]: value || null, // Convert empty string to null
    });
  };

  return (
    <div className="space-y-6 max-w-2xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <label className="block text-sm font-medium text-gray-700">
              顯示名稱
            </label>
            <InfoButton onClick={() => setShowDisplayNameModal(true)} />
          </div>
          <input
            type="text"
            value={clinicInfoSettings.display_name || ''}
            onChange={(e) => handleFieldChange('display_name', e.target.value)}
            className="input"
            placeholder={clinicName}
            disabled={!isClinicAdmin}
          />
          <p className="text-sm text-gray-500 mt-1">
            若未設定，將使用診所名稱「{clinicName}」
          </p>
        </div>

        <div className="pt-6 border-t border-gray-200 md:pt-0 md:border-t-0">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            地址
          </label>
          <input
            type="text"
            value={clinicInfoSettings.address || ''}
            onChange={(e) => handleFieldChange('address', e.target.value)}
            className="input"
            placeholder="例如：台北市中山區中山北路一段123號"
            disabled={!isClinicAdmin}
          />
        </div>

        <div className="pt-6 border-t border-gray-200 md:pt-0 md:border-t-0">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            電話
          </label>
          <input
            type="tel"
            value={clinicInfoSettings.phone_number || ''}
            onChange={(e) => handleFieldChange('phone_number', e.target.value)}
            className="input"
            placeholder="例如：02-1234-5678"
            disabled={!isClinicAdmin}
          />
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <div className="text-sm text-blue-700">
                <p>地址及電話資訊將顯示在</p>
                <ul className="list-disc list-inside mt-1 space-y-1">
                  <li>病患端 Google Calendar 等行事曆中的預約事件</li>
                  <li>發送給病患的LINE預約提醒訊息</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Info Modal */}
        <InfoModal
          isOpen={showDisplayNameModal}
          onClose={() => setShowDisplayNameModal(false)}
          title="顯示名稱"
          ariaLabel="顯示名稱說明"
        >
          <p>此名稱會顯示在病患的 LINE 訊息、預約提醒和通知中。若未設定，系統將使用診所名稱。此設定不影響診所內部系統顯示的名稱。</p>
        </InfoModal>
    </div>
  );
};

export default ClinicInfoSettings;

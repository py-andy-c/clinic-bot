import React from 'react';
import { ClinicInfoSettings as ClinicInfoSettingsType } from '../schemas/api';

interface ClinicInfoSettingsProps {
  clinicInfoSettings: ClinicInfoSettingsType;
  clinicName: string;
  onClinicInfoSettingsChange: (clinicInfoSettings: ClinicInfoSettingsType) => void;
  showSaveButton?: boolean;
  onSave?: () => void;
  saving?: boolean;
  isClinicAdmin?: boolean;
}

const ClinicInfoSettings: React.FC<ClinicInfoSettingsProps> = ({
  clinicInfoSettings,
  clinicName,
  onClinicInfoSettingsChange,
  showSaveButton = false,
  onSave,
  saving = false,
  isClinicAdmin = false,
}) => {
  const handleFieldChange = (field: keyof ClinicInfoSettingsType, value: string) => {
    onClinicInfoSettingsChange({
      ...clinicInfoSettings,
      [field]: value || null, // Convert empty string to null
    });
  };

  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-gray-900">診所資訊</h2>
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
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            顯示名稱
          </label>
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

        <div>
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

        <div>
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
      </div>
    </div>
  );
};

export default ClinicInfoSettings;

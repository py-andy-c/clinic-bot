import React, { useState } from 'react';
import { InfoButton, InfoModal } from './shared';
import { FormField, FormInput } from './forms';

interface ClinicInfoSettingsProps {
  clinicName: string;
  isClinicAdmin?: boolean;
}

const ClinicInfoSettings: React.FC<ClinicInfoSettingsProps> = ({
  clinicName,
  isClinicAdmin = false,
}) => {
  const [showDisplayNameModal, setShowDisplayNameModal] = useState(false);

  return (
    <div className="space-y-6 max-w-2xl">
      <FormField
        name="display_name"
        label="顯示名稱"
        description={`若未設定，將使用診所名稱「${clinicName}」`}
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <FormInput
              name="display_name"
              placeholder={clinicName}
              disabled={!isClinicAdmin}
            />
            <InfoButton onClick={() => setShowDisplayNameModal(true)} />
          </div>
        </div>
      </FormField>

      <div className="pt-6 border-t border-gray-200 md:pt-0 md:border-t-0">
        <FormField name="address" label="地址">
          <FormInput
            name="address"
            placeholder="例如：台北市中山區中山北路一段123號"
            disabled={!isClinicAdmin}
          />
        </FormField>
      </div>

      <div className="pt-6 border-t border-gray-200 md:pt-0 md:border-t-0">
        <FormField name="phone_number" label="電話">
          <FormInput
            name="phone_number"
            type="tel"
            placeholder="例如：02-1234-5678"
            disabled={!isClinicAdmin}
          />
        </FormField>
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

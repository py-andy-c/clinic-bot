import React from 'react';

interface ClinicReminderSettingsProps {
  reminderHoursBefore: string | number;
  onReminderHoursChange: (value: string) => void;
  showSaveButton?: boolean;
  onSave?: () => void;
  saving?: boolean;
  isClinicAdmin?: boolean;
}

const ClinicReminderSettings: React.FC<ClinicReminderSettingsProps> = ({
  reminderHoursBefore,
  onReminderHoursChange,
  showSaveButton = false,
  onSave,
  saving = false,
  isClinicAdmin = false,
}) => {
  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-gray-900">提醒設定</h2>
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

      <div className="max-w-md">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          預約前幾小時發送提醒
        </label>
        <input
          type="number"
          value={reminderHoursBefore}
          onChange={(e) => onReminderHoursChange(e.target.value)}
          className="input"
          min="1"
          max="168"
          disabled={!isClinicAdmin}
        />
        <p className="text-sm text-gray-500 mt-1">
          預設為 24 小時前發送提醒
        </p>
      </div>
    </div>
  );
};

export default ClinicReminderSettings;

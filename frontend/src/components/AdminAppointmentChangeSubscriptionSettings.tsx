import React from 'react';

interface AdminAppointmentChangeSubscriptionSettingsProps {
  subscribed: boolean;
  onToggle: (enabled: boolean) => void;
}

const AdminAppointmentChangeSubscriptionSettings: React.FC<AdminAppointmentChangeSubscriptionSettingsProps> = ({
  subscribed,
  onToggle,
}) => {
  return (
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
      </div>
      <p className="text-xs text-gray-500 ml-6">
        當診所內任何治療師的預約發生變更時（新預約、取消、編輯或重新安排），您將收到即時通知
      </p>
    </div>
  );
};

export default AdminAppointmentChangeSubscriptionSettings;


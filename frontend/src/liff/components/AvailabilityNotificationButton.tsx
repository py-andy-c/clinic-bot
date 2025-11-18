import React from 'react';
import { useNavigate } from 'react-router-dom';
import { preserveQueryParams } from '../../utils/urlUtils';
import { useAppointmentStore } from '../../stores/appointmentStore';

interface AvailabilityNotificationButtonProps {
  /** Optional custom className for styling */
  className?: string;
  /** Whether to use compact layout */
  compact?: boolean;
}

/**
 * Shared component for redirecting users to the availability notification setup page.
 * Pre-fills the current appointment type and practitioner selection.
 */
const AvailabilityNotificationButton: React.FC<AvailabilityNotificationButtonProps> = ({
  className = '',
  compact = false,
}) => {
  const navigate = useNavigate();
  const { appointmentTypeId, practitionerId } = useAppointmentStore();

  const handleClick = () => {
    const params: Record<string, string> = {
      mode: 'notifications',
      sub_mode: 'add',
    };
    if (appointmentTypeId) {
      params.appointment_type_id = appointmentTypeId.toString();
    }
    if (practitionerId !== null && practitionerId !== undefined) {
      params.practitioner_id = practitionerId.toString();
    }
    const newUrl = preserveQueryParams('/liff', params);
    navigate(newUrl);
  };

  if (compact) {
    return (
      <button
        onClick={handleClick}
        className={`px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors ${className}`}
      >
        設定空位提醒
      </button>
    );
  }

  return (
    <div className={`p-4 bg-blue-50 border border-blue-200 rounded-lg ${className}`}>
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="ml-3 flex-1">
          <h4 className="text-sm font-medium text-blue-900 mb-1">
            找不到合適時間？
          </h4>
          <p className="text-sm text-blue-700 mb-3">
            設定空位提醒，當有可用時段時我們會透過 LINE 通知您
          </p>
          <button
            onClick={handleClick}
            className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            設定空位提醒
          </button>
        </div>
      </div>
    </div>
  );
};

export default AvailabilityNotificationButton;


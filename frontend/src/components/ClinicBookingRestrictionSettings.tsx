import React from 'react';
import { BookingRestrictionSettings } from '../schemas/api';

interface ClinicBookingRestrictionSettingsProps {
  bookingRestrictionSettings: BookingRestrictionSettings;
  onBookingRestrictionSettingsChange: (settings: BookingRestrictionSettings) => void;
  showSaveButton?: boolean;
  onSave?: () => void;
  saving?: boolean;
  isClinicAdmin?: boolean;
}

const ClinicBookingRestrictionSettings: React.FC<ClinicBookingRestrictionSettingsProps> = ({
  bookingRestrictionSettings,
  onBookingRestrictionSettingsChange,
  showSaveButton = false,
  onSave,
  saving = false,
  isClinicAdmin = false,
}) => {
  const handleRestrictionTypeChange = (restrictionType: string) => {
    onBookingRestrictionSettingsChange({
      ...bookingRestrictionSettings,
      booking_restriction_type: restrictionType,
    });
  };

  const handleMinimumHoursChange = (hours: string) => {
    const numHours = parseInt(hours) || 24;
    onBookingRestrictionSettingsChange({
      ...bookingRestrictionSettings,
      minimum_booking_hours_ahead: numHours,
    });
  };

  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-gray-900">預約限制設定</h2>
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

      <div className="space-y-6">
        <div>
          <div className="space-y-3">
            <div className="flex items-center">
              <input
                id="same_day_disallowed"
                name="restriction_type"
                type="radio"
                checked={bookingRestrictionSettings.booking_restriction_type === 'same_day_disallowed'}
                onChange={() => handleRestrictionTypeChange('same_day_disallowed')}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                disabled={!isClinicAdmin}
              />
              <label htmlFor="same_day_disallowed" className="ml-3 block text-sm font-medium text-gray-700">
                不允許同一天預約
              </label>
            </div>
            <p className="text-sm text-gray-500 ml-7">
              患者只能預約明天及之後的時段
            </p>

            <div className="flex items-center">
              <input
                id="minimum_hours_required"
                name="restriction_type"
                type="radio"
                checked={bookingRestrictionSettings.booking_restriction_type === 'minimum_hours_required'}
                onChange={() => handleRestrictionTypeChange('minimum_hours_required')}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                disabled={!isClinicAdmin}
              />
              <label htmlFor="minimum_hours_required" className="ml-3 block text-sm font-medium text-gray-700">
                預約前至少需幾小時
              </label>
            </div>

            {bookingRestrictionSettings.booking_restriction_type === 'minimum_hours_required' && (
              <div className="ml-7 max-w-xs">
                <input
                  type="number"
                  value={bookingRestrictionSettings.minimum_booking_hours_ahead}
                  onChange={(e) => handleMinimumHoursChange(e.target.value)}
                  className="input"
                  min="1"
                  max="168"
                  disabled={!isClinicAdmin}
                />
                <p className="text-sm text-gray-500 mt-1">
                  小時數（例如：4 表示至少提前 4 小時）
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClinicBookingRestrictionSettings;

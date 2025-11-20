import React, { useState, useRef } from 'react';
import { AppointmentType } from '../types';
import { BookingRestrictionSettings } from '../schemas/api';
import { InfoModal } from './shared/InfoModal';

interface ClinicAppointmentSettingsProps {
  appointmentTypes: AppointmentType[];
  appointmentTypeInstructions: string | null;
  bookingRestrictionSettings: BookingRestrictionSettings;
  requireBirthday: boolean;
  onAppointmentTypeInstructionsChange: (instructions: string | null) => void;
  onBookingRestrictionSettingsChange: (settings: BookingRestrictionSettings) => void;
  onRequireBirthdayChange: (value: boolean) => void;
  onAddType: () => void;
  onUpdateType: (index: number, field: keyof AppointmentType, value: string | number) => void;
  onRemoveType: (index: number) => Promise<void> | void;
  isClinicAdmin?: boolean;
}

const ClinicAppointmentSettings: React.FC<ClinicAppointmentSettingsProps> = ({
  appointmentTypes,
  appointmentTypeInstructions,
  bookingRestrictionSettings,
  requireBirthday,
  onAppointmentTypeInstructionsChange,
  onBookingRestrictionSettingsChange,
  onRequireBirthdayChange,
  onAddType,
  onUpdateType,
  onRemoveType,
  isClinicAdmin = false,
}) => {
  const handleInstructionsChange = (value: string) => {
    onAppointmentTypeInstructionsChange(value || null);
  };

  const handleRestrictionTypeChange = (restrictionType: string) => {
    onBookingRestrictionSettingsChange({
      ...bookingRestrictionSettings,
      booking_restriction_type: restrictionType,
    });
  };

  const handleMinimumHoursChange = (hours: string) => {
    onBookingRestrictionSettingsChange({
      ...bookingRestrictionSettings,
      minimum_booking_hours_ahead: hours,
    });
  };

  const handleStepSizeChange = (minutes: string) => {
    onBookingRestrictionSettingsChange({
      ...bookingRestrictionSettings,
      step_size_minutes: minutes,
    });
  };

  const handleMaxFutureAppointmentsChange = (value: string) => {
    onBookingRestrictionSettingsChange({
      ...bookingRestrictionSettings,
      max_future_appointments: value,
    });
  };

  const handleMaxBookingWindowDaysChange = (value: string) => {
    onBookingRestrictionSettingsChange({
      ...bookingRestrictionSettings,
      max_booking_window_days: value,
    });
  };

  const handleMinimumCancellationHoursChange = (value: string) => {
    onBookingRestrictionSettingsChange({
      ...bookingRestrictionSettings,
      minimum_cancellation_hours_before: value,
    });
  };

  const [showStepSizePopup, setShowStepSizePopup] = useState(false);
  const stepSizeButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="space-y-6">
        {/* 預約類型 */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="block text-sm font-medium text-gray-700">預約類型</label>
            {isClinicAdmin && (
              <button
                type="button"
                onClick={onAddType}
                className="btn-secondary text-sm"
              >
                新增類型
              </button>
            )}
          </div>

          <div className="space-y-4">
            {appointmentTypes.map((type, index) => (
              <div key={type.id} className="flex items-center space-x-4 p-4 border border-gray-200 rounded-lg">
                <div className="flex-[2]">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    類型名稱
                  </label>
                  <input
                    type="text"
                    value={type.name}
                    onChange={(e) => onUpdateType(index, 'name', e.target.value)}
                    className="input"
                    placeholder="例如：初診評估"
                    disabled={!isClinicAdmin}
                  />
                </div>

                <div className="w-24">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    時長 (分鐘)
                  </label>
                  <input
                    type="number"
                    value={type.duration_minutes}
                    onChange={(e) => {
                      const value = e.target.value;
                      onUpdateType(index, 'duration_minutes', value);
                    }}
                    className="input"
                    min="15"
                    max="480"
                    disabled={!isClinicAdmin}
                  />
                </div>

                {isClinicAdmin && (
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => onRemoveType(index)}
                      className="text-red-600 hover:text-red-800 p-2"
                      title="刪除"
                    >
                      🗑️
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 預約類型選擇指引 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            預約類型選擇指引
          </label>
          <div className="space-y-4 max-w-2xl">
            <div>
              <textarea
                value={appointmentTypeInstructions || ''}
                onChange={(e) => handleInstructionsChange(e.target.value)}
                className="input min-h-[120px] resize-vertical"
                placeholder={`例如：初診請一律選擇「初診評估」。
例如：服務項目細節請參考診所官網。`}
                disabled={!isClinicAdmin}
                rows={4}
              />
              <p className="text-sm text-gray-500 mt-1">
                病患在透過Line預約，選擇預約類別時，將會看到此指引
              </p>
            </div>
          </div>
        </div>

        {/* 預約限制 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            預約限制
          </label>
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
                    患者能預約明天及之後的時段
                  </label>
                </div>

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

        {/* 預約時間範圍 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            患者最多可預約多少天後的時段（天）
          </label>
          <div className="space-y-4 max-w-xs">
            <div>
              <input
                type="number"
                value={bookingRestrictionSettings.max_booking_window_days ?? 90}
                onChange={(e) => handleMaxBookingWindowDaysChange(e.target.value)}
                className="input"
                min="1"
                max="365"
                disabled={!isClinicAdmin}
              />
            </div>
          </div>
        </div>

        {/* 患者未來預約上限 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            患者未來預約上限（次）
          </label>
          <div className="space-y-4 max-w-xs">
            <div>
              <input
                type="number"
                value={bookingRestrictionSettings.max_future_appointments ?? 3}
                onChange={(e) => handleMaxFutureAppointmentsChange(e.target.value)}
                className="input"
                min="1"
                max="100"
                disabled={!isClinicAdmin}
              />
              <p className="text-sm text-gray-500 mt-1">
                每位患者最多可同時擁有的未來預約數量
              </p>
            </div>
          </div>
        </div>

        {/* 可用時段生成間隔 */}
        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            <label className="block text-sm font-medium text-gray-700">
              預約起始時間間隔（分鐘）
            </label>
            <button
              ref={stepSizeButtonRef}
              type="button"
              onClick={() => setShowStepSizePopup(!showStepSizePopup)}
              className="text-blue-600 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded-full p-1"
              title="預約起始時間間隔說明"
              aria-label="顯示預約起始時間間隔說明"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </button>
            <InfoModal
              isOpen={showStepSizePopup}
              onClose={() => setShowStepSizePopup(false)}
              buttonRef={stepSizeButtonRef}
            >
              <p className="font-medium">範例說明（假設預約時長為 60 分鐘）：</p>
              <ul className="list-disc list-inside space-y-1 ml-2 text-xs">
                <li><strong>設定為 30 分鐘：</strong>病患可選擇 09:00-10:00、09:30-10:30、10:00-11:00 等時段</li>
                <li><strong>設定為 15 分鐘：</strong>病患可選擇 09:00-10:00、09:15-10:15、09:30-10:30 等更細的時段</li>
              </ul>
            </InfoModal>
          </div>
          <div className="space-y-4 max-w-xs">
            <div>
              <input
                type="number"
                value={bookingRestrictionSettings.step_size_minutes ?? 30}
                onChange={(e) => handleStepSizeChange(e.target.value)}
                className="input"
                min="5"
                max="60"
                disabled={!isClinicAdmin}
              />
            </div>
          </div>
        </div>

        {/* 取消預約限制 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            取消預約限制
          </label>
          <div className="space-y-4 max-w-xs">
            <div>
              <input
                type="number"
                value={bookingRestrictionSettings.minimum_cancellation_hours_before ?? 24}
                onChange={(e) => handleMinimumCancellationHoursChange(e.target.value)}
                className="input"
                min="1"
                max="168"
                disabled={!isClinicAdmin}
              />
              <p className="text-sm text-gray-500 mt-1">
                患者必須在預約前至少幾小時取消（診所取消不受此限制）
              </p>
            </div>
          </div>
        </div>

        {/* 要求填寫生日 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            要求填寫生日
          </label>
          <div className="flex items-center justify-between max-w-2xl">
            <div>
              <p className="text-sm text-gray-500">
                啟用後，病患註冊時必須填寫生日
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={requireBirthday || false}
                onChange={(e) => onRequireBirthdayChange(e.target.checked)}
                className="sr-only peer"
                disabled={!isClinicAdmin}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"></div>
            </label>
          </div>
        </div>
    </div>
  );
};

export default ClinicAppointmentSettings;


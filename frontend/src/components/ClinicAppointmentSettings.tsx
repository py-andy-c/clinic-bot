import React, { useState } from 'react';
import { AppointmentType } from '../types';
import { BookingRestrictionSettings } from '../schemas/api';
import { BaseModal } from './shared/BaseModal';

interface ClinicAppointmentSettingsProps {
  appointmentTypes: AppointmentType[];
  appointmentTypeInstructions: string | null;
  appointmentNotesInstructions: string | null;
  bookingRestrictionSettings: BookingRestrictionSettings;
  requireBirthday: boolean;
  onAppointmentTypeInstructionsChange: (instructions: string | null) => void;
  onAppointmentNotesInstructionsChange: (instructions: string | null) => void;
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
  appointmentNotesInstructions,
  bookingRestrictionSettings,
  requireBirthday,
  onAppointmentTypeInstructionsChange,
  onAppointmentNotesInstructionsChange,
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

  const handleNotesInstructionsChange = (value: string) => {
    onAppointmentNotesInstructionsChange(value || null);
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

  const handleAllowPatientDeletionChange = (value: boolean) => {
    onBookingRestrictionSettingsChange({
      ...bookingRestrictionSettings,
      allow_patient_deletion: value,
    });
  };

  const [showStepSizePopup, setShowStepSizePopup] = useState(false);

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

        {/* 備註填寫指引 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            備註填寫指引
          </label>
          <div className="space-y-4 max-w-2xl">
            <div>
              <textarea
                value={appointmentNotesInstructions || ''}
                onChange={(e) => handleNotesInstructionsChange(e.target.value)}
                className="input min-h-[120px] resize-vertical"
                placeholder={`例如：若您是第一次來診所，請在備註中回答以下問題：
1. 主要症狀或問題
2. 症狀持續時間
3. 是否有相關病史`}
                disabled={!isClinicAdmin}
                rows={4}
              />
              <p className="text-sm text-gray-500 mt-1">
                病患在透過Line預約，填寫備註時，將會看到此指引
              </p>
            </div>
          </div>
        </div>

        {/* 預約限制 */}
        <div>
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                預約前至少需幾小時
              </label>
              <div className="max-w-xs">
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
              type="button"
              onClick={() => setShowStepSizePopup(true)}
              className="inline-flex items-center justify-center p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"
              aria-label="查看說明"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </button>
            {showStepSizePopup && (
              <BaseModal
                onClose={() => setShowStepSizePopup(false)}
                aria-label="預約起始時間間隔說明"
              >
                <div className="flex items-start">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3 flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">預約起始時間間隔</h3>
                    <div className="text-sm text-gray-700 space-y-2">
                      <p className="font-medium">範例說明（假設預約時長為 60 分鐘）：</p>
                      <ul className="list-disc list-inside space-y-1 ml-2 text-xs">
                        <li><strong>設定為 30 分鐘：</strong>病患可選擇 09:00-10:00、09:30-10:30、10:00-11:00 等時段</li>
                        <li><strong>設定為 15 分鐘：</strong>病患可選擇 09:00-10:00、09:15-10:15、09:30-10:30 等更細的時段</li>
                      </ul>
                    </div>
                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setShowStepSizePopup(false)}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                      >
                        關閉
                      </button>
                    </div>
                  </div>
                </div>
              </BaseModal>
            )}
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

        {/* 允許病患自行取消預約 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            允許病患自行取消預約
          </label>
          <div className="flex items-center justify-between max-w-2xl">
            <div>
              <p className="text-sm text-gray-500">
                啟用後，病患可以自行取消預約。停用後，病患只能修改預約時間，無法取消。
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={bookingRestrictionSettings.allow_patient_deletion ?? true}
                onChange={(e) => handleAllowPatientDeletionChange(e.target.checked)}
                className="sr-only peer"
                disabled={!isClinicAdmin}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"></div>
            </label>
          </div>
        </div>

        {/* 預約取消/修改限制 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {bookingRestrictionSettings.allow_patient_deletion !== false
              ? "預約取消/修改限制"
              : "預約修改限制"}
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
                {bookingRestrictionSettings.allow_patient_deletion !== false
                  ? "患者必須在預約前至少幾小時取消或修改（診所取消不受此限制）"
                  : "患者必須在預約前至少幾小時修改（診所取消不受此限制）"}
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


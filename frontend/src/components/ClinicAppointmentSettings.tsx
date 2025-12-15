import React, { useState } from 'react';
import { BookingRestrictionSettings } from '../schemas/api';
import { BaseModal } from './shared/BaseModal';
import { InfoButton, InfoModal } from './shared';
import { preventScrollWheelChange } from '../utils/inputUtils';

interface PractitionerBookingSetting {
  id: number;
  full_name: string;
  patient_booking_allowed: boolean;
}

interface ClinicAppointmentSettingsProps {
  appointmentTypeInstructions: string | null;
  appointmentNotesInstructions: string | null;
  bookingRestrictionSettings: BookingRestrictionSettings;
  requireBirthday: boolean;
  onAppointmentTypeInstructionsChange: (instructions: string | null) => void;
  onAppointmentNotesInstructionsChange: (instructions: string | null) => void;
  onBookingRestrictionSettingsChange: (settings: BookingRestrictionSettings) => void;
  onRequireBirthdayChange: (value: boolean) => void;
  isClinicAdmin?: boolean;
  practitioners?: PractitionerBookingSetting[];
  onPractitionerBookingSettingChange?: (practitionerId: number, patient_booking_allowed: boolean) => void;
}

const ClinicAppointmentSettings: React.FC<ClinicAppointmentSettingsProps> = ({
  appointmentTypeInstructions,
  appointmentNotesInstructions,
  bookingRestrictionSettings,
  requireBirthday,
  onAppointmentTypeInstructionsChange,
  onAppointmentNotesInstructionsChange,
  onBookingRestrictionSettingsChange,
  onRequireBirthdayChange,
  isClinicAdmin = false,
  practitioners = [],
  onPractitionerBookingSettingChange,
}) => {
  const handleInstructionsChange = (value: string) => {
    onAppointmentTypeInstructionsChange(value || null);
  };

  const handleNotesInstructionsChange = (value: string) => {
    onAppointmentNotesInstructionsChange(value || null);
  };

  const handleBookingRestrictionTypeChange = (type: string) => {
    onBookingRestrictionSettingsChange({
      ...bookingRestrictionSettings,
      booking_restriction_type: type,
    });
  };

  const handleMinimumHoursChange = (hours: string) => {
    onBookingRestrictionSettingsChange({
      ...bookingRestrictionSettings,
      minimum_booking_hours_ahead: hours,
    });
  };

  // Get current deadline value for dropdown (format: "前一天_08:00" or "當天_08:00")
  const getDeadlineValue = (): string => {
    const deadlineTime = bookingRestrictionSettings.deadline_time_day_before || '08:00';
    const onSameDay = bookingRestrictionSettings.deadline_on_same_day || false;
    
    // Extract hour from time string
    const parts = deadlineTime.split(':');
    if (parts.length === 2 && parts[0]) {
      const hour = parseInt(parts[0], 10);
      if (!isNaN(hour) && hour >= 0 && hour <= 23) {
        const timeStr = `${String(hour).padStart(2, '0')}:00`;
        return onSameDay ? `當天_${timeStr}` : `前一天_${timeStr}`;
      }
    }
    return '前一天_08:00';
  };

  const handleDeadlineCombinedChange = (value: string) => {
    // Parse value like "前一天_08:00" or "當天_08:00"
    const [dayType, timeStr] = value.split('_');
    if (!dayType || !timeStr) {
      return;
    }
    
    const onSameDay = dayType === '當天';
    const time = timeStr; // Already in HH:00 format
    
    onBookingRestrictionSettingsChange({
      ...bookingRestrictionSettings,
      deadline_time_day_before: time,
      deadline_on_same_day: onSameDay,
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
  const [showRestrictionModeModal, setShowRestrictionModeModal] = useState(false);
  const [showMaxFutureAppointmentsModal, setShowMaxFutureAppointmentsModal] = useState(false);
  const [showAllowPatientDeletionModal, setShowAllowPatientDeletionModal] = useState(false);
  const [showCancellationLimitModal, setShowCancellationLimitModal] = useState(false);
  const [showRequireBirthdayModal, setShowRequireBirthdayModal] = useState(false);
  const [showPatientBookingModal, setShowPatientBookingModal] = useState(false);

  return (
    <div className="space-y-6">
        {/* 開放病患預約 (Read-only for non-admin users) */}
        {practitioners.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <label className="block text-sm font-medium text-gray-700">
                開放病患預約
              </label>
              <InfoButton onClick={() => setShowPatientBookingModal(true)} />
            </div>
            <div className="space-y-2">
              {practitioners.map((practitioner) => (
                <div key={practitioner.id} className="flex items-center">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={practitioner.patient_booking_allowed ?? true}
                      onChange={(e) => {
                        if (onPractitionerBookingSettingChange) {
                          onPractitionerBookingSettingChange(practitioner.id, e.target.checked);
                        }
                      }}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={!isClinicAdmin}
                    />
                    <span className="ml-3 text-sm text-gray-900">{practitioner.full_name}</span>
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Divider before next section */}
        {practitioners.length > 0 && (
          <div className="pt-6 border-t border-gray-200"></div>
        )}

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
        <div className="pt-6 border-t border-gray-200 md:pt-0 md:border-t-0">
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
        <div className="pt-6 border-t border-gray-200 md:pt-0 md:border-t-0">
          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <label className="block text-sm font-medium text-gray-700">
                  預約限制模式
                </label>
                <InfoButton onClick={() => setShowRestrictionModeModal(true)} />
              </div>
              <div className="space-y-4">
                <div>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="booking_restriction_type"
                      value="minimum_hours_required"
                      checked={bookingRestrictionSettings.booking_restriction_type === 'minimum_hours_required'}
                      onChange={(e) => handleBookingRestrictionTypeChange(e.target.value)}
                      disabled={!isClinicAdmin}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-700">至少提前 X 小時預約</span>
                  </label>
                  {bookingRestrictionSettings.booking_restriction_type === 'minimum_hours_required' && (
                    <div className="ml-6 mt-2">
                      <div className="max-w-xs">
                        <input
                          type="number"
                          value={bookingRestrictionSettings.minimum_booking_hours_ahead}
                          onChange={(e) => handleMinimumHoursChange(e.target.value)}
                          onWheel={preventScrollWheelChange}
                          className="input"
                          min="1"
                          max="168"
                          disabled={!isClinicAdmin}
                        />
                        <p className="text-sm text-gray-500 mt-1">
                          例如：4 表示至少提前 4 小時
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="booking_restriction_type"
                      value="deadline_time_day_before"
                      checked={bookingRestrictionSettings.booking_restriction_type === 'deadline_time_day_before'}
                      onChange={(e) => handleBookingRestrictionTypeChange(e.target.value)}
                      disabled={!isClinicAdmin}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-700">特定時間前預約</span>
                  </label>
                  {bookingRestrictionSettings.booking_restriction_type === 'deadline_time_day_before' && (
                    <div className="ml-6 mt-2">
                      <div className="max-w-xs">
                        <select
                          value={getDeadlineValue()}
                          onChange={(e) => handleDeadlineCombinedChange(e.target.value)}
                          className="input w-48"
                          disabled={!isClinicAdmin}
                        >
                          {/* 前一天 options: 5:00 to 23:00 */}
                          {Array.from({ length: 19 }, (_, i) => i + 5).map((h) => {
                            const timeStr = `${String(h).padStart(2, '0')}:00`;
                            return (
                              <option key={`前一天_${timeStr}`} value={`前一天_${timeStr}`}>
                                前一天 {timeStr}
                              </option>
                            );
                          })}
                          {/* 當天 options: 0:00 to 10:00 */}
                          {Array.from({ length: 11 }, (_, i) => i).map((h) => {
                            const timeStr = `${String(h).padStart(2, '0')}:00`;
                            return (
                              <option key={`當天_${timeStr}`} value={`當天_${timeStr}`}>
                                當天 {timeStr}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
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
                onWheel={preventScrollWheelChange}
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
          <div className="flex items-center gap-2 mb-2">
            <label className="block text-sm font-medium text-gray-700">
              患者未來預約上限（次）
            </label>
            <InfoButton onClick={() => setShowMaxFutureAppointmentsModal(true)} />
          </div>
          <div className="space-y-4 max-w-xs">
            <div>
              <input
                type="number"
                value={bookingRestrictionSettings.max_future_appointments ?? 3}
                onChange={(e) => handleMaxFutureAppointmentsChange(e.target.value)}
                onWheel={preventScrollWheelChange}
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
        <div className="relative pt-6 border-t border-gray-200 md:pt-0 md:border-t-0">
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
                onWheel={preventScrollWheelChange}
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
          <div className="flex items-center gap-2 mb-2">
            <label className="block text-sm font-medium text-gray-700">
              允許病患自行取消預約
            </label>
            <InfoButton onClick={() => setShowAllowPatientDeletionModal(true)} />
          </div>
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
          <div className="flex items-center gap-2 mb-2">
            <label className="block text-sm font-medium text-gray-700">
              {bookingRestrictionSettings.allow_patient_deletion !== false
                ? "預約取消/修改限制"
                : "預約修改限制"}
            </label>
            <InfoButton onClick={() => setShowCancellationLimitModal(true)} />
          </div>
          <div className="space-y-4 max-w-xs">
            <div>
              <input
                type="number"
                value={bookingRestrictionSettings.minimum_cancellation_hours_before ?? 24}
                onChange={(e) => handleMinimumCancellationHoursChange(e.target.value)}
                onWheel={preventScrollWheelChange}
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
          <div className="flex items-center gap-2 mb-2">
            <label className="block text-sm font-medium text-gray-700">
              要求填寫生日
            </label>
            <InfoButton onClick={() => setShowRequireBirthdayModal(true)} />
          </div>
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

        {/* Info Modals */}
        <InfoModal
          isOpen={showRestrictionModeModal}
          onClose={() => setShowRestrictionModeModal(false)}
          title="預約限制模式"
          ariaLabel="預約限制模式說明"
        >
          <div className="space-y-3">
            <div>
              <p className="font-medium">至少提前 X 小時預約：</p>
              <p>病患必須在預約時間前至少 X 小時完成預約。例如設定 4 小時，則病患最晚可在當天下午 2 點預約晚上 6 點的時段。</p>
            </div>
            <div>
              <p className="font-medium">特定時間前預約：</p>
              <p>病患必須在指定時間（前一天或當天）之前完成預約。例如「前一天 08:00」，則病患最晚可在前一天早上 8 點前預約隔天的時段。</p>
            </div>
          </div>
        </InfoModal>

        <InfoModal
          isOpen={showMaxFutureAppointmentsModal}
          onClose={() => setShowMaxFutureAppointmentsModal(false)}
          title="患者未來預約上限（次）"
          ariaLabel="患者未來預約上限說明"
        >
          <p>此設定限制每位病患同時擁有的未來預約數量。例如設定 3 次，當病患已有 3 個未來預約時，必須先取消或完成其中一個預約，才能建立新的預約。</p>
        </InfoModal>

        <InfoModal
          isOpen={showAllowPatientDeletionModal}
          onClose={() => setShowAllowPatientDeletionModal(false)}
          title="允許病患自行取消預約"
          ariaLabel="允許病患自行取消預約說明"
        >
          <p>啟用後，病患可透過 LINE 預約系統自行取消預約。停用後，病患只能修改預約時間，無法取消，必須聯繫診所才能取消預約。</p>
        </InfoModal>

        <InfoModal
          isOpen={showCancellationLimitModal}
          onClose={() => setShowCancellationLimitModal(false)}
          title="預約取消/修改限制"
          ariaLabel="預約取消/修改限制說明"
        >
          <p>此設定要求病患必須在預約時間前至少 X 小時才能取消或修改預約。例如設定 24 小時，病患最晚必須在預約前一天相同時間前完成取消或修改。</p>
          <p className="text-xs text-gray-600 mt-2">此限制不適用於診所管理員的操作，管理員可隨時取消或修改任何預約。</p>
        </InfoModal>

        <InfoModal
          isOpen={showRequireBirthdayModal}
          onClose={() => setShowRequireBirthdayModal(false)}
          title="要求填寫生日"
          ariaLabel="要求填寫生日說明"
        >
          <p>啟用後，病患在註冊或新增就診人時必須填寫生日。未填寫生日將無法完成註冊或新增就診人。</p>
        </InfoModal>

        <InfoModal
          isOpen={showPatientBookingModal}
          onClose={() => setShowPatientBookingModal(false)}
          title="開放病患預約"
          ariaLabel="開放病患預約說明"
        >
          <p>此設定影響病患是否能透過 LINE 自行預約該治療師的時段。停用後，病患無法透過 LINE 預約此治療師，但診所人員仍可為病患建立預約。</p>
        </InfoModal>
    </div>
  );
};

export default ClinicAppointmentSettings;


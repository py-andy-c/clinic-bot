import React, { useState, useEffect } from 'react';
import moment from 'moment-timezone';
import { logger } from '../../utils/logger';
import { BaseModal } from '../../components/calendar/BaseModal';
import { LoadingSpinner } from '../../components/shared';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { liffApiService } from '../../services/liffApi';
import {
  generateCalendarDays,
  formatDateString,
  formatMonthYear,
  isToday,
} from '../../utils/calendarUtils';

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const TIME_WINDOWS = [
  { id: 'morning', label: '上午', display: '上午' },
  { id: 'afternoon', label: '下午', display: '下午' },
  { id: 'evening', label: '晚上', display: '晚上' },
];

const MAX_DAYS_AHEAD = 90;

const NotificationModal: React.FC<NotificationModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const {
    appointmentTypeId,
    appointmentType,
    practitionerId,
    practitioner,
    clinicId,
  } = useAppointmentStore();

  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  // Map from date string to set of time window IDs
  const [dateTimeWindows, setDateTimeWindows] = useState<Map<string, Set<string>>>(new Map());
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDateToggle = (date: Date) => {
    const dateString = formatDateString(date);
    const today = moment.tz('Asia/Taipei').startOf('day');
    const dateMoment = moment.tz(dateString, 'Asia/Taipei').startOf('day');
    const maxDate = today.clone().add(MAX_DAYS_AHEAD, 'days');

    // Only allow dates from today to MAX_DAYS_AHEAD days ahead
    if (dateMoment.isBefore(today) || dateMoment.isAfter(maxDate)) {
      return;
    }

    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateString)) {
        next.delete(dateString);
        // Remove time windows for this date
        setDateTimeWindows((prevWindows) => {
          const nextWindows = new Map(prevWindows);
          nextWindows.delete(dateString);
          return nextWindows;
        });
      } else {
        next.add(dateString);
        // Initialize with empty set of time windows
        setDateTimeWindows((prevWindows) => {
          const nextWindows = new Map(prevWindows);
          nextWindows.set(dateString, new Set());
          return nextWindows;
        });
      }
      return next;
    });
  };

  const getTotalSelectedWindows = (): number => {
    let total = 0;
    dateTimeWindows.forEach((windows) => {
      total += windows.size;
    });
    return total;
  };

  const handleTimeWindowToggle = (dateString: string, windowId: string) => {
    const currentWindows = dateTimeWindows.get(dateString) || new Set<string>();
    const isCurrentlySelected = currentWindows.has(windowId);
    const totalWindows = getTotalSelectedWindows();

    // If trying to select a new window, check limit
    if (!isCurrentlySelected && totalWindows >= 10) {
      return; // Button is disabled, so this shouldn't happen, but guard anyway
    }

    setError(null);
    setDateTimeWindows((prev) => {
      const next = new Map(prev);
      const windows = next.get(dateString) || new Set<string>();
      const newWindows = new Set(windows);
      if (newWindows.has(windowId)) {
        newWindows.delete(windowId);
      } else {
        newWindows.add(windowId);
      }
      next.set(dateString, newWindows);
      return next;
    });
  };

  const getTimeWindowsForDate = (dateString: string): Set<string> => {
    return dateTimeWindows.get(dateString) || new Set();
  };

  const getDisabledReason = (): string | null => {
    if (selectedDates.size === 0) return '請選擇至少一個日期';
    const totalWindows = getTotalSelectedWindows();
    if (totalWindows === 0) return '請至少選擇一個時段';
    return null;
  };

  const handleSubmit = async () => {
    if (selectedDates.size === 0) {
      setError('請選擇至少一個日期');
      return;
    }

    const totalWindows = getTotalSelectedWindows();
    if (totalWindows === 0) {
      setError('請至少選擇一個時段');
      return;
    }

    if (!appointmentTypeId) {
      setError('請先選擇預約類型');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      // Create notifications only for dates that have time windows selected
      const datesArray = Array.from(selectedDates);
      const promises = datesArray
        .filter((dateStr) => getTimeWindowsForDate(dateStr).size > 0)
        .map((dateStr) => {
          const timeWindows = Array.from(getTimeWindowsForDate(dateStr));
          return liffApiService.createAvailabilityNotification({
            appointment_type_id: appointmentTypeId,
            practitioner_id: practitionerId ?? null,
            date: dateStr,
            time_windows: timeWindows,
          });
        });

      await Promise.all(promises);

      onSuccess?.();
      onClose();
    } catch (err: any) {
      logger.error('Failed to create notification:', err);
      setError(err.response?.data?.detail || '設定通知失敗，請稍後再試');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const isDateSelectable = (date: Date): boolean => {
    const dateString = formatDateString(date);
    const today = moment.tz('Asia/Taipei').startOf('day');
    const dateMoment = moment.tz(dateString, 'Asia/Taipei').startOf('day');
    const maxDate = today.clone().add(MAX_DAYS_AHEAD, 'days');
    return !dateMoment.isBefore(today) && !dateMoment.isAfter(maxDate);
  };

  if (!isOpen) return null;

  const calendarDays = generateCalendarDays(currentMonth);
  const dayNames = ['日', '一', '二', '三', '四', '五', '六'];

  return (
    <BaseModal onClose={onClose} aria-label="設定空位通知">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">設定空位通知</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="關閉"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Appointment Type & Practitioner (Read-only) */}
        <div className="space-y-2">
          <div>
            <span className="text-sm text-gray-500">預約類型：</span>
            <span className="text-sm font-medium text-gray-900 ml-2">
              {appointmentType?.name || '未選擇'}
            </span>
          </div>
          <div>
            <span className="text-sm text-gray-500">治療師：</span>
            <span className="text-sm font-medium text-gray-900 ml-2">
              {practitioner ? practitioner.full_name : '不指定'}
            </span>
          </div>
        </div>

        {/* Calendar */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            選擇日期（可多選）
          </label>
          <div className="border border-gray-200 rounded-lg p-3">
            {/* Month Navigation */}
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={handlePrevMonth}
                className="p-1 hover:bg-gray-100 rounded-full"
                aria-label="上個月"
              >
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h3 className="text-sm font-semibold text-gray-900">
                {formatMonthYear(currentMonth)}
              </h3>
              <button
                onClick={handleNextMonth}
                className="p-1 hover:bg-gray-100 rounded-full"
                aria-label="下個月"
              >
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {/* Days of Week */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {dayNames.map((day) => (
                <div key={day} className="text-center text-xs font-medium text-gray-600 py-1">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((date, index) => {
                if (!date) {
                  return <div key={`empty-${index}`} className="aspect-square" />;
                }

                const dateString = formatDateString(date);
                const isSelectable = isDateSelectable(date);
                const isSelected = selectedDates.has(dateString);
                const isTodayDate = isToday(date);

                return (
                  <button
                    key={dateString}
                    onClick={() => handleDateToggle(date)}
                    disabled={!isSelectable}
                    className={`aspect-square text-xs rounded transition-colors relative ${
                      isSelected
                        ? 'bg-teal-500 text-white font-semibold'
                        : isSelectable
                        ? 'bg-white text-gray-900 hover:bg-gray-50 border border-gray-200'
                        : 'bg-gray-50 text-gray-400 cursor-not-allowed border border-gray-100'
                    }`}
                  >
                    <div className="flex flex-col items-center justify-center h-full">
                      <span>{date.getDate()}</span>
                      {isTodayDate && (
                        <div className={`w-3 h-0.5 mt-0.5 ${isSelected ? 'bg-white' : 'bg-gray-500'}`} />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Selected Dates with Time Windows */}
        {selectedDates.size > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-600">
                為每個日期選擇時段
              </label>
              <span className="text-xs text-gray-500">
                已選 {getTotalSelectedWindows()} / 10 個時段
              </span>
            </div>
            {Array.from(selectedDates).sort().map((dateString) => {
              const timeWindows = getTimeWindowsForDate(dateString);
              const dateObj = moment.tz(dateString, 'Asia/Taipei');
              const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
              const weekday = weekdayNames[dateObj.day()];
              
              return (
                <div
                  key={dateString}
                  className="border border-gray-200 rounded-md p-2.5 bg-white"
                >
                  <div className="mb-2">
                    <span className="text-xs font-medium text-gray-700">
                      {dateObj.format('YYYY年MM月DD日')} ({weekday})
                    </span>
                  </div>
                  
                  {/* Always show time windows (auto-expanded) */}
                  <div className="flex gap-1.5">
                    {TIME_WINDOWS.map((window) => {
                      const isSelected = timeWindows.has(window.id);
                      const totalWindows = getTotalSelectedWindows();
                      const isDisabled = !isSelected && totalWindows >= 10;
                      return (
                        <button
                          key={window.id}
                          type="button"
                          onClick={() => handleTimeWindowToggle(dateString, window.id)}
                          disabled={isDisabled}
                          className={`flex-1 py-1.5 px-2 rounded-md border-2 transition-all text-xs font-medium ${
                            isSelected
                              ? 'bg-teal-50 border-teal-500 text-teal-700'
                              : isDisabled
                              ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
                              : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {window.display}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}


        {/* Actions */}
        <div className="space-y-2 pt-2">
          {getDisabledReason() && !isSubmitting && (
            <p className="text-xs text-gray-500 text-center">
              {getDisabledReason()}
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
              disabled={isSubmitting}
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={
                isSubmitting ||
                selectedDates.size === 0 ||
                getTotalSelectedWindows() === 0
              }
              className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-md text-sm font-medium hover:bg-teal-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center">
                  <LoadingSpinner size="sm" className="mr-2" />
                  設定中...
                </span>
              ) : (
                '確認設定'
              )}
            </button>
          </div>
        </div>
      </div>
    </BaseModal>
  );
};

export default NotificationModal;


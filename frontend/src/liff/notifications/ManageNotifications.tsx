import React, { useState, useEffect } from 'react';
import { logger } from '../../utils/logger';
import { LoadingSpinner, ErrorMessage } from '../../components/shared';
import { liffApiService } from '../../services/liffApi';
import { useModal } from '../../contexts/ModalContext';
import moment from 'moment-timezone';

interface Notification {
  id: number;
  appointment_type_id: number;
  appointment_type_name: string;
  practitioner_id: number | null;
  practitioner_name: string | null;
  time_windows: Array<{ date: string; time_window: string }>;
  created_at: string;
  min_date: string;
  max_date: string;
}

const TIME_WINDOW_LABELS: Record<string, string> = {
  morning: '上午',
  afternoon: '下午',
  evening: '晚上',
};

const ManageNotifications: React.FC = () => {
  const { confirm: showConfirm, alert: showAlert } = useModal();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    loadNotifications();
  }, []);

  const loadNotifications = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await liffApiService.getAvailabilityNotifications();
      setNotifications(response.notifications);
    } catch (err) {
      logger.error('Failed to load notifications:', err);
      setError('無法載入提醒列表，請稍後再試');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (notification: Notification) => {
    const confirmed = await showConfirm(
      '確認刪除',
      `確定要刪除此提醒嗎？\n\n預約類型：${notification.appointment_type_name}\n治療師：${notification.practitioner_name || '不指定'}`
    );

    if (!confirmed) return;

    try {
      setDeletingIds(prev => new Set(prev).add(notification.id));
      await liffApiService.deleteAvailabilityNotification(notification.id);
      await showAlert('成功', '提醒已刪除');
      await loadNotifications();
    } catch (err) {
      logger.error('Failed to delete notification:', err);
      await showAlert('錯誤', '刪除提醒失敗，請稍後再試');
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev);
        next.delete(notification.id);
        return next;
      });
    }
  };

  const formatDateDisplay = (dateStr: string): string => {
    const date = moment.tz(dateStr, 'Asia/Taipei');
    return date.format('M月D日');
  };

  const formatTimeWindow = (timeWindow: string): string => {
    return TIME_WINDOW_LABELS[timeWindow] || timeWindow;
  };

  const groupTimeWindowsByDate = (timeWindows: Array<{ date: string; time_window: string }>) => {
    const grouped: Record<string, string[]> = {};
    timeWindows.forEach(tw => {
      if (!grouped[tw.date]) {
        grouped[tw.date] = [];
      }
      const dateGroup = grouped[tw.date];
      if (dateGroup) {
        dateGroup.push(formatTimeWindow(tw.time_window));
      }
    });
    return grouped;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-8">
        <ErrorMessage message={error} onRetry={loadNotifications} />
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="px-4 py-12 text-center">
        <div className="mb-4">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">尚無提醒</h3>
        <p className="text-sm text-gray-500 mb-6">
          您還沒有設定任何空位提醒
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">管理提醒</h2>
        <p className="text-sm text-gray-500">您目前有 {notifications.length} 個提醒</p>
      </div>

      <div className="space-y-4">
        {notifications.map(notification => {
          const groupedWindows = groupTimeWindowsByDate(notification.time_windows);
          const isDeleting = deletingIds.has(notification.id);

          return (
            <div
              key={notification.id}
              className="bg-white border border-gray-200 rounded-lg p-4"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h3 className="font-medium text-gray-900 mb-1">
                    {notification.appointment_type_name}
                  </h3>
                  <p className="text-sm text-gray-500">
                    治療師：{notification.practitioner_name || '不指定'}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(notification)}
                  disabled={isDeleting}
                  className={`ml-4 p-2 text-red-600 hover:bg-red-50 rounded transition-colors ${
                    isDeleting ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                  aria-label="刪除提醒"
                >
                  {isDeleting ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  )}
                </button>
              </div>

              <div className="border-t border-gray-100 pt-3">
                <div className="text-sm text-gray-600 mb-2">
                  <span className="font-medium">提醒時段：</span>
                </div>
                <div className="space-y-1">
                  {Object.entries(groupedWindows).map(([date, windows]) => (
                    <div key={date} className="text-sm text-gray-700">
                      <span className="font-medium">{formatDateDisplay(date)}：</span>
                      <span className="ml-2">{windows.join('、')}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  建立時間：{moment.tz(notification.created_at, 'Asia/Taipei').format('YYYY年M月D日')}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ManageNotifications;


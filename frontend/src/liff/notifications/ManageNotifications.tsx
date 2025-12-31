import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { logger } from '../../utils/logger';
import { LoadingSpinner, ErrorMessage } from '../../components/shared';
import { liffApiService } from '../../services/liffApi';
import { useModal } from '../../contexts/ModalContext';
import { preserveQueryParams } from '../../utils/urlUtils';
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

const ManageNotifications: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { confirm: showConfirm, alert: showAlert } = useModal();

  const TIME_WINDOW_LABELS: Record<string, string> = {
    morning: t('notifications.manage.timeWindow.morning'),
    afternoon: t('notifications.manage.timeWindow.afternoon'),
    evening: t('notifications.manage.timeWindow.evening'),
  };
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());

  const handleAddNew = () => {
    const newUrl = preserveQueryParams('/liff', { mode: 'notifications', sub_mode: 'add' });
    navigate(newUrl);
  };

  const loadNotifications = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await liffApiService.getAvailabilityNotifications();
      setNotifications(response.notifications);
    } catch (err) {
      logger.error('Failed to load notifications:', err);
      setError(t('notifications.manage.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const handleDelete = async (notification: Notification) => {
    const confirmMessage = t('notifications.manage.deleteConfirm', {
      appointmentType: notification.appointment_type_name,
      practitioner: notification.practitioner_name || t('notifications.manage.notSpecified')
    });
    const confirmed = await showConfirm(
      confirmMessage,
      t('notifications.manage.deleteConfirmTitle')
    );

    if (!confirmed) return;

    try {
      setDeletingIds(prev => new Set(prev).add(notification.id));
      await liffApiService.deleteAvailabilityNotification(notification.id);
      await showAlert(t('notifications.manage.deleteSuccess'), t('notifications.manage.deleteSuccessTitle'));
      await loadNotifications();
    } catch (err) {
      logger.error('Failed to delete notification:', err);
      await showAlert(t('notifications.manage.deleteFailed'), t('notifications.manage.deleteFailedTitle'));
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
    const format = t('datetime.monthDayFormat');
    return date.format(format);
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
      <div className="px-4 py-12">
        <div className="text-center mb-6">
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
          <h3 className="text-lg font-medium text-gray-900 mb-2">{t('notifications.manage.noNotifications')}</h3>
          <p className="text-sm text-gray-500 mb-6">
            {t('notifications.manage.noNotificationsDesc')}
          </p>
        </div>
        <button
          onClick={handleAddNew}
          className="w-full py-3 px-4 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
        >
          {t('notifications.manage.add')}
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{t('notifications.manage.count', { count: notifications.length })}</p>
        </div>
        <button
          onClick={handleAddNew}
          className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors whitespace-nowrap"
        >
          {t('notifications.manage.add')}
        </button>
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
                    {t('notifications.manage.practitioner')}{notification.practitioner_name || t('notifications.manage.notSpecified')}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(notification)}
                  disabled={isDeleting}
                  className={`ml-4 p-2 text-red-600 hover:bg-red-50 rounded transition-colors ${
                    isDeleting ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                  aria-label={t('notifications.manage.deleteLabel')}
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
                  <span className="font-medium">{t('notifications.manage.timeWindows')}</span>
                </div>
                <div className="space-y-1">
                  {Object.entries(groupedWindows).map(([date, windows]) => (
                    <div key={date} className="text-sm text-gray-700">
                      <span className="font-medium">{formatDateDisplay(date)}{t('datetime.colon')}</span>
                      <span className="ml-2">{windows.join(t('datetime.listSeparator'))}</span>
                    </div>
                  ))}
                </div>
                       <div className="mt-2 text-xs text-gray-500">
                         {t('notifications.manage.createdAt')} {moment.tz(notification.created_at, 'Asia/Taipei').format(t('datetime.fullDateFormat'))}
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


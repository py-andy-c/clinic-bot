import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useLiffBackButton } from '../../hooks/useLiffBackButton';
import { LanguageSelector } from '../components/LanguageSelector';
import { PageInstructions } from '../components/PageInstructions';
import { useAppointmentStore } from '../../stores/appointmentStore';
import AddNotification from './AddNotification';
import ManageNotifications from './ManageNotifications';

type NotificationSubMode = 'add' | 'manage';
const DEFAULT_SUB_MODE: NotificationSubMode = 'manage';

const NotificationsFlow: React.FC = () => {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const notificationsPageInstructions = useAppointmentStore(state => state.notificationsPageInstructions);

  const subMode = (searchParams.get('sub_mode') as NotificationSubMode) || DEFAULT_SUB_MODE;

  // Enable back button navigation - always goes back to home (regardless of source)
  useLiffBackButton('notifications');

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="bg-white shadow-sm">
          <div className="px-4 py-3">
            {/* Title with language selector inline */}
            <div className="flex items-center justify-between mb-2">
              <h1 className="text-lg font-semibold text-gray-900">{t('notifications.title')}</h1>
              <LanguageSelector />
            </div>
            <p className="text-sm text-gray-500">{t('home.notificationsDesc')}</p>
            <div className="mt-3">
              <PageInstructions instructions={notificationsPageInstructions} />
            </div>
          </div>
        </div>
        {subMode === 'add' ? <AddNotification /> : <ManageNotifications />}
      </div>
    </div>
  );
};

export default NotificationsFlow;


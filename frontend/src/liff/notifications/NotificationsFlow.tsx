import React from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { preserveQueryParams } from '../../utils/urlUtils';
import AddNotification from './AddNotification';
import ManageNotifications from './ManageNotifications';

type NotificationSubMode = 'add' | 'manage';
const DEFAULT_SUB_MODE: NotificationSubMode = 'manage';

const NotificationsFlow: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const subMode = (searchParams.get('sub_mode') as NotificationSubMode) || DEFAULT_SUB_MODE;

  const handleBack = () => {
    const newUrl = preserveQueryParams('/liff', { mode: 'home' });
    navigate(newUrl);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto">
        {/* Header with back button */}
        <div className="bg-white shadow-sm">
          <div className="px-4 py-3 flex items-center">
            <button
              onClick={handleBack}
              className="p-2 -ml-2 hover:bg-gray-100 rounded-full transition-colors"
              aria-label="返回首頁"
            >
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="ml-2 text-lg font-semibold text-gray-900">空位提醒</h1>
          </div>
        </div>
        {subMode === 'add' ? <AddNotification /> : <ManageNotifications />}
      </div>
    </div>
  );
};

export default NotificationsFlow;


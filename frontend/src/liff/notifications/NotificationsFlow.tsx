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

  const handleSubModeChange = (newSubMode: NotificationSubMode) => {
    const newUrl = preserveQueryParams('/liff', { mode: 'notifications', sub_mode: newSubMode });
    navigate(newUrl);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Tab Navigation */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-md mx-auto">
          <div className="flex">
            <button
              onClick={() => handleSubModeChange('add')}
              className={`flex-1 py-4 px-4 text-center font-medium transition-colors ${
                subMode === 'add'
                  ? 'text-primary-600 border-b-2 border-primary-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              新增提醒
            </button>
            <button
              onClick={() => handleSubModeChange('manage')}
              className={`flex-1 py-4 px-4 text-center font-medium transition-colors ${
                subMode === 'manage'
                  ? 'text-primary-600 border-b-2 border-primary-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              管理提醒
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-md mx-auto">
        {subMode === 'add' ? <AddNotification /> : <ManageNotifications />}
      </div>
    </div>
  );
};

export default NotificationsFlow;


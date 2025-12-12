import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import PageHeader from './PageHeader';

const SettingsLayout: React.FC = () => {
  const location = useLocation();
  const { isClinicUser } = useAuth();

  // Only clinic users can access clinic settings
  if (!isClinicUser) {
    return (
      <div className="space-y-8">
        <PageHeader title="診所設定" />

        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-6 text-center">
          <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-yellow-600 text-xl">⚠️</span>
          </div>
          <h3 className="text-lg font-medium text-yellow-800 mb-2">無權限存取設定</h3>
          <p className="text-yellow-700">
            只有診所成員才能查看此頁面。
          </p>
        </div>
      </div>
    );
  }

  // Only show header on index page
  const isIndexPage = location.pathname === '/admin/clinic/settings' || location.pathname === '/admin/clinic/settings/';

  return (
    <div className="max-w-7xl mx-auto">
      {isIndexPage && <PageHeader title="診所設定" />}
      <Outlet />
    </div>
  );
};

export default SettingsLayout;


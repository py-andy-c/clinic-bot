import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import PageHeader from './PageHeader';

const DashboardLayout: React.FC = () => {
  const location = useLocation();

  // Only show header on index page
  const isIndexPage = location.pathname === '/admin/clinic/dashboard' || location.pathname === '/admin/clinic/dashboard/';

  return (
    <div className="max-w-7xl mx-auto">
      {isIndexPage && <PageHeader title="儀表板" />}
      <Outlet />
    </div>
  );
};

export default DashboardLayout;

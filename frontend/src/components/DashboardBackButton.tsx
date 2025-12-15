import React from 'react';
import BackButton from './BackButton';

const DashboardBackButton: React.FC = () => {
  return <BackButton to="/admin/clinic/dashboard" label="返回儀表板" />;
};

export default DashboardBackButton;

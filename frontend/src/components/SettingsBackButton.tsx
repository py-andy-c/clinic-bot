import React from 'react';
import BackButton from './BackButton';

const SettingsBackButton: React.FC = () => {
  return <BackButton to="/admin/clinic/settings" label="返回設定選單" />;
};

export default SettingsBackButton;

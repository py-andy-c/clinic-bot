import React from 'react';
import { Link } from 'react-router-dom';

const SettingsBackButton: React.FC = () => {
  return (
    <Link
      to="/admin/clinic/settings"
      className="inline-flex items-center text-sm font-medium text-gray-600 hover:text-gray-900 mb-6 transition-colors"
    >
      <svg
        className="mr-2 h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      返回設定選單
    </Link>
  );
};

export default SettingsBackButton;


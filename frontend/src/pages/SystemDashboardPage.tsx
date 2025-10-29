import React from 'react';

const SystemDashboardPage: React.FC = () => {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="md:flex md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight">
            系統儀表板
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            系統管理功能
          </p>
        </div>
      </div>

      {/* Placeholder content */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
          <h3 className="text-lg leading-6 font-medium text-gray-900">系統管理</h3>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            系統管理功能將在此處顯示
          </p>
        </div>
        <div className="text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">系統管理功能</h3>
          <p className="mt-1 text-sm text-gray-500">系統管理相關功能將在此處提供。</p>
        </div>
      </div>
    </div>
  );
};

export default SystemDashboardPage;

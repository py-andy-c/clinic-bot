import React from 'react';

export type SyncStatusType = 'saved' | 'saving' | 'none';

interface SyncStatusProps {
  status: SyncStatusType;
}

export const SyncStatus: React.FC<SyncStatusProps> = ({ status }) => {
  if (status === 'none') return null;

  const getStatusConfig = () => {
    switch (status) {
      case 'saving':
        return {
          icon: <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />,
          text: '儲存中...',
          className: 'text-blue-600',
        };
      case 'saved':
      default:
        return {
          icon: (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          ),
          text: '已儲存',
          className: 'text-green-600',
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div className={`flex items-center gap-1 text-xs font-medium transition-all duration-300 ${config.className}`}>
      {config.icon}
      <span>{config.text}</span>
    </div>
  );
};

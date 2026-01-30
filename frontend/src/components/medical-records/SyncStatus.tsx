import React from 'react';

export type SyncStatusType = 'saved' | 'saving' | 'none';

interface SyncStatusProps {
  status: SyncStatusType;
}

export const SyncStatus: React.FC<SyncStatusProps> = ({ status }) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'saving':
        return {
          icon: <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />,
          text: '儲存中...',
          className: 'text-blue-600',
        };
      case 'saved':
        return {
          icon: (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          ),
          text: '已儲存',
          className: 'text-green-600',
        };
      case 'none':
      default:
        return {
          icon: null,
          text: '',
          className: 'opacity-0',
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div className={`flex items-center gap-1.5 text-xs font-medium transition-all duration-300 ${config.className} w-[80px] h-5`}>
      <div className="w-3 h-3 flex items-center justify-center flex-shrink-0">
        {config.icon}
      </div>
      <span className="whitespace-nowrap">{config.text}</span>
    </div>
  );
};

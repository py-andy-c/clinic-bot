import React from 'react';

export type SyncStatusType = 'saved' | 'saving' | 'error' | 'none';

interface SyncStatusProps {
  status: SyncStatusType;
  errorMessage?: string | null;
  onRetry?: () => void;
}

export const SyncStatus: React.FC<SyncStatusProps> = ({ status, errorMessage, onRetry }) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'error':
        return {
          icon: (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ),
          text: '儲存失敗',
          className: 'text-red-600 cursor-pointer hover:underline',
          title: errorMessage || '伺服器錯誤'
        };
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
    <div 
      className={`flex items-center gap-1.5 text-xs font-medium transition-all duration-300 ${config.className} w-[80px] h-5`}
      title={config.title}
      onClick={status === 'error' ? onRetry : undefined}
    >
      <div className="w-3 h-3 flex items-center justify-center flex-shrink-0">
        {config.icon}
      </div>
      <span className="whitespace-nowrap">{config.text}</span>
    </div>
  );
};

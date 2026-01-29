import React from 'react';
import { LoadingSpinner } from '../shared';

export type SyncStatusType = 'saved' | 'saving' | 'dirty' | 'offline';

interface SyncStatusProps {
  status: SyncStatusType;
  lastSaved?: Date | null;
}

export const SyncStatus: React.FC<SyncStatusProps> = ({ status, lastSaved }) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'saving':
        return {
          icon: <LoadingSpinner size="sm" />,
          text: '儲存中...',
          className: 'text-blue-600 bg-blue-50 border-blue-200',
        };
      case 'offline':
        return {
          icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3" />
            </svg>
          ),
          text: '離線 - 變更未儲存',
          className: 'text-red-600 bg-red-50 border-red-200',
        };
      case 'dirty':
        return {
          icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          ),
          text: '有未儲存的變更',
          className: 'text-orange-600 bg-orange-50 border-orange-200',
        };
      case 'saved':
      default:
        return {
          icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ),
          text: lastSaved 
            ? `已儲存於 ${lastSaved.toLocaleTimeString('zh-TW')}`
            : '已儲存',
          className: 'text-green-600 bg-green-50 border-green-200',
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-medium transition-all duration-300 ${config.className}`}>
      {config.icon}
      <span>{config.text}</span>
    </div>
  );
};

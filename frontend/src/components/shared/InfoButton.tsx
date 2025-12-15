import React from 'react';

interface InfoButtonProps {
  onClick: () => void;
  ariaLabel?: string;
  size?: 'default' | 'small';
}

export const InfoButton: React.FC<InfoButtonProps> = ({ onClick, ariaLabel = "查看說明", size = 'default' }) => {
  const iconSize = size === 'small' ? 'h-4 w-4' : 'h-5 w-5';
  const padding = size === 'small' ? 'p-0.5' : 'p-1';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center ${padding} text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full`}
      aria-label={ariaLabel}
    >
      <svg className={iconSize} viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
      </svg>
    </button>
  );
};

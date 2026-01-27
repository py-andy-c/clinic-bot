import React from 'react';

export interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  fullScreen?: boolean;
  'aria-label'?: string;
}

const sizeClasses = {
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
  xl: 'h-32 w-32',
} as const;

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = React.memo(({
  size = 'md',
  className = '',
  fullScreen = false,
  'aria-label': ariaLabel = '載入中...'
}) => {
  const spinner = (
    <div
      className={`animate-spin rounded-full border-b-2 border-primary-600 ${sizeClasses[size]} ${className}`}
      role="status"
      aria-label={ariaLabel}
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">{ariaLabel}</span>
    </div>
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white/50 backdrop-blur-[2px] cursor-wait">
        <div className="bg-white/80 p-6 rounded-2xl shadow-xl border border-gray-100 flex flex-col items-center gap-4">
          {spinner}
          {ariaLabel && <p className="text-sm font-medium text-gray-600">{ariaLabel}</p>}
        </div>
      </div>
    );
  }

  return spinner;
});

LoadingSpinner.displayName = 'LoadingSpinner';

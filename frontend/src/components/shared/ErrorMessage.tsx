import React from 'react';

export interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
  className?: string;
  fullScreen?: boolean;
  showIcon?: boolean;
  retryText?: string;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({
  message,
  onRetry,
  className = '',
  fullScreen = false,
  showIcon = true,
  retryText = '重試'
}) => {
  const errorContent = (
    <div
      className={`text-center ${className}`}
      role="alert"
      aria-live="assertive"
    >
      {showIcon && (
        <div className="text-red-500 text-6xl mb-4" aria-hidden="true">
          ⚠️
        </div>
      )}
      <h2 className="text-xl font-bold text-gray-900 mb-4">
        發生錯誤
      </h2>
      <p className="text-gray-600 mb-6 whitespace-pre-line">
        {message}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="bg-primary-600 text-white px-6 py-2 rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
        >
          {retryText}
        </button>
      )}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        {errorContent}
      </div>
    );
  }

  return errorContent;
};

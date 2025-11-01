import React from 'react';

export const LoadingSpinner: React.FC = () => (
  <div
    className="min-h-screen flex items-center justify-center"
    role="status"
    aria-live="polite"
    aria-busy="true"
  >
    <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
  </div>
);

export const ErrorMessage: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div
    className="min-h-screen flex items-center justify-center p-4"
    role="alert"
    aria-live="assertive"
  >
    <div className="text-center">
      <div className="text-red-500 text-6xl mb-4" aria-hidden="true">⚠️</div>
      <h1 className="text-xl font-bold text-gray-900 mb-4">發生錯誤</h1>
      <p className="text-gray-600 mb-6">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="bg-primary-600 text-white px-6 py-2 rounded-md hover:bg-primary-700"
        >
          重試
        </button>
      )}
    </div>
  </div>
);

export const InvalidAccess: React.FC = () => (
  <div
    className="min-h-screen flex items-center justify-center p-4"
    role="alert"
    aria-live="assertive"
  >
    <div className="text-center">
      <div className="text-red-500 text-6xl mb-4" aria-hidden="true">🚫</div>
      <h1 className="text-xl font-bold text-gray-900 mb-4">存取無效</h1>
      <p className="text-gray-600 mb-6">
        請從診所的LINE官方帳號進入此應用程式
      </p>
    </div>
  </div>
);

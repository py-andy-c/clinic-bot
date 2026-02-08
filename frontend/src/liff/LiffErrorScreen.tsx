import React from 'react';

export const LiffErrorScreen: React.FC<{ error?: Error; reset?: () => void }> = ({ error, reset }) => {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
      <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h1 className="text-xl font-bold text-gray-900 mb-2">發生錯誤</h1>
      <p className="text-gray-600 mb-6">
        抱歉，載入表單時發生錯誤。請嘗試重新載入頁面。
      </p>
      {error && (
        <pre className="text-xs text-red-500 bg-red-50 p-3 rounded-lg mb-6 max-w-full overflow-auto text-left">
          {error.message}
        </pre>
      )}
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button
          onClick={() => window.location.reload()}
          className="w-full py-3 bg-primary-600 text-white rounded-xl font-semibold shadow-lg shadow-primary-200"
        >
          重新載入頁面
        </button>
        {reset && (
          <button
            onClick={reset}
            className="w-full py-3 bg-white text-gray-700 border border-gray-200 rounded-xl font-semibold"
          >
            重試
          </button>
        )}
      </div>
    </div>
  );
};

import React, { useState, useEffect, useRef } from 'react';
import { isInAppBrowser, openInBrowser, canOpenInBrowser } from '../utils/browserDetection';

interface InAppBrowserWarningProps {
  actionText?: string; // e.g., "註冊" or "登入"
  children?: React.ReactNode; // Content to show when NOT in in-app browser (e.g., Google login button)
}

/**
 * Component that shows a warning and handles in-app browser detection
 * for Google OAuth flows. Shows either a "open in browser" button or
 * a URL input field for manual copying depending on browser capabilities.
 * When not in an in-app browser, renders children instead.
 */
export const InAppBrowserWarning: React.FC<InAppBrowserWarningProps> = ({ 
  actionText = '完成操作',
  children
}) => {
  const [isInApp, setIsInApp] = useState(false);
  const [showUrlForCopy, setShowUrlForCopy] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const detected = isInAppBrowser();
    setIsInApp(detected);
    // If we know open in browser won't work, show URL immediately
    if (detected && !canOpenInBrowser()) {
      setShowUrlForCopy(true);
    }

    // Cleanup timeout on unmount
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleOpenInBrowser = () => {
    const success = openInBrowser();
    if (!success) {
      // Known to fail, show URL immediately
      setShowUrlForCopy(true);
    } else {
      // Attempted to open - only show URL if we're still on the page after a delay
      // This gives the navigation time to happen
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      
      timeoutRef.current = setTimeout(() => {
        // If we're still on the page after 2 seconds, navigation likely failed
        // Show URL as fallback
        setShowUrlForCopy(true);
        timeoutRef.current = null;
      }, 2000);
    }
  };

  if (!isInApp) {
    // Not in in-app browser, render children (e.g., Google login button)
    return <>{children}</>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-yellow-800">
              無法在此瀏覽器中使用 Google 登入
            </h3>
            <div className="mt-2 text-sm text-yellow-700">
              <p>
                您目前使用的是應用程式內建瀏覽器（如 Line、Messenger 等），
                這些瀏覽器不支援 Google 登入功能。
              </p>
              {showUrlForCopy ? (
                <p className="mt-2">
                  請複製以下連結，在系統預設瀏覽器中開啟此頁面以{actionText}。
                </p>
              ) : (
                <p className="mt-2">
                  請點擊下方按鈕，在系統預設瀏覽器中開啟此頁面以{actionText}。
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
      {showUrlForCopy ? (
        // Show URL for manual copy
        <div className="space-y-2">
          <label htmlFor="url-input" className="block text-sm font-medium text-gray-700">
            請複製此連結：
          </label>
          <div className="flex items-center space-x-2">
            <input
              id="url-input"
              type="text"
              readOnly
              value={window.location.href}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
          </div>
          <p className="text-xs text-gray-500">
            點擊上方連結即可選取，然後長按選擇「複製」，再在瀏覽器中貼上開啟
          </p>
        </div>
      ) : (
        // Show "open in browser" button
        <button
          onClick={handleOpenInBrowser}
          className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
        >
          <div className="flex items-center">
            <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            在瀏覽器中開啟
          </div>
        </button>
      )}
    </div>
  );
};


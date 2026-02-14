import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { logger } from '../utils/logger';
import { InAppBrowserWarning } from '../components/InAppBrowserWarning';
import { getErrorMessage } from '../types/api';

const LoginPage: React.FC = () => {
  const { login, isLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    // Check for error parameters in URL
    const error = searchParams.get('error');
    const message = searchParams.get('message');
    
    if (error && message) {
      setErrorMessage(message);
    }
  }, [searchParams]);

  const handleLogin = async () => {
    try {
      // Clear any existing error message
      setErrorMessage(null);
      await login();
    } catch (error: any) {
      logger.error('Login failed:', error);
      
      // Handle different types of errors
      let errorMsg = '登入失敗，請稍後再試';
      
      const backendError = getErrorMessage(error);
      if (backendError) {
        
        // Translate specific backend error messages to user-friendly Traditional Chinese
        if (backendError.includes('診所使用者認證必須透過註冊流程')) {
          errorMsg = '您尚未註冊為診所使用者，請聯繫診所管理員取得註冊連結';
        } else if (backendError.includes('User not found')) {
          errorMsg = '找不到使用者，請聯繫診所管理員';
        } else if (backendError.includes('帳戶已被停用，請聯繫診所管理員重新啟用')) {
          errorMsg = '您的帳戶已被停用，請聯繫診所管理員重新啟用';
        } else if (backendError.includes('User not found or inactive')) {
          errorMsg = '找不到使用者或帳戶已停用，請聯繫診所管理員';
        } else if (backendError.includes('Access denied')) {
          errorMsg = '存取被拒絕，您沒有權限使用此系統';
        } else if (backendError.includes('Clinic access denied')) {
          errorMsg = '診所存取被拒絕，請確認您有權限存取此診所';
        } else {
          // For other errors, show the backend message if it's in Chinese, otherwise show generic message
          errorMsg = backendError;
        }
      } else if (error?.message) {
        errorMsg = error.message;
      }
      
      setErrorMessage(errorMsg);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="mx-auto h-16 w-16 flex items-center justify-center">
            <img src="/images/logo.svg" alt="Logo" className="h-16 w-16" />
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            診所小幫手 管理系統
          </h2>
        </div>

        <div className="mt-8">
          {/* Error Message */}
          {errorMessage && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">
                    登入錯誤
                  </h3>
                  <div className="mt-2 text-sm text-red-700">
                    {errorMessage}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Main Google Login */}
          <div className="bg-white py-6 px-6 shadow rounded-lg">
            <InAppBrowserWarning actionText="完成登入">
              {/* Normal Google login button - only shown when not in in-app browser */}
              <div className="text-center">
                <button
                  onClick={handleLogin}
                  disabled={isLoading}
                  className="w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <div className="flex items-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      登入中...
                    </div>
                  ) : (
                    <div className="flex items-center">
                      <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
                        <path
                          fill="currentColor"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="currentColor"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="currentColor"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        />
                        <path
                          fill="currentColor"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        />
                      </svg>
                      Google 登入
                    </div>
                  )}
                </button>
              </div>
            </InAppBrowserWarning>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;

import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { UserType } from '../types';

const LoginPage: React.FC = () => {
  const { login, isLoading } = useAuth();
  const [userType, setUserType] = useState<UserType | ''>('');

  const handleLogin = async (selectedUserType?: UserType) => {
    try {
      await login(selectedUserType);
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-primary-100">
            <span className="text-2xl">🏥</span>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Clinic Bot 管理系統
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            選擇您的使用者類型並登入
          </p>
        </div>

        <div className="mt-8 space-y-4">
          {/* System Admin Login */}
          <div className="bg-white py-4 px-6 shadow rounded-lg">
            <div className="text-center">
              <div className="mx-auto h-8 w-8 flex items-center justify-center rounded-full bg-red-100 mb-2">
                <span className="text-sm">👑</span>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-1">系統管理員</h3>
              <p className="text-sm text-gray-600 mb-4">
                平台管理員，管理所有診所和系統設定
              </p>
              <button
                onClick={() => handleLogin('system_admin')}
                disabled={isLoading}
                className="w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
                    系統管理員登入
                  </div>
                )}
              </button>
            </div>
          </div>

          {/* Clinic User Login */}
          <div className="bg-white py-4 px-6 shadow rounded-lg">
            <div className="text-center">
              <div className="mx-auto h-8 w-8 flex items-center justify-center rounded-full bg-blue-100 mb-2">
                <span className="text-sm">🏥</span>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-1">診所使用者</h3>
              <p className="text-sm text-gray-600 mb-4">
                診所管理員或治療師，管理您的診所
              </p>
              <button
                onClick={() => handleLogin('clinic_user')}
                disabled={isLoading}
                className="w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
                    診所使用者登入
                  </div>
                )}
              </button>
            </div>
          </div>

          {/* Auto-detect login (for existing users) */}
          <div className="bg-gray-50 py-4 px-6 rounded-lg border-2 border-dashed border-gray-300">
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-3">
                已經有帳號？系統會自動偵測您的使用者類型
              </p>
              <button
                onClick={() => handleLogin()}
                disabled={isLoading}
                className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-700 mr-2"></div>
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
          </div>

          {/* Development login (for testing) */}
          <div className="bg-yellow-50 py-4 px-6 rounded-lg border-2 border-dashed border-yellow-300">
            <div className="text-center">
              <div className="mx-auto h-6 w-6 flex items-center justify-center rounded-full bg-yellow-100 mb-2">
                <span className="text-xs">🔧</span>
              </div>
              <h3 className="text-sm font-medium text-yellow-800 mb-1">開發模式登入</h3>
              <p className="text-xs text-yellow-700 mb-3">
                跳過 Google OAuth，直接登入測試
              </p>
              <button
                onClick={async () => {
                  try {
                    setAuthState(prev => ({ ...prev, isLoading: true }));
                    const response = await fetch('/api/auth/dev/login', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                        email: 'pychen1017@gmail.com',
                        user_type: 'system_admin'
                      }),
                    });

                    if (!response.ok) {
                      throw new Error(`Failed to login: ${response.status}`);
                    }

                    const data = await response.json();
                    localStorage.setItem('access_token', data.access_token);
                    localStorage.setItem('was_logged_in', 'true');

                    setAuthState({
                      user: data.user,
                      isAuthenticated: true,
                      isLoading: false,
                    });
                  } catch (error) {
                    console.error('Dev login failed:', error);
                    setAuthState(prev => ({ ...prev, isLoading: false }));
                  }
                }}
                disabled={isLoading}
                className="inline-flex items-center px-3 py-2 border border-yellow-300 shadow-sm text-xs font-medium rounded-md text-yellow-800 bg-yellow-100 hover:bg-yellow-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-yellow-800 mr-1"></div>
                    登入中...
                  </div>
                ) : (
                  <div className="flex items-center">
                    <span className="mr-1">🔧</span>
                    開發登入
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="text-center">
          <p className="text-sm text-gray-600">
            只有授權的管理員才能存取此系統
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;

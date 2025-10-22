import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';
import { SignupTokenInfo } from '../types';

const ClinicSignupPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [tokenInfo, setTokenInfo] = useState<SignupTokenInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      setError('缺少邀請令牌');
      setLoading(false);
      return;
    }

    validateToken();
  }, [token]);

  const validateToken = async () => {
    try {
      setLoading(true);
      const data = await apiService.validateSignupToken(token!, 'clinic');
      setTokenInfo(data);
    } catch (err: any) {
      console.error('Token validation error:', err);
      if (err.response?.status === 400) {
        setError('邀請連結無效或已過期');
      } else if (err.response?.status === 409) {
        setError('此邀請連結已被使用');
      } else {
        setError('驗證邀請連結時發生錯誤');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    try {
      setCompleting(true);

      // Redirect to Google OAuth for clinic signup
      const response = await apiService.initiateClinicSignup(token!);
      window.location.href = response.auth_url;
    } catch (err) {
      console.error('Google signup error:', err);
      setError('啟動 Google 登入失敗，請稍後再試');
      setCompleting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error || !tokenInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-red-100">
              <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
              邀請連結無效
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600">
              {error || '此邀請連結可能已過期或已被使用'}
            </p>
          </div>

          <div className="mt-8">
            <button
              onClick={() => navigate('/')}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              返回首頁
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-primary-100">
            <span className="text-2xl">🏥</span>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            加入診所管理系統
          </h2>
        </div>

        {/* Token Info Card */}
        <div className="bg-white py-8 px-6 shadow rounded-lg sm:px-10">
          <div className="space-y-4">

            <div className="text-center">
              <p className="text-sm text-gray-600 mb-4">
                點擊下方按鈕使用 Google 帳號完成註冊
              </p>

              <button
                onClick={handleGoogleSignup}
                disabled={completing}
                className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {completing ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    處理中...
                  </div>
                ) : (
                  <div className="flex items-center">
                    <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
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
                    使用 Google 帳號註冊
                  </div>
                )}
              </button>
            </div>

            <div className="mt-6 text-center">
              <p className="text-xs text-gray-500">
                註冊完成後，您將成為診所的管理員，並可以邀請其他團隊成員加入。
              </p>
            </div>
          </div>
        </div>

        <div className="text-center">
          <p className="text-sm text-gray-600">
            已經有帳號了嗎？{' '}
            <button
              onClick={() => navigate('/')}
              className="font-medium text-primary-600 hover:text-primary-500"
            >
              返回登入頁面
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default ClinicSignupPage;

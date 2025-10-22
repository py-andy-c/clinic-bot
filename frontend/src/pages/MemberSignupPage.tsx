import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';
import { SignupTokenInfo } from '../types';

const MemberSignupPage: React.FC = () => {
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
      const data = await apiService.validateSignupToken(token!, 'member');
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

      // Redirect to Google OAuth for member signup
      const response = await apiService.initiateMemberSignup(token!);
      window.location.href = response.auth_url;
    } catch (err: any) {
      console.error('Member signup error:', err);
      if (err.response?.status === 400) {
        setError('邀請連結無效或已過期');
      } else if (err.response?.status === 409) {
        setError('此邀請連結已被使用');
      } else {
        setError('註冊失敗，請稍後再試');
      }
      setCompleting(false);
    }
  };

  const getRoleDisplay = (roles: string[]) => {
    if (roles.includes('admin') && roles.includes('practitioner')) {
      return '管理員 & 治療師';
    } else if (roles.includes('admin')) {
      return '管理員';
    } else if (roles.includes('practitioner')) {
      return '治療師';
    }
    return '一般使用者';
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
            <span className="text-2xl">👥</span>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            加入診所團隊
          </h2>
        </div>

        {/* Token Info Card */}
        <div className="bg-white py-8 px-6 shadow rounded-lg sm:px-10">
          <div className="space-y-4">

            {/* Role Description */}
            <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h4 className="text-sm font-medium text-blue-800">
                    您的權限
                  </h4>
                  <div className="mt-2 text-sm text-blue-700">
                    {tokenInfo.default_roles?.includes('admin') && tokenInfo.default_roles?.includes('practitioner') && (
                      <p>您將擁有完整的診所管理權限，並可以管理預約和 Google Calendar 同步。</p>
                    )}
                    {tokenInfo.default_roles?.includes('admin') && !tokenInfo.default_roles?.includes('practitioner') && (
                      <p>您將擁有完整的診所管理權限，可以管理團隊成員、患者和設定。</p>
                    )}
                    {!tokenInfo.default_roles?.includes('admin') && tokenInfo.default_roles?.includes('practitioner') && (
                      <p>您將可以管理自己的預約，並設定 Google Calendar 同步。</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="text-center">
              <p className="text-sm text-gray-600 mb-4">
                點擊下方按鈕使用 Google 帳號完成加入
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
                    使用 Google 帳號加入
                  </div>
                )}
              </button>
            </div>

            <div className="mt-6 text-center">
              <p className="text-xs text-gray-500">
                加入後，您將能夠存取診所的管理系統，並根據您的角色權限使用相應功能。
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

export default MemberSignupPage;

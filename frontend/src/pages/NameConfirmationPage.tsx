import React, { useState, useEffect } from 'react';
import { logger } from '../utils/logger';
import { LoadingSpinner } from '../components/shared';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';

interface NameConfirmationData {
  email: string;
  google_name: string;
  roles: string[];
  clinic_name?: string;
}

const NameConfirmationPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationData, setConfirmationData] = useState<NameConfirmationData | null>(null);
  const [fullName, setFullName] = useState('');

  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      setError('缺少確認令牌');
      setLoading(false);
      return;
    }

    // Parse the token to extract user data
    try {
      // For now, we'll decode the JWT token on the frontend to get the data
      // In a production app, you might want to make an API call to validate the token
      if (!token) {
        setError('缺少確認令牌');
        setLoading(false);
        return;
      }
      
      const tokenParts = token.split('.');
      if (tokenParts.length !== 3) {
        setError('無效的確認令牌格式');
        setLoading(false);
        return;
      }
      const payload = JSON.parse(atob(tokenParts[1]!));
      
      if (payload.type !== 'name_confirmation') {
        setError('無效的確認令牌');
        setLoading(false);
        return;
      }

      setConfirmationData({
        email: payload.email || '',
        google_name: payload.google_name || '',
        roles: payload.roles || [],
        clinic_name: payload.clinic_name
      });
      
      // Prepopulate with Google name
      setFullName(payload.google_name || '');
      setLoading(false);
    } catch (err) {
      logger.error('Token parsing error:', err);
      setError('無效的確認令牌格式');
      setLoading(false);
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!fullName.trim()) {
      setError('請輸入您的姓名');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      
      const response = await apiService.confirmName(token!, fullName.trim());
      
      // Set refresh token as cookie
      if (response.refresh_token) {
        document.cookie = `refresh_token=${response.refresh_token}; path=/; max-age=${7 * 24 * 60 * 60}; secure; samesite=strict`;
      }
      
      // Redirect to dashboard
      window.location.href = response.redirect_url;
    } catch (err: any) {
      logger.error('Name confirmation error:', err);
      if (err.response?.status === 400) {
        setError(err.response.data.detail || '姓名確認失敗');
      } else if (err.response?.status === 401) {
        setError('確認令牌已過期，請重新註冊');
      } else {
        setError('姓名確認失敗，請稍後再試');
      }
      setSubmitting(false);
    }
  };

  const isPractitioner = confirmationData?.roles.includes('practitioner');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  if (error && !confirmationData) {
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
              確認失敗
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600">
              {error}
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
            <svg className="h-6 w-6 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            確認您的姓名
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            請確認或編輯您的姓名，這將用於您的帳戶
          </p>
        </div>

        <div className="bg-white py-8 px-6 shadow rounded-lg sm:px-10">
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                電子郵件
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={confirmationData?.email || ''}
                  disabled
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 bg-gray-50 text-gray-500 sm:text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="fullName" className="block text-sm font-medium text-gray-700">
                姓名 *
              </label>
              <div className="mt-1">
                <input
                  id="fullName"
                  name="fullName"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  placeholder="請輸入您的姓名"
                />
              </div>
              {isPractitioner && (
                <p className="mt-2 text-sm text-amber-600">
                  <svg className="inline h-4 w-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  如果您是醫療人員，此姓名將作為患者可見的姓名
                </p>
              )}
            </div>

            {error && (
              <div className="rounded-md bg-red-50 p-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-800">
                      {error}
                    </h3>
                  </div>
                </div>
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={submitting || !fullName.trim()}
                className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    處理中...
                  </div>
                ) : (
                  '完成註冊'
                )}
              </button>
            </div>
          </form>
        </div>

        <div className="text-center">
          <p className="text-sm text-gray-600">
            已經有帳號了嗎？{' '}
            <button
              onClick={() => navigate('/login')}
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

export default NameConfirmationPage;

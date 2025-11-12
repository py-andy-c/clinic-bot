import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useModal } from '../contexts/ModalContext';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';

interface SignupPageProps {
  signupType: 'clinic' | 'member';
  title: string;
  icon: string;
  buttonText: string;
  onSignup: (token: string) => Promise<{ auth_url: string }>;
}

const SignupPage: React.FC<SignupPageProps> = ({
  title,
  icon,
  buttonText,
  onSignup,
  signupType
}) => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, user, switchClinic, refreshAvailableClinics } = useAuth();
  const { alert } = useModal();
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [showJoinConfirmation, setShowJoinConfirmation] = useState(false);
  const [clinicName, setClinicName] = useState<string>('');
  const [joining, setJoining] = useState(false);

  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      setError('缺少邀請令牌');
      return;
    }

    // Check if user is already authenticated (only for member signup)
    if (signupType === 'member' && isAuthenticated && user) {
      // User is logged in - show join confirmation instead of OAuth
      setShowJoinConfirmation(true);
    }
  }, [token, isAuthenticated, user, signupType]);

  const handleGoogleSignup = async () => {
    try {
      setCompleting(true);
      const response = await onSignup(token!);
      window.location.href = response.auth_url;
    } catch (err: any) {
      logger.error('Signup error:', err);
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

  const handleJoinExisting = async () => {
    if (!token) return;

    try {
      setJoining(true);
      setError(null);

      const result = await apiService.joinClinicAsExistingUser(token, clinicName || undefined);

      // Refresh available clinics list
      await refreshAvailableClinics();

      // Optionally switch to the new clinic
      if (result.switch_clinic && result.clinic_id) {
        try {
          await switchClinic(result.clinic_id);
          await alert(
            `已成功加入 ${result.clinic.name}！`,
            '成功'
          );
          navigate('/admin');
        } catch (switchError: any) {
          // If switch fails, still show success but don't switch
          logger.error('Failed to switch clinic after joining:', switchError);
          await alert(
            `已成功加入 ${result.clinic.name}！您可以在右上角切換診所。`,
            '成功'
          );
          navigate('/admin');
        }
      } else {
        await alert(
          `已成功加入 ${result.clinic.name}！您可以在右上角切換診所。`,
          '成功'
        );
        navigate('/admin');
      }
    } catch (err: any) {
      logger.error('Join clinic error:', err);
      if (err.response?.status === 400) {
        const detail = err.response?.data?.detail || '無法加入診所';
        if (detail.includes('已經是此診所的成員')) {
          setError('您已經是此診所的成員');
        } else if (detail.includes('已失效')) {
          setError('邀請連結已失效，請聯繫診所管理員');
        } else {
          setError(detail);
        }
      } else if (err.response?.status === 403) {
        setError('您沒有權限加入此診所');
      } else {
        setError('加入診所失敗，請稍後再試');
      }
      setJoining(false);
    }
  };

  // Show join confirmation dialog for existing authenticated users
  if (showJoinConfirmation && isAuthenticated && user) {
    const currentClinicName = user.active_clinic_id && user.available_clinics
      ? user.available_clinics.find(c => c.id === user.active_clinic_id)?.name || '目前診所'
      : '目前診所';

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-primary-100">
              <span className="text-2xl">{icon}</span>
            </div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
              加入新診所
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600">
              您已經登入為 <strong>{currentClinicName}</strong>
            </p>
          </div>

          <div className="bg-white py-8 px-6 shadow rounded-lg sm:px-10">
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-700 mb-4">
                  要加入這個新診所嗎？加入後，您可以在右上角切換診所。
                </p>
                
                {/* Optional name input */}
                <div className="mb-4">
                  <label htmlFor="clinic-name" className="block text-sm font-medium text-gray-700 mb-1">
                    在此診所的顯示名稱（選填）
                  </label>
                  <input
                    id="clinic-name"
                    type="text"
                    value={clinicName}
                    onChange={(e) => setClinicName(e.target.value)}
                    placeholder={user.full_name || '您的名稱'}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm px-3 py-2 border"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    如果不填寫，將使用您目前的名稱
                  </p>
                </div>

                {error && (
                  <div className="mb-4 rounded-md bg-red-50 p-3">
                    <p className="text-sm text-red-800">{error}</p>
                  </div>
                )}
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={() => navigate('/admin')}
                  disabled={joining}
                  className="flex-1 py-2 px-4 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={handleJoinExisting}
                  disabled={joining}
                  className="flex-1 py-2 px-4 border border-transparent rounded-md text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {joining ? (
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      加入中...
                    </div>
                  ) : (
                    '加入診所'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !token) {
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
            <span className="text-2xl">{icon}</span>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            {title}
          </h2>
        </div>

        {/* Token Info Card */}
        <div className="bg-white py-8 px-6 shadow rounded-lg sm:px-10">
          <div className="space-y-4">
            <div className="text-center">
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
                    {buttonText}
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="text-center">
          <p className="text-sm text-gray-600">
            已經有帳號了嗎？{' '}
            <button
              onClick={() => window.location.href = '/admin/login'}
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

export default SignupPage;

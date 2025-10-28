import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiService } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { ClinicDashboardStats } from '../types';

const ClinicDashboardPage: React.FC = () => {
  const { user, isPractitioner, isClinicAdmin } = useAuth();
  const [stats, setStats] = useState<ClinicDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        const data = await apiService.getClinicDashboard();
        setStats(data);
      } catch (err) {
        setError('無法載入儀表板數據');
        console.error('Dashboard stats error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 text-lg font-medium mb-2">載入失敗</div>
        <p className="text-gray-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="md:flex md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight">
            診所儀表板
          </h2>
        </div>
      </div>

      {/* LINE Booking Disabled Warning - Visible to all clinic members */}
      {stats && !stats.clinic_readiness.is_ready && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-red-800">
                LINE 預約功能未啟用
              </h3>
              <div className="mt-2 text-sm text-red-700">
                <p>以下設定必須完成才能開始接受 LINE 預約：</p>
                <ul className="mt-1 list-disc list-inside space-y-1">
                  {stats.clinic_readiness.missing_appointment_types && (
                    <li>
                      設定預約類型
                      <Link to="/clinic/settings" className="ml-2 underline hover:text-red-800">
                        前往設定
                      </Link>
                    </li>
                  )}
                  {stats.clinic_readiness.practitioners_with_availability_count === 0 && (
                    <li>沒有任何治療師設定了可用時間</li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Practitioner Availability List - Visible to clinic admin only */}
      {stats && isClinicAdmin && stats.clinic_readiness.practitioners_without_availability.length > 0 && (
        <div className="bg-orange-50 border-l-4 border-orange-400 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-orange-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-orange-800">
                治療師可用時間設定提醒
              </h3>
              <div className="mt-2 text-sm text-orange-700">
                <p>以下治療師尚未設定可用時間：</p>
                <ul className="mt-1 list-disc list-inside">
                  {stats.clinic_readiness.practitioners_without_availability.map(practitioner => (
                    <li key={practitioner.id}>
                      {practitioner.name}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Individual Practitioner Warning */}
      {stats && user && isPractitioner && (() => {
        const currentUserWithoutAvailability = stats.clinic_readiness.practitioners_without_availability.find(
          p => p.id === user.user_id
        );
        if (currentUserWithoutAvailability) {
          return (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3 flex-1">
                  <h3 className="text-sm font-medium text-yellow-800">
                    請設定您的可用時間
                  </h3>
                  <div className="mt-2 text-sm text-yellow-700">
                    <p>您需要設定可用時間才能讓病患預約您的時段。</p>
                    <p className="mt-2">
                      <Link to="/clinic/availability" className="underline hover:text-yellow-800 font-medium">
                        前往設定可用時間
                      </Link>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          );
        }
        return null;
      })()}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">總預約數</dt>
                  <dd className="text-lg font-medium text-gray-900">{stats?.total_appointments || 0}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">即將到來的預約</dt>
                  <dd className="text-lg font-medium text-gray-900">{stats?.upcoming_appointments || 0}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">新病患</dt>
                  <dd className="text-lg font-medium text-gray-900">{stats?.new_patients || 0}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">團隊成員</dt>
                  <dd className="text-lg font-medium text-gray-900">{stats?.total_members || 0}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">取消率</dt>
                  <dd className="text-lg font-medium text-gray-900">
                    {stats?.cancellation_rate ? `${(stats.cancellation_rate * 100).toFixed(1)}%` : '0%'}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Embedded Calendar */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <div className="px-4 py-5 sm:px-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg leading-6 font-medium text-gray-900">預約行事曆</h3>
              <p className="mt-1 max-w-2xl text-sm text-gray-500">
                所有治療師的 Google 日曆整合檢視
              </p>
            </div>
            <button
              onClick={() => window.open('https://calendar.google.com', '_blank')}
              className="btn-secondary text-sm"
            >
              在 Google 日曆中開啟
            </button>
          </div>
        </div>
        <div className="border-t border-gray-200">
          <div className="p-4">
            <EmbeddedCalendar />
          </div>
        </div>
      </div>

      {/* Recent Activity Placeholder */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <div className="px-4 py-5 sm:px-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900">最近活動</h3>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            診所的最新活動和系統更新
          </p>
        </div>
        <div className="border-t border-gray-200">
          <ul role="list" className="divide-y divide-gray-200">
            <li className="px-4 py-4 sm:px-6">
              <div className="flex items-center space-x-4">
                <div className="flex-shrink-0">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-600">系統初始化完成</p>
                  <p className="text-xs text-gray-500">剛剛</p>
                </div>
              </div>
            </li>
            <li className="px-4 py-4 sm:px-6">
              <div className="flex items-center space-x-4">
                <div className="flex-shrink-0">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-600">提醒系統已啟動</p>
                  <p className="text-xs text-gray-500">1 小時前</p>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

// Embedded Calendar Component
const EmbeddedCalendar: React.FC = () => {
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCalendarEmbed = async () => {
      try {
        setLoading(true);
        const data = await apiService.getCalendarEmbed();
        setEmbedUrl(data.embed_url);
      } catch (err) {
        console.error('Failed to load calendar embed:', err);
        setError('無法載入行事曆');
      } finally {
        setLoading(false);
      }
    };

    fetchCalendarEmbed();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error || !embedUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-gray-500">
        <svg className="w-12 h-12 mb-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="text-lg font-medium">行事曆載入失敗</p>
        <p className="text-sm text-center mt-2">
          {error || '請確認至少有一位治療師已設定 Google 日曆同步'}
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <iframe
        src={embedUrl}
        style={{ border: 0 }}
        width="100%"
        height="600"
        frameBorder="0"
        scrolling="no"
        title="Clinic Appointment Calendar"
        className="rounded-lg"
      />
    </div>
  );
};

export default ClinicDashboardPage;

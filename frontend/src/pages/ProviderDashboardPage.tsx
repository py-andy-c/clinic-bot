import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';

interface ProviderStats {
  total_clinics: number;
  active_clinics: number;
  total_therapists: number;
  total_patients: number;
  recent_appointments: number;
  monthly_revenue: number;
  churn_rate: number;
}

const ProviderDashboardPage: React.FC = () => {
  const [stats, setStats] = useState<ProviderStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        const data = await apiService.getProviderDashboard();
        setStats(data);
      } catch (err) {
        setError('無法載入統計數據');
        console.error('Provider dashboard error:', err);
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
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">服務商儀表板</h1>
        <p className="text-gray-600">系統整體運營統計</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <span className="text-2xl">🏥</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">總診所數</p>
              <p className="text-2xl font-bold text-gray-900">
                {stats?.total_clinics || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <span className="text-2xl">✅</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">活躍診所</p>
              <p className="text-2xl font-bold text-gray-900">
                {stats?.active_clinics || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <span className="text-2xl">👨‍⚕️</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">總治療師數</p>
              <p className="text-2xl font-bold text-gray-900">
                {stats?.total_therapists || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <span className="text-2xl">👥</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">總病患數</p>
              <p className="text-2xl font-bold text-gray-900">
                {stats?.total_patients || 0}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Additional Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card">
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-900">
              {stats?.recent_appointments || 0}
            </div>
            <div className="text-sm text-gray-600">最近30天預約</div>
          </div>
        </div>

        <div className="card">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">
              ${stats?.monthly_revenue || 0}
            </div>
            <div className="text-sm text-gray-600">月營收</div>
          </div>
        </div>

        <div className="card">
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">
              {stats?.churn_rate ? `${(stats.churn_rate * 100).toFixed(1)}%` : '0%'}
            </div>
            <div className="text-sm text-gray-600">流失率</div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card">
        <h2 className="text-lg font-medium text-gray-900 mb-4">快速操作</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <button className="btn-primary">
            新增診所
          </button>
          <button className="btn-secondary">
            查看所有診所
          </button>
          <button className="btn-secondary">
            系統設定
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProviderDashboardPage;

import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';

interface Clinic {
  id: number;
  name: string;
  line_channel_id: string;
  subscription_status: 'trial' | 'active' | 'past_due' | 'canceled';
  trial_ends_at: string | null;
  therapist_count: number;
  patient_count: number;
  admin_count: number;
  created_at: string;
}

const ProviderClinicsPage: React.FC = () => {
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchClinics();
  }, []);

  const fetchClinics = async () => {
    try {
      setLoading(true);
      const data = await apiService.getProviderClinics();
      setClinics(data);
    } catch (err) {
      setError('無法載入診所列表');
      console.error('Fetch clinics error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddClinic = async (clinicData: any) => {
    try {
      setAdding(true);
      await apiService.createProviderClinic(clinicData);
      setShowAddModal(false);
      await fetchClinics(); // Refresh the list
    } catch (err) {
      console.error('Add clinic error:', err);
      alert('新增診所失敗，請稍後再試');
    } finally {
      setAdding(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      trial: { color: 'bg-yellow-100 text-yellow-800', text: '試用' },
      active: { color: 'bg-green-100 text-green-800', text: '活躍' },
      past_due: { color: 'bg-red-100 text-red-800', text: '逾期' },
      canceled: { color: 'bg-gray-100 text-gray-800', text: '取消' },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.trial;
    return (
      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${config.color}`}>
        {config.text}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">診所管理</h1>
          <p className="text-gray-600">管理系統中的所有診所</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="btn-primary"
        >
          新增診所
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {/* Clinics List */}
      <div className="card">
        <div className="space-y-4">
          {clinics.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">尚未有診所，點擊上方按鈕新增第一個診所</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      診所名稱
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      LINE Channel ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      狀態
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      統計
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      建立時間
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {clinics.map((clinic) => (
                    <tr key={clinic.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-3">
                            <span className="text-sm">🏥</span>
                          </div>
                          <div className="text-sm font-medium text-gray-900">
                            {clinic.name}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {clinic.line_channel_id}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(clinic.subscription_status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <div className="space-y-1">
                          <div>👨‍⚕️ {clinic.therapist_count} 治療師</div>
                          <div>👥 {clinic.patient_count} 病患</div>
                          <div>👨‍💼 {clinic.admin_count} 管理員</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(clinic.created_at).toLocaleDateString('zh-TW')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Add Clinic Modal */}
      {showAddModal && (
        <AddClinicModal
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddClinic}
          adding={adding}
        />
      )}
    </div>
  );
};

// Add Clinic Modal Component
interface AddClinicModalProps {
  onClose: () => void;
  onAdd: (clinicData: any) => Promise<void>;
  adding: boolean;
}

const AddClinicModal: React.FC<AddClinicModalProps> = ({ onClose, onAdd, adding }) => {
  const [formData, setFormData] = useState({
    name: '',
    line_channel_id: '',
    line_channel_secret: '',
    line_channel_access_token: '',
    subscription_status: 'trial' as 'trial' | 'active',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.name && formData.line_channel_id && formData.line_channel_secret && formData.line_channel_access_token) {
      await onAdd(formData);
    }
  };

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 className="text-lg font-medium text-gray-900 mb-4">新增診所</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700">
              診所名稱
            </label>
            <input
              type="text"
              id="name"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              className="input mt-1"
              required
            />
          </div>

          <div>
            <label htmlFor="line_channel_id" className="block text-sm font-medium text-gray-700">
              LINE Channel ID
            </label>
            <input
              type="text"
              id="line_channel_id"
              value={formData.line_channel_id}
              onChange={(e) => handleChange('line_channel_id', e.target.value)}
              className="input mt-1"
              required
            />
          </div>

          <div>
            <label htmlFor="line_channel_secret" className="block text-sm font-medium text-gray-700">
              LINE Channel Secret
            </label>
            <input
              type="password"
              id="line_channel_secret"
              value={formData.line_channel_secret}
              onChange={(e) => handleChange('line_channel_secret', e.target.value)}
              className="input mt-1"
              required
            />
          </div>

          <div>
            <label htmlFor="line_channel_access_token" className="block text-sm font-medium text-gray-700">
              LINE Channel Access Token
            </label>
            <input
              type="password"
              id="line_channel_access_token"
              value={formData.line_channel_access_token}
              onChange={(e) => handleChange('line_channel_access_token', e.target.value)}
              className="input mt-1"
              required
            />
          </div>

          <div>
            <label htmlFor="subscription_status" className="block text-sm font-medium text-gray-700">
              訂閱狀態
            </label>
            <select
              id="subscription_status"
              value={formData.subscription_status}
              onChange={(e) => handleChange('subscription_status', e.target.value)}
              className="input mt-1"
            >
              <option value="trial">試用</option>
              <option value="active">活躍</option>
            </select>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              disabled={adding}
            >
              取消
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={adding || !formData.name || !formData.line_channel_id || !formData.line_channel_secret || !formData.line_channel_access_token}
            >
              {adding ? '新增中...' : '新增診所'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProviderClinicsPage;

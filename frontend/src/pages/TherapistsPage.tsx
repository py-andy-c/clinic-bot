import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import { Therapist } from '../types';

const TherapistsPage: React.FC = () => {
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    fetchTherapists();
  }, []);

  const fetchTherapists = async () => {
    try {
      setLoading(true);
      const data = await apiService.getTherapists();
      setTherapists(data);
    } catch (err) {
      setError('無法載入治療師列表');
      console.error('Fetch therapists error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleInviteTherapist = async (email: string, name: string) => {
    try {
      setInviting(true);
      await apiService.inviteTherapist(email, name);
      setShowInviteModal(false);
      await fetchTherapists(); // Refresh the list
    } catch (err) {
      console.error('Invite therapist error:', err);
      alert('邀請治療師失敗，請稍後再試');
    } finally {
      setInviting(false);
    }
  };

  const handleGcalAuth = async (therapistId: number) => {
    try {
      const response = await apiService.initiateTherapistGcalAuth(therapistId);
      window.open(response.auth_url, '_blank');
    } catch (err) {
      console.error('GCal auth error:', err);
      alert('啟動 Google Calendar 授權失敗');
    }
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
          <h1 className="text-2xl font-bold text-gray-900">治療師管理</h1>
          <p className="text-gray-600">管理診所的治療師和 Google Calendar 整合</p>
        </div>
        <button
          onClick={() => setShowInviteModal(true)}
          className="btn-primary"
        >
          邀請新治療師
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {/* Therapists List */}
      <div className="card">
        <div className="space-y-4">
          {therapists.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">尚未有治療師，點擊上方按鈕邀請第一位治療師</p>
            </div>
          ) : (
            therapists.map((therapist) => (
              <div key={therapist.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                    <span className="text-lg">👨‍⚕️</span>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-900">{therapist.name}</h3>
                    <p className="text-sm text-gray-500">{therapist.email}</p>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full ${therapist.gcal_sync_enabled ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                    <span className="text-sm text-gray-600">
                      {therapist.gcal_sync_enabled ? '已同步' : '未同步'}
                    </span>
                  </div>

                  {!therapist.gcal_sync_enabled && (
                    <button
                      onClick={() => handleGcalAuth(therapist.id)}
                      className="btn-secondary text-xs px-3 py-1"
                    >
                      設定 Calendar
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <InviteModal
          onClose={() => setShowInviteModal(false)}
          onInvite={handleInviteTherapist}
          inviting={inviting}
        />
      )}
    </div>
  );
};

// Invite Modal Component
interface InviteModalProps {
  onClose: () => void;
  onInvite: (email: string, name: string) => Promise<void>;
  inviting: boolean;
}

const InviteModal: React.FC<InviteModalProps> = ({ onClose, onInvite, inviting }) => {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (email && name) {
      await onInvite(email, name);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 className="text-lg font-medium text-gray-900 mb-4">邀請新治療師</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700">
              治療師姓名
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input mt-1"
              required
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              電子郵件
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input mt-1"
              required
            />
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              disabled={inviting}
            >
              取消
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={inviting || !email || !name}
            >
              {inviting ? '邀請中...' : '發送邀請'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TherapistsPage;

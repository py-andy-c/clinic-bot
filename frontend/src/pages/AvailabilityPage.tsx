import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import { useAuth } from '../hooks/useAuth';

interface PractitionerAvailability {
  id: number;
  user_id: number;
  day_of_week: number;
  day_name: string;
  day_name_zh: string;
  start_time: string;
  end_time: string;
  is_available: boolean;
  created_at?: string;
  updated_at?: string;
}

interface AvailabilityFormData {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

const DAYS_OF_WEEK = [
  { value: 0, label: '星期一', labelEn: 'Monday' },
  { value: 1, label: '星期二', labelEn: 'Tuesday' },
  { value: 2, label: '星期三', labelEn: 'Wednesday' },
  { value: 3, label: '星期四', labelEn: 'Thursday' },
  { value: 4, label: '星期五', labelEn: 'Friday' },
  { value: 5, label: '星期六', labelEn: 'Saturday' },
  { value: 6, label: '星期日', labelEn: 'Sunday' },
];

const AvailabilityPage: React.FC = () => {
  const { user } = useAuth();
  const [availability, setAvailability] = useState<PractitionerAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<AvailabilityFormData>({
    day_of_week: 0,
    start_time: '09:00',
    end_time: '18:00',
    is_available: true,
  });

  useEffect(() => {
    if (user?.user_id) {
      fetchAvailability();
    }
  }, [user]);

  const fetchAvailability = async () => {
    if (!user?.user_id) return;

    try {
      setLoading(true);
      const data = await apiService.getPractitionerAvailability(user.user_id);
      setAvailability(data);
    } catch (err) {
      setError('無法載入可用時間');
      console.error('Fetch availability error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddAvailability = () => {
    setEditingId(null);
    setFormData({
      day_of_week: 0,
      start_time: '09:00',
      end_time: '18:00',
      is_available: true,
    });
    setShowForm(true);
  };

  const handleEditAvailability = (item: PractitionerAvailability) => {
    setEditingId(item.id);
    setFormData({
      day_of_week: item.day_of_week,
      start_time: item.start_time,
      end_time: item.end_time,
      is_available: item.is_available,
    });
    setShowForm(true);
  };

  const handleSaveAvailability = async () => {
    if (!user?.user_id) return;

    try {
      setSaving(true);

      if (editingId) {
        await apiService.updatePractitionerAvailability(user.user_id, editingId, formData);
      } else {
        await apiService.createPractitionerAvailability(user.user_id, formData);
      }

      await fetchAvailability();
      setShowForm(false);
      setEditingId(null);
    } catch (err: any) {
      console.error('Save availability error:', err);
      setError(err.response?.data?.detail || '儲存失敗，請稍後再試');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAvailability = async (availabilityId: number) => {
    if (!user?.user_id || !confirm('確定要刪除這個時段嗎？')) return;

    try {
      await apiService.deletePractitionerAvailability(user.user_id, availabilityId);
      await fetchAvailability();
    } catch (err: any) {
      console.error('Delete availability error:', err);
      setError(err.response?.data?.detail || '刪除失敗，請稍後再試');
    }
  };

  const getAvailabilityForDay = (dayOfWeek: number) => {
    return availability.filter(item => item.day_of_week === dayOfWeek);
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
          <h1 className="text-2xl font-bold text-gray-900">我的可用時間</h1>
          <p className="text-gray-600">設定您每週的可用預約時段</p>
        </div>
        <button
          onClick={handleAddAvailability}
          className="btn-primary"
        >
          新增時段
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {/* Weekly Schedule */}
      <div className="card">
        <h2 className="text-lg font-medium text-gray-900 mb-6">每週可用時間</h2>

        <div className="space-y-4">
          {DAYS_OF_WEEK.map((day) => {
            const dayAvailability = getAvailabilityForDay(day.value);
            return (
              <div key={day.value} className="border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-medium text-gray-900">{day.label}</h3>
                  <button
                    onClick={handleAddAvailability}
                    className="text-sm text-primary-600 hover:text-primary-800"
                  >
                    + 新增時段
                  </button>
                </div>

                {dayAvailability.length === 0 ? (
                  <p className="text-gray-500 text-sm">尚未設定可用時段</p>
                ) : (
                  <div className="space-y-2">
                    {dayAvailability.map((item) => (
                      <div key={item.id} className="flex items-center justify-between bg-gray-50 p-3 rounded">
                        <div className="flex items-center space-x-4">
                          <span className={`w-3 h-3 rounded-full ${item.is_available ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                          <span className="font-medium">
                            {item.start_time} - {item.end_time}
                          </span>
                          <span className={`text-sm px-2 py-1 rounded ${item.is_available ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                            {item.is_available ? '可用' : '不可用'}
                          </span>
                        </div>
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleEditAvailability(item)}
                            className="text-blue-600 hover:text-blue-800 text-sm"
                          >
                            編輯
                          </button>
                          <button
                            onClick={() => handleDeleteAvailability(item.id)}
                            className="text-red-600 hover:text-red-800 text-sm"
                          >
                            刪除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Add/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                {editingId ? '編輯時段' : '新增時段'}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    星期幾
                  </label>
                  <select
                    value={formData.day_of_week}
                    onChange={(e) => setFormData({ ...formData, day_of_week: parseInt(e.target.value) })}
                    className="input"
                  >
                    {DAYS_OF_WEEK.map((day) => (
                      <option key={day.value} value={day.value}>
                        {day.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      開始時間
                    </label>
                    <input
                      type="time"
                      value={formData.start_time}
                      onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      結束時間
                    </label>
                    <input
                      type="time"
                      value={formData.end_time}
                      onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                      className="input"
                    />
                  </div>
                </div>

                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.is_available}
                      onChange={(e) => setFormData({ ...formData, is_available: e.target.checked })}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="ml-2 text-sm text-gray-700">設定為可用時段</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => setShowForm(false)}
                  className="btn-secondary"
                  disabled={saving}
                >
                  取消
                </button>
                <button
                  onClick={handleSaveAvailability}
                  className="btn-primary"
                  disabled={saving}
                >
                  {saving ? '儲存中...' : '儲存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AvailabilityPage;

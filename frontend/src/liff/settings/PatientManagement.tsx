import React, { useState, useEffect } from 'react';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { liffApiService } from '../../services/liffApi';

interface Patient {
  id: number;
  full_name: string;
  phone_number: string;
  created_at: string;
}

const PatientManagement: React.FC = () => {
  const { clinicId } = useAppointmentStore();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientPhone, setNewPatientPhone] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingPatientId, setEditingPatientId] = useState<number | null>(null);
  const [editPatientName, setEditPatientName] = useState('');
  const [editPatientPhone, setEditPatientPhone] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    loadPatients();
  }, [clinicId]);

  const loadPatients = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await liffApiService.getPatients();
      setPatients(response.patients);
    } catch (err) {
      console.error('Failed to load patients:', err);
      setError('無法載入就診人列表');
    } finally {
      setIsLoading(false);
    }
  };

  const validatePhoneNumber = (phone: string): boolean => {
    // Taiwanese phone number format: 09xxxxxxxx (10 digits)
    const phoneRegex = /^09\d{8}$/;
    return phoneRegex.test(phone.replace(/[\s\-\(\)]/g, ''));
  };

  const handleAddPatient = async () => {
    if (!newPatientName.trim() || !clinicId) return;

    // Validate phone number
    if (!newPatientPhone.trim()) {
      setError('請輸入手機號碼');
      return;
    }

    if (!validatePhoneNumber(newPatientPhone)) {
      setError('手機號碼格式不正確，請輸入09開頭的10位數字');
      return;
    }

    try {
      setIsAdding(true);
      setError(null);
      await liffApiService.createPatient({
        full_name: newPatientName.trim(),
        phone_number: newPatientPhone.replace(/[\s\-\(\)]/g, ''),
      });

      // Reload patients to get the full data including phone number
      await loadPatients();
      setNewPatientName('');
      setNewPatientPhone('');
      setShowAddForm(false);
    } catch (err: any) {
      console.error('Failed to add patient:', err);
      
      // Handle FastAPI validation errors (422) - detail is an array
      let errorMessage = '新增就診人失敗，請稍後再試';
      if (err?.response?.data?.detail) {
        const detail = err.response.data.detail;
        if (Array.isArray(detail)) {
          // Validation error: extract first error message
          errorMessage = detail[0]?.msg || detail[0]?.message || errorMessage;
        } else if (typeof detail === 'string') {
          // Regular error message
          errorMessage = detail;
        }
      }
      
      setError(errorMessage);
    } finally {
      setIsAdding(false);
    }
  };

  const handleStartEdit = (patient: Patient) => {
    setEditingPatientId(patient.id);
    setEditPatientName(patient.full_name);
    setEditPatientPhone(patient.phone_number);
    setError(null);
  };

  const handleCancelEdit = () => {
    setEditingPatientId(null);
    setEditPatientName('');
    setEditPatientPhone('');
    setError(null);
  };

  const handleUpdatePatient = async (patientId: number) => {
    if (!editPatientName.trim()) {
      setError('請輸入姓名');
      return;
    }

    if (!editPatientPhone.trim()) {
      setError('請輸入手機號碼');
      return;
    }

    if (!validatePhoneNumber(editPatientPhone)) {
      setError('手機號碼格式不正確，請輸入09開頭的10位數字');
      return;
    }

    try {
      setIsUpdating(true);
      setError(null);
      await liffApiService.updatePatient(patientId, {
        full_name: editPatientName.trim(),
        phone_number: editPatientPhone.replace(/[\s\-\(\)]/g, ''),
      });

      // Reload patients to get updated data
      await loadPatients();
      setEditingPatientId(null);
    } catch (err: any) {
      console.error('Failed to update patient:', err);
      
      // Handle FastAPI validation errors (422) - detail is an array
      let errorMessage = '更新就診人失敗，請稍後再試';
      if (err?.response?.data?.detail) {
        const detail = err.response.data.detail;
        if (Array.isArray(detail)) {
          // Validation error: extract first error message
          errorMessage = detail[0]?.msg || detail[0]?.message || errorMessage;
        } else if (typeof detail === 'string') {
          // Regular error message
          errorMessage = detail;
        }
      }
      
      setError(errorMessage);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeletePatient = async (patientId: number, patientName: string) => {
    // Check if this is the last patient
    if (patients.length <= 1) {
      alert('至少需保留一位就診人');
      return;
    }

    const confirmMessage = `確定要刪除就診人「${patientName}」？\n\n刪除後該就診人的所有預約記錄將無法查詢。`;

    if (!confirm(confirmMessage)) return;

    try {
      await liffApiService.deletePatient(patientId);
      setPatients(prev => prev.filter(p => p.id !== patientId));
    } catch (err) {
      console.error('Failed to delete patient:', err);
      alert('刪除就診人失敗，請稍後再試');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-md mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-md p-4 my-8">
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={loadPatients}
              className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700"
            >
              重試
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-md mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            個人設定
          </h1>
          <p className="text-gray-600">
            管理您的就診人資訊
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            就診人管理
          </h2>

          <div className="space-y-3 mb-6">
            {patients.map((patient) => (
              <div key={patient.id}>
                {editingPatientId === patient.id ? (
                  <div className="border border-gray-200 rounded-md p-4 bg-white">
                    <h3 className="font-medium text-gray-900 mb-3">編輯就診人</h3>
                    <input
                      type="text"
                      value={editPatientName}
                      onChange={(e) => setEditPatientName(e.target.value)}
                      placeholder="請輸入姓名"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md mb-3"
                    />
                    <input
                      type="tel"
                      value={editPatientPhone}
                      onChange={(e) => setEditPatientPhone(e.target.value)}
                      placeholder="請輸入手機號碼 (0912345678)"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md mb-3"
                    />
                    {error && (
                      <div className="bg-red-50 border border-red-200 rounded-md p-2 mb-3">
                        <p className="text-sm text-red-600">{error}</p>
                      </div>
                    )}
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleUpdatePatient(patient.id)}
                        disabled={isUpdating || !editPatientName.trim() || !editPatientPhone.trim()}
                        className="flex-1 bg-primary-600 text-white py-2 px-4 rounded-md hover:bg-primary-700 disabled:opacity-50"
                      >
                        {isUpdating ? '更新中...' : '確認'}
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="flex-1 bg-gray-100 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-200"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">{patient.full_name}</div>
                      <div className="text-sm text-gray-600 mt-1">{patient.phone_number}</div>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleStartEdit(patient)}
                        className="text-primary-600 hover:text-primary-800 text-sm font-medium"
                      >
                        編輯
                      </button>
                      {patients.length > 1 && (
                        <button
                          onClick={() => handleDeletePatient(patient.id, patient.full_name)}
                          className="text-red-600 hover:text-red-800 text-sm font-medium"
                        >
                          刪除
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="w-full bg-primary-50 text-primary-600 border-2 border-dashed border-primary-200 rounded-md py-3 px-4 hover:bg-primary-100 transition-colors flex items-center justify-center"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              新增就診人
            </button>
          )}

          {showAddForm && (
            <div className="border border-gray-200 rounded-md p-4">
              <h3 className="font-medium text-gray-900 mb-3">新增就診人</h3>
              <input
                type="text"
                value={newPatientName}
                onChange={(e) => setNewPatientName(e.target.value)}
                placeholder="請輸入姓名"
                className="w-full px-3 py-2 border border-gray-300 rounded-md mb-3"
                onKeyPress={(e) => e.key === 'Enter' && handleAddPatient()}
              />
              <input
                type="tel"
                value={newPatientPhone}
                onChange={(e) => setNewPatientPhone(e.target.value)}
                placeholder="請輸入手機號碼 (0912345678)"
                className="w-full px-3 py-2 border border-gray-300 rounded-md mb-3"
                onKeyPress={(e) => e.key === 'Enter' && handleAddPatient()}
              />
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-md p-2 mb-3">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}
              <div className="flex space-x-2">
                <button
                  onClick={handleAddPatient}
                  disabled={isAdding || !newPatientName.trim() || !newPatientPhone.trim()}
                  className="flex-1 bg-primary-600 text-white py-2 px-4 rounded-md hover:bg-primary-700 disabled:opacity-50"
                >
                  {isAdding ? '新增中...' : '確認'}
                </button>
                <button
                  onClick={() => {
                    setShowAddForm(false);
                    setNewPatientName('');
                    setNewPatientPhone('');
                    setError(null);
                  }}
                  className="flex-1 bg-gray-100 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-200"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PatientManagement;

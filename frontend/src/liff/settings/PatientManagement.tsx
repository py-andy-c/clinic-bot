import React, { useState, useEffect } from 'react';
import { logger } from '../../utils/logger';
import { LoadingSpinner, ErrorMessage, NameWarning } from '../../components/shared';
import { validatePhoneNumber } from '../../utils/phoneValidation';
import { ApiErrorType, getErrorMessage, AxiosErrorResponse } from '../../types';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { liffApiService } from '../../services/liffApi';
import { useModal } from '../../contexts/ModalContext';

interface Patient {
  id: number;
  full_name: string;
  phone_number: string;
  created_at: string;
}

const PatientManagement: React.FC = () => {
  const { clinicId } = useAppointmentStore();
  const { alert: showAlert, confirm: showConfirm } = useModal();
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
      logger.error('Failed to load patients:', err);
      setError('無法載入就診人列表');
    } finally {
      setIsLoading(false);
    }
  };


  const handleAddPatient = async () => {
    if (!newPatientName.trim() || !clinicId) return;

    // Validate phone number
    if (!newPatientPhone.trim()) {
      setError('請輸入手機號碼');
      return;
    }

    const phoneValidation = validatePhoneNumber(newPatientPhone);
    if (!phoneValidation.isValid && phoneValidation.error) {
      setError(phoneValidation.error);
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
    } catch (err: ApiErrorType) {
      logger.error('Failed to add patient:', err);
      
      setError(getErrorMessage(err));
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

    const phoneValidation = validatePhoneNumber(editPatientPhone);
    if (!phoneValidation.isValid && phoneValidation.error) {
      setError(phoneValidation.error);
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
    } catch (err: ApiErrorType) {
      logger.error('Failed to update patient:', err);
      
      setError(getErrorMessage(err));
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeletePatient = async (patientId: number, patientName: string) => {
    // Check if this is the last patient
    if (patients.length <= 1) {
      await showAlert('至少需保留一位就診人', '無法刪除');
      return;
    }

    const confirmed = await showConfirm(
      `確定要刪除就診人「${patientName}」？\n\n刪除後該就診人的所有預約記錄將無法查詢。`,
      '確認刪除'
    );

    if (!confirmed) return;

    try {
      await liffApiService.deletePatient(patientId);
      setPatients(prev => prev.filter(p => p.id !== patientId));
    } catch (err: ApiErrorType) {
      logger.error('Failed to delete patient:', err);

      // Handle specific error cases - use type guard for Axios error with response
      if (typeof err === 'object' && err && 'response' in err) {
        const axiosError = err as AxiosErrorResponse;
        if (axiosError.response?.status === 409) {
          if (axiosError.response.data?.detail === "Cannot delete patient with future appointments") {
          await showAlert('無法刪除此就診人，因為該就診人尚有未來的預約記錄。\n\n請先刪除或取消相關預約後再試。', '無法刪除');
          } else if (axiosError.response.data?.detail === "至少需保留一位就診人") {
          await showAlert('至少需保留一位就診人', '無法刪除');
          } else {
            await showAlert('刪除就診人失敗，請稍後再試', '刪除失敗');
          }
        } else {
          await showAlert('刪除就診人失敗，請稍後再試', '刪除失敗');
        }
      } else {
        await showAlert('刪除就診人失敗，請稍後再試', '刪除失敗');
      }
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-md mx-auto">
          <div className="my-8">
            <ErrorMessage message={error} onRetry={loadPatients} />
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
            就診人管理
          </h1>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">

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
                className="w-full px-3 py-2 border border-gray-300 rounded-md mb-2"
                onKeyPress={(e) => e.key === 'Enter' && handleAddPatient()}
              />
              <div className="mb-3">
                <NameWarning />
              </div>
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

import React, { useState, useEffect } from 'react';
import moment from 'moment-timezone';
import { logger } from '../../utils/logger';
import { LoadingSpinner, ErrorMessage, DateInput } from '../../components/shared';
import { formatDateForApi, formatDateForDisplay } from '../../utils/dateFormat';
import { validatePhoneNumber } from '../../utils/phoneValidation';
import { ApiErrorType, getErrorMessage, AxiosErrorResponse } from '../../types';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { liffApiService, AvailabilityNotificationResponse } from '../../services/liffApi';
import { useModal } from '../../contexts/ModalContext';
import { PatientForm, PatientFormData } from '../components/PatientForm';

interface Patient {
  id: number;
  full_name: string;
  phone_number: string;
  birthday?: string;
  created_at: string;
}

const PatientManagement: React.FC = () => {
  const { clinicId } = useAppointmentStore();
  const { alert: showAlert, confirm: showConfirm } = useModal();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [editingPatientId, setEditingPatientId] = useState<number | null>(null);
  const [editPatientName, setEditPatientName] = useState('');
  const [editPatientPhone, setEditPatientPhone] = useState('');
  const [editPatientBirthday, setEditPatientBirthday] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [requireBirthday, setRequireBirthday] = useState(false);
  const [notifications, setNotifications] = useState<AvailabilityNotificationResponse[]>([]);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [isCancellingNotification, setIsCancellingNotification] = useState<number | null>(null);

  useEffect(() => {
    loadPatients();
    loadNotifications();
  }, [clinicId]);

  // Fetch clinic settings to check if birthday is required
  useEffect(() => {
    const fetchClinicSettings = async () => {
      if (!clinicId) return;
      try {
        const clinicInfo = await liffApiService.getClinicInfo();
        setRequireBirthday(clinicInfo.require_birthday || false);
      } catch (err) {
        logger.error('Failed to fetch clinic settings:', err);
        // Don't block if we can't fetch settings
      }
    };
    fetchClinicSettings();
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

  const loadNotifications = async () => {
    try {
      setIsLoadingNotifications(true);
      const response = await liffApiService.listAvailabilityNotifications('active');
      setNotifications(response.notifications);
    } catch (err) {
      logger.error('Failed to load notifications:', err);
    } finally {
      setIsLoadingNotifications(false);
    }
  };

  const handleCancelNotification = async (notificationId: number) => {
    const confirmed = await showConfirm(
      '取消通知',
      '確定要取消這個空位通知嗎？'
    );
    if (!confirmed) return;

    try {
      setIsCancellingNotification(notificationId);
      await liffApiService.cancelAvailabilityNotification(notificationId);
      await loadNotifications();
      showAlert('成功', '已取消通知');
    } catch (err) {
      logger.error('Failed to cancel notification:', err);
      showAlert('錯誤', '取消通知失敗，請稍後再試');
    } finally {
      setIsCancellingNotification(null);
    }
  };

  const formatTimeWindows = (windows: string[]): string => {
    const labels: Record<string, string> = {
      morning: '上午',
      afternoon: '下午',
      evening: '晚上',
    };
    return windows.map((w) => labels[w] || w).join('、');
  };


  const handleAddPatient = async (formData: PatientFormData) => {
    try {
      setIsAdding(true);
      setError(null);
      await liffApiService.createPatient(formData);

      // Reload patients to get the full data including phone number
      await loadPatients();
      setShowAddForm(false);
    } catch (err: ApiErrorType) {
      logger.error('Failed to add patient:', err);
      setError(getErrorMessage(err));
      throw err; // Re-throw so PatientForm can handle it
    } finally {
      setIsAdding(false);
    }
  };

  const handleStartEdit = (patient: Patient) => {
    setEditingPatientId(patient.id);
    setEditPatientName(patient.full_name);
    setEditPatientPhone(patient.phone_number);
    setEditPatientBirthday(formatDateForDisplay(patient.birthday));
    setError(null);
  };

  const handleCancelEdit = () => {
    setEditingPatientId(null);
    setEditPatientName('');
    setEditPatientPhone('');
    setEditPatientBirthday('');
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
      const updateData: { full_name?: string; phone_number?: string; birthday?: string } = {
        full_name: editPatientName.trim(),
        phone_number: editPatientPhone.replace(/[\s\-\(\)]/g, ''),
      };
      if (editPatientBirthday.trim()) {
        updateData.birthday = formatDateForApi(editPatientBirthday.trim());
      }
      await liffApiService.updatePatient(patientId, updateData);

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
                    <div className="mb-3">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        姓名
                      </label>
                      <input
                        type="text"
                        value={editPatientName}
                        onChange={(e) => setEditPatientName(e.target.value)}
                        placeholder="請輸入姓名"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      />
                    </div>
                    <div className="mb-3">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        手機號碼
                      </label>
                      <input
                        type="tel"
                        value={editPatientPhone}
                        onChange={(e) => setEditPatientPhone(e.target.value)}
                        placeholder="請輸入手機號碼 (0912345678)"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      />
                    </div>
                    {requireBirthday && (
                      <div className="mb-3">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          生日
                        </label>
                        <DateInput
                          value={editPatientBirthday}
                          onChange={setEditPatientBirthday}
                          className="w-full"
                        />
                      </div>
                    )}
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
                      {patient.birthday && (
                        <div className="text-sm text-gray-500 mt-1">生日: {formatDateForDisplay(patient.birthday)}</div>
                      )}
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
              <PatientForm
                clinicId={clinicId}
                requireBirthday={requireBirthday}
                onSubmit={handleAddPatient}
                onCancel={() => {
                    setShowAddForm(false);
                    setError(null);
                  }}
                error={error}
                isLoading={isAdding}
              />
            </div>
          )}
        </div>

        {/* Notifications Section */}
        <div className="mt-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">我的通知設定</h2>
          <div className="bg-white rounded-lg shadow-md p-6">
            {isLoadingNotifications ? (
              <div className="flex items-center justify-center py-8">
                <LoadingSpinner size="sm" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">目前沒有設定任何通知</p>
                <p className="text-sm text-gray-400 mt-2">在預約流程中可以設定空位通知</p>
              </div>
            ) : (
              <div className="space-y-3">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className="border border-gray-200 rounded-md p-4"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">
                          {moment.tz(notification.date, 'Asia/Taipei').format('YYYY年MM月DD日')}
                        </div>
                        <div className="text-sm text-gray-600 mt-1">
                          {notification.appointment_type_name}
                        </div>
                        {notification.practitioner_name && (
                          <div className="text-sm text-gray-600">
                            治療師：{notification.practitioner_name}
                          </div>
                        )}
                        <div className="text-sm text-gray-600 mt-1">
                          時段：{formatTimeWindows(notification.time_windows)}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          到期時間：{moment.tz(notification.expires_at, 'Asia/Taipei').format('YYYY-MM-DD HH:mm')}
                        </div>
                      </div>
                      <button
                        onClick={() => handleCancelNotification(notification.id)}
                        disabled={isCancellingNotification === notification.id}
                        className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50"
                      >
                        {isCancellingNotification === notification.id ? '取消中...' : '取消'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PatientManagement;

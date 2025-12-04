import React, { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LoadingSpinner, ErrorMessage } from '../components/shared';
import { apiService } from '../services/api';
import { Patient } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useApiData, invalidateCacheForFunction } from '../hooks/useApiData';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../types/api';
import { useModal } from '../contexts/ModalContext';
import PageHeader from '../components/PageHeader';
import { PatientInfoSection } from '../components/patient/PatientInfoSection';
import { PatientAppointmentsList } from '../components/patient/PatientAppointmentsList';

const PatientDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const { alert } = useModal();
  const [isEditing, setIsEditing] = useState(false);

  const patientId = id ? parseInt(id, 10) : null;

  const fetchPatient = useCallback(
    () => {
      if (!patientId) {
        return Promise.reject(new Error('Invalid patient ID'));
      }
      return apiService.getPatient(patientId);
    },
    [patientId]
  );

  const { data: patient, loading, error, refetch, setData } = useApiData<Patient>(
    fetchPatient,
    {
      enabled: !!patientId,
      dependencies: [patientId],
      defaultErrorMessage: '無法載入病患資料',
      // Cache key now includes patientId via dependencies, so caching is safe
    }
  );

  const canEdit = hasRole && (hasRole('admin') || hasRole('practitioner'));

  const handleUpdate = async (data: {
    full_name?: string;
    phone_number?: string | null;
    birthday?: string;
  }) => {
    if (!patientId) return;

    try {
      // Update patient and get the updated data
      const updatedPatient = await apiService.updatePatient(patientId, data);

      // Immediately update the displayed data with the response
      setData(updatedPatient);

      // Invalidate cache to ensure future fetches get fresh data
      invalidateCacheForFunction(fetchPatient);

      setIsEditing(false);
      await alert('病患資料已更新');
    } catch (err: any) {
      logger.error('Update patient error:', err);
      const errorMessage = getErrorMessage(err);
      await alert(errorMessage || '更新病患資料失敗');
      throw err;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  if (error || !patient) {
    return (
      <div className="max-w-4xl mx-auto">
        <ErrorMessage
          message={error || '無法載入病患資料'}
          onRetry={refetch}
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-4">
        <button
          onClick={() => navigate('/admin/clinic/patients')}
          className="text-blue-600 hover:text-blue-800 font-medium mb-2"
        >
          ← 返回病患列表
        </button>
      </div>
      <PageHeader title={patient.full_name} />

      {patient.is_deleted && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start">
            <span className="text-amber-600 mr-2">⚠️</span>
            <p className="text-sm text-amber-800">
              此病患已自行刪除帳號。病患無法自行預約，但診所仍可查看、編輯此病患資料，並為其安排預約。
            </p>
          </div>
        </div>
      )}

      <div className="space-y-6">
        <PatientInfoSection
          patient={patient}
          isEditing={isEditing}
          onEdit={() => setIsEditing(true)}
          onCancel={() => setIsEditing(false)}
          onUpdate={handleUpdate}
          canEdit={canEdit}
        />

        <PatientAppointmentsList patientId={patient.id} />
      </div>
    </div>
  );
};

export default PatientDetailPage;


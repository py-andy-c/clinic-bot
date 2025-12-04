import React, { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LoadingSpinner, ErrorMessage } from '../components/shared';
import { apiService, sharedFetchFunctions } from '../services/api';
import { Patient } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useApiData, invalidateCacheForFunction } from '../hooks/useApiData';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../types/api';
import { useModal } from '../contexts/ModalContext';
import PageHeader from '../components/PageHeader';
import { PatientInfoSection } from '../components/patient/PatientInfoSection';
import { PatientAppointmentsList } from '../components/patient/PatientAppointmentsList';
import { CreateAppointmentModal } from '../components/calendar/CreateAppointmentModal';

const PatientDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasRole, isLoading: authLoading, isAuthenticated } = useAuth();
  const { alert } = useModal();
  const [isEditing, setIsEditing] = useState(false);
  const [isAppointmentModalOpen, setIsAppointmentModalOpen] = useState(false);

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
  const canCreateAppointment = canEdit; // Same permissions as editing

  // Fetch clinic settings for appointment types
  const fetchClinicSettings = useCallback(() => apiService.getClinicSettings(), []);
  const { data: clinicSettings } = useApiData(
    fetchClinicSettings,
    {
      enabled: !authLoading && isAuthenticated,
      dependencies: [authLoading, isAuthenticated],
      defaultErrorMessage: '無法載入診所設定',
      cacheTTL: 5 * 60 * 1000, // 5 minutes cache
    }
  );

  // Fetch practitioners for appointment modal (lazy load when modal opens)
  const fetchPractitioners = useCallback(() => sharedFetchFunctions.getPractitioners(), []);
  const { data: practitionersData } = useApiData(
    fetchPractitioners,
    {
      enabled: !authLoading && isAuthenticated && isAppointmentModalOpen,
      dependencies: [authLoading, isAuthenticated, isAppointmentModalOpen],
      cacheTTL: 5 * 60 * 1000, // 5 minutes cache
    }
  );

  const practitioners = practitionersData || [];
  const appointmentTypes = clinicSettings?.appointment_types || [];

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
      <PageHeader 
        title={patient.full_name}
        action={
          canCreateAppointment ? (
            <button
              onClick={() => setIsAppointmentModalOpen(true)}
              className="btn btn-primary whitespace-nowrap flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              新增預約
            </button>
          ) : undefined
        }
      />

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

      {/* Create Appointment Modal */}
      {isAppointmentModalOpen && patientId !== null && (
        <CreateAppointmentModal
          preSelectedPatientId={patientId}
          initialDate={null}
          practitioners={practitioners}
          appointmentTypes={appointmentTypes}
          onClose={() => {
            setIsAppointmentModalOpen(false);
          }}
          onConfirm={async (formData) => {
            try {
              await apiService.createClinicAppointment(formData);
              setIsAppointmentModalOpen(false);
              
              // Invalidate appointments cache to refresh the list
              const fetchAppointments = () => apiService.getPatientAppointments(
                patientId,
                undefined,
                false
              );
              invalidateCacheForFunction(fetchAppointments);
              
              await alert('預約已建立');
            } catch (error) {
              logger.error('Error creating appointment:', error);
              const errorMessage = getErrorMessage(error);
              throw new Error(errorMessage);
            }
          }}
        />
      )}
    </div>
  );
};

export default PatientDetailPage;


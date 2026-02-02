import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LoadingSpinner, ErrorMessage } from '../components/shared';
import { apiService } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { usePatientDetail, useClinicSettings, usePractitioners } from '../hooks/queries';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateAppointmentOptimistic } from '../hooks/queries/useAvailabilitySlots';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../types/api';
import { useModal } from '../contexts/ModalContext';
import { extractAppointmentDateTime } from '../utils/timezoneUtils';
import { EMPTY_ARRAY } from '../utils/constants';
import { invalidatePatientDetail, invalidatePatientAppointments } from '../utils/reactQueryInvalidation';
import PageHeader from '../components/PageHeader';
import { PatientInfoSection } from '../components/patient/PatientInfoSection';
import { PatientNotesSection } from '../components/patient/PatientNotesSection';
import { PatientAssignedPractitionersSection } from '../components/patient/PatientAssignedPractitionersSection';
import { PatientAppointmentsList } from '../components/patient/PatientAppointmentsList';
import { CreateAppointmentModal } from '../components/calendar/CreateAppointmentModal';
import { PatientMedicalRecordsSection } from '../components/PatientMedicalRecordsSection';

const PatientDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasRole, user } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const { alert } = useModal();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [isEditingPractitioners, setIsEditingPractitioners] = useState(false);
  const [isAppointmentModalOpen, setIsAppointmentModalOpen] = useState(false);
  const appointmentsListRefetchRef = useRef<(() => Promise<void>) | null>(null);

  const patientId = id ? parseInt(id, 10) : undefined;

  // Scroll to top when component mounts or patientId changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [patientId]);

  const { data: patient, isLoading: loading, error, refetch } = usePatientDetail(patientId);

  const canEdit = hasRole && (hasRole('admin') || hasRole('practitioner'));
  const canCreateAppointment = canEdit; // Same permissions as editing

  // Fetch clinic settings for appointment types
  const { data: clinicSettings } = useClinicSettings();

  // Fetch practitioners (needed for edit/delete appointment buttons and create modal)
  const { data: practitionersData } = usePractitioners();

  // Optimistic update hook for appointment creation
  const createAppointmentMutation = useCreateAppointmentOptimistic();

  const practitioners = practitionersData || EMPTY_ARRAY;
  const appointmentTypes = clinicSettings?.appointment_types || EMPTY_ARRAY;

  const handleUpdate = async (data: {
    full_name?: string;
    phone_number?: string | null;
    birthday?: string;
    gender?: string;
    notes?: string | null;
    assigned_practitioner_ids?: number[];
  }) => {
    if (!patientId) return;

    try {
      // Update patient and get the updated data
      await apiService.updatePatient(patientId, data);

      // Invalidate cache to ensure future fetches get fresh data
      invalidatePatientDetail(queryClient, activeClinicId, patientId);

      setIsEditing(false);
      setIsEditingNotes(false);
      setIsEditingPractitioners(false);
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
          message={typeof error === 'string' ? error : error?.message || '無法載入病患資料'}
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

        <PatientNotesSection
          patient={patient}
          isEditing={isEditingNotes}
          onEdit={() => setIsEditingNotes(true)}
          onCancel={() => setIsEditingNotes(false)}
          onUpdate={handleUpdate}
          canEdit={canEdit}
        />

        <PatientAssignedPractitionersSection
          patient={patient}
          isEditing={isEditingPractitioners}
          onEdit={() => setIsEditingPractitioners(true)}
          onCancel={() => setIsEditingPractitioners(false)}
          onUpdate={handleUpdate}
          canEdit={canEdit}
          practitioners={practitioners}
        />

        <PatientAppointmentsList
          patientId={patient.id}
          practitioners={practitioners}
          appointmentTypes={appointmentTypes}
          onRefetchReady={(refetch) => {
            appointmentsListRefetchRef.current = refetch;
          }}
        />

        <PatientMedicalRecordsSection patientId={patient.id} />
      </div>

      {/* Create Appointment Modal */}
      {isAppointmentModalOpen && patientId !== undefined && (
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
              const { date, startTime } = extractAppointmentDateTime(formData.start_time);
              await createAppointmentMutation.mutateAsync({
                practitionerId: formData.practitioner_id,
                appointmentTypeId: formData.appointment_type_id,
                date,
                startTime,
                patientId: formData.patient_id,
                ...(formData.selected_resource_ids && { selectedResourceIds: formData.selected_resource_ids }),
                ...(formData.clinic_notes && { clinicNotes: formData.clinic_notes }),
              });
              setIsAppointmentModalOpen(false);

              // Trigger refetch of appointments list if available
              if (appointmentsListRefetchRef.current) {
                await appointmentsListRefetchRef.current();
              }

              await alert('預約已建立');
            } catch (error) {
              logger.error('Error creating appointment:', error);
              const errorMessage = getErrorMessage(error);
              throw new Error(errorMessage);
            }
          }}
          onRecurringAppointmentsCreated={async () => {
            // Invalidate appointments cache to refresh the list
            if (activeClinicId) {
              invalidatePatientAppointments(queryClient, activeClinicId, patientId);
            }

            // Trigger refetch of appointments list if available
            if (appointmentsListRefetchRef.current) {
              await appointmentsListRefetchRef.current();
            }
          }}
        />
      )}
    </div>
  );
};

export default PatientDetailPage;


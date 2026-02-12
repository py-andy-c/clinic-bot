import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
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
import { RecentPhotosRibbon } from '../components/RecentPhotosRibbon';
import { CreateMedicalRecordDialog } from '../components/CreateMedicalRecordDialog';
import { SendPatientFormDialog } from '../components/SendPatientFormDialog';
import { ActionMenu, ActionMenuItem } from '../components/ActionMenu';

type TabType = 'info' | 'appointments' | 'records' | 'photos';

const PatientDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasRole, user } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const { alert } = useModal();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [isEditingPractitioners, setIsEditingPractitioners] = useState(false);
  const [isAppointmentModalOpen, setIsAppointmentModalOpen] = useState(false);
  const [isCreateRecordModalOpen, setIsCreateRecordModalOpen] = useState(false);
  const [isSendFormModalOpen, setIsSendFormModalOpen] = useState(false);
  const appointmentsListRefetchRef = useRef<(() => Promise<void>) | null>(null);

  const patientId = id ? parseInt(id, 10) : undefined;

  // Get active tab from URL or default to 'info'
  const activeTab = (searchParams.get('tab') as TabType) || 'info';

  const setActiveTab = (tab: TabType) => {
    setSearchParams({ tab });
  };

  // Scroll to top when component mounts or patientId changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [patientId]);

  const { data: patient, isLoading: loading, error, refetch } = usePatientDetail(patientId);

  const canEdit = hasRole && (hasRole('admin') || hasRole('practitioner'));

  // Fetch clinic settings for appointment types (only when needed)
  const { data: clinicSettings } = useClinicSettings(
    activeTab === 'appointments' || isAppointmentModalOpen
  );

  // Fetch practitioners (only when needed)
  const { data: practitionersData } = usePractitioners({
    enabled: activeTab === 'appointments' || activeTab === 'info' || isAppointmentModalOpen,
  });

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

  // Handler for creating medical record
  const handleCreateMedicalRecord = () => {
    setIsCreateRecordModalOpen(true);
  };

  // Handler for uploading photo
  const [showPhotoUpload, setShowPhotoUpload] = useState(false);

  // Determine action button based on active tab
  const getHeaderAction = () => {
    if (!canEdit) return undefined;

    const items: ActionMenuItem[] = [];

    // 1. Appointment
    items.push({
      label: '新增預約',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      ),
      onClick: () => setIsAppointmentModalOpen(true),
      variant: 'primary',
    });

    // 2. Send Form
    items.push({
      label: '發送表單',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
      ),
      onClick: () => setIsSendFormModalOpen(true),
      variant: 'secondary',
    });

    // 3. Medical Record
    items.push({
      label: '新增病歷',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      onClick: handleCreateMedicalRecord,
    });

    // 4. Photo
    items.push({
      label: '上傳照片',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      onClick: () => {
        if (activeTab !== 'photos') {
          setActiveTab('photos');
          // Give a tiny delay for the tab to switch and RecentPhotosRibbon to mount
          setTimeout(() => setShowPhotoUpload(true), 100);
        } else {
          setShowPhotoUpload(true);
        }
      },
    });

    return <ActionMenu items={items} />;
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
        action={getHeaderAction()}
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

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-4 md:space-x-8 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('info')}
            className={`py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${activeTab === 'info'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
          >
            基本資料
          </button>
          <button
            onClick={() => setActiveTab('appointments')}
            className={`py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${activeTab === 'appointments'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
          >
            預約記錄
          </button>
          <button
            onClick={() => setActiveTab('records')}
            className={`py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${activeTab === 'records'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
          >
            病歷記錄
          </button>
          <button
            onClick={() => setActiveTab('photos')}
            className={`py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${activeTab === 'photos'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
          >
            照片
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {activeTab === 'info' && (
          <>
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
          </>
        )}

        {activeTab === 'appointments' && (
          <PatientAppointmentsList
            patientId={patient.id}
            practitioners={practitioners}
            appointmentTypes={appointmentTypes}
            onRefetchReady={(refetch) => {
              appointmentsListRefetchRef.current = refetch;
            }}
          />
        )}

        {activeTab === 'records' && (
          <PatientMedicalRecordsSection
            patientId={patient.id}
            hideCreateButton={true}
          />
        )}

        {activeTab === 'photos' && (
          <RecentPhotosRibbon
            clinicId={activeClinicId ?? null}
            patientId={patient.id}
            triggerUpload={showPhotoUpload}
            onUploadComplete={() => setShowPhotoUpload(false)}
            hideUploadButton={true}
          />
        )}
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

      {/* Create Medical Record Dialog */}
      {isCreateRecordModalOpen && patientId !== undefined && (
        <CreateMedicalRecordDialog
          patientId={patientId}
          onClose={() => setIsCreateRecordModalOpen(false)}
          onSuccess={(recordId) => {
            setIsCreateRecordModalOpen(false);
            navigate(`/admin/clinic/patients/${patientId}/records/${recordId}`);
          }}
        />
      )}

      {/* Send Patient Form Dialog */}
      {isSendFormModalOpen && patientId !== undefined && (
        <SendPatientFormDialog
          patientId={patientId}
          onClose={() => setIsSendFormModalOpen(false)}
          onSuccess={() => {
            setIsSendFormModalOpen(false);
            // The list update is handled by mutation invalidation in the hook
          }}
        />
      )}
    </div>
  );
};

export default PatientDetailPage;


import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  usePatientMedicalRecords,
  useDeleteMedicalRecord,
  useRestoreMedicalRecord,
  useHardDeleteMedicalRecord,
} from '../hooks/useMedicalRecords';
import { useModal } from '../contexts/ModalContext';
import { LoadingSpinner } from './shared';
import { MedicalRecord } from '../types/medicalRecord';
import { CreateMedicalRecordDialog } from './CreateMedicalRecordDialog';
import { PatientPhotoGallery } from './PatientPhotoGallery';
import { formatAppointmentDateTime } from '../utils/calendarUtils';
import { getErrorMessage } from '../types/api';
import { logger } from '../utils/logger';
import { MEDICAL_RECORD_RETENTION_DAYS } from '../constants/medicalRecords';

interface PatientMedicalRecordsSectionProps {
  patientId: number;
}

export const PatientMedicalRecordsSection: React.FC<PatientMedicalRecordsSectionProps> = ({
  patientId,
}) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const navigate = useNavigate();
  const { confirm, alert } = useModal();
  const [showDeleted, setShowDeleted] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Fetch active records
  const { data: activeData, isLoading: isLoadingActive, error: activeError } = usePatientMedicalRecords(
    activeClinicId ?? null,
    patientId,
    { include_deleted: false }
  );

  // Fetch deleted records only when needed
  const { data: deletedData, isLoading: isLoadingDeleted } = usePatientMedicalRecords(
    activeClinicId ?? null,
    patientId,
    { status: 'deleted' as const }, // Fetch only deleted records
    { enabled: showDeleted } // Only fetch when showDeleted is true
  );

  const deleteMutation = useDeleteMedicalRecord(activeClinicId ?? null, patientId);
  const restoreMutation = useRestoreMedicalRecord(activeClinicId ?? null, patientId);
  const hardDeleteMutation = useHardDeleteMedicalRecord(activeClinicId ?? null, patientId);

  const handleCreate = () => {
    setShowCreateDialog(true);
  };

  const handleCreateSuccess = (recordId: number) => {
    setShowCreateDialog(false);
    // Navigate to the full-page editor
    navigate(`/admin/clinic/patients/${patientId}/records/${recordId}`);
  };

  const handleOpen = (recordId: number) => {
    // Navigate to the full-page editor
    navigate(`/admin/clinic/patients/${patientId}/records/${recordId}`);
  };

  const handleDelete = async (recordId: number) => {
    const confirmed = await confirm(
      `此病歷將移至回收桶，${MEDICAL_RECORD_RETENTION_DAYS}天後自動刪除。確定刪除？`,
      '確認刪除'
    );
    if (!confirmed) return;

    try {
      await deleteMutation.mutateAsync(recordId);
      await alert('病歷已移至回收桶', '刪除成功');
    } catch (error) {
      logger.error('Failed to delete record:', error);
      await alert(getErrorMessage(error), '刪除失敗');
    }
  };

  const handleRestore = async (recordId: number) => {
    try {
      await restoreMutation.mutateAsync(recordId);
      await alert('病歷已成功還原', '還原成功');
    } catch (error) {
      logger.error('Failed to restore record:', error);
      await alert(getErrorMessage(error), '還原失敗');
    }
  };

  const handleHardDelete = async (recordId: number) => {
    const confirmed = await confirm(
      '此操作無法復原，確定永久刪除？',
      '確認永久刪除'
    );
    if (!confirmed) return;

    try {
      await hardDeleteMutation.mutateAsync(recordId);
      await alert('病歷已永久刪除', '刪除成功');
    } catch (error) {
      logger.error('Failed to permanently delete record:', error);
      await alert(getErrorMessage(error), '刪除失敗');
    }
  };

  if (isLoadingActive) {
    return (
      <div className="flex justify-center items-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (activeError) {
    return (
      <div className="text-center py-12 text-red-600">
        載入病歷記錄時發生錯誤
      </div>
    );
  }

  const activeRecords = activeData?.records || [];
  const deletedRecords = deletedData?.records || []; // No need to filter - backend returns only deleted records

  return (
    <>
      <div className="bg-white -mx-4 sm:mx-0 sm:rounded-lg shadow-none sm:shadow-md border-b sm:border-none border-gray-200 p-4 sm:p-6 mb-0 sm:mb-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-semibold text-gray-900">病歷記錄</h3>
          <button
            type="button"
            onClick={handleCreate}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            新增病歷
          </button>
        </div>

        {activeRecords.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            尚無病歷記錄
          </div>
        ) : (
          <div className="space-y-3">
            {activeRecords.map((record) => (
              <MedicalRecordCard
                key={record.id}
                record={record}
                onOpen={() => handleOpen(record.id)}
                onDelete={() => handleDelete(record.id)}
              />
            ))}
          </div>
        )}

        {/* Always show trash button - display "no records" message inside if empty */}
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowDeleted(!showDeleted)}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            {showDeleted ? '隱藏' : '查看'}最近刪除 {showDeleted && deletedRecords.length > 0 && `(${deletedRecords.length})`}
          </button>

          {showDeleted && (
            <div className="mt-3 space-y-2 border-t pt-3">
              {isLoadingDeleted ? (
                <div className="flex justify-center py-4">
                  <LoadingSpinner size="sm" />
                </div>
              ) : deletedRecords.length === 0 ? (
                <div className="text-center py-4 text-gray-500 text-sm">
                  尚無刪除記錄
                </div>
              ) : (
                deletedRecords.map((record) => (
                  <MedicalRecordCard
                    key={record.id}
                    record={record}
                    isDeleted
                    onRestore={() => handleRestore(record.id)}
                    onHardDelete={() => handleHardDelete(record.id)}
                  />
                ))
              )}
            </div>
          )}
        </div>

        {/* Create Dialog */}
        {showCreateDialog && (
          <CreateMedicalRecordDialog
            patientId={patientId}
            onClose={() => setShowCreateDialog(false)}
            onSuccess={handleCreateSuccess}
          />
        )}
      </div>

      {/* Photo Gallery Section */}
      <div className="bg-white -mx-4 sm:mx-0 sm:rounded-lg shadow-none sm:shadow-md border-b sm:border-none border-gray-200 p-4 sm:p-6 mb-0 sm:mb-6">
        <PatientPhotoGallery
          clinicId={activeClinicId ?? null}
          patientId={patientId}
          unlinkedOnly={true}
        />
      </div>
    </>
  );
};

interface MedicalRecordCardProps {
  record: MedicalRecord;
  isDeleted?: boolean;
  onOpen?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
  onHardDelete?: () => void;
}

const MedicalRecordCard: React.FC<MedicalRecordCardProps> = ({
  record,
  isDeleted,
  onOpen,
  onDelete,
  onRestore,
  onHardDelete,
}) => {
  // Check if record is empty (no values or all values are empty)
  const isEmpty = !record.values || Object.keys(record.values).length === 0 || 
    Object.values(record.values).every(v => v === '' || v === null || v === undefined);

  // Calculate permanent deletion date for soft-deleted records
  const permanentDeletionDate = isDeleted && record.deleted_at
    ? new Date(new Date(record.deleted_at).getTime() + MEDICAL_RECORD_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    : null;

  // Calculate days until permanent deletion
  const daysUntilDeletion = permanentDeletionDate
    ? Math.ceil((permanentDeletionDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div
      className={`p-4 border rounded-lg ${isDeleted ? 'bg-gray-50 border-gray-300' : 'bg-white border-gray-200 hover:border-primary-300'
        } transition-colors`}
    >
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-gray-900">
              {record.template_snapshot.name}
            </h4>
            {!isDeleted && isEmpty && (
              <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                空白
              </span>
            )}
          </div>
          
          {/* Metadata - Always Visible */}
          <div className="text-sm text-gray-600 mt-2 space-y-1">
            {/* Appointment Info */}
            {record.appointment && (
              <div>
                預約：{formatAppointmentDateTime(new Date(record.appointment.start_time))}
                {record.appointment.appointment_type && ` • ${record.appointment.appointment_type}`}
              </div>
            )}
            
            {/* Created Time */}
            <div>
              建立：{formatAppointmentDateTime(new Date(record.created_at))}
              {record.created_by_user_name && ` 由${record.created_by_user_name}`}
            </div>
            
            {/* Updated Time (only if different from created) */}
            {record.updated_at && new Date(record.updated_at).getTime() !== new Date(record.created_at).getTime() && (
              <div>
                編輯：{formatAppointmentDateTime(new Date(record.updated_at))}
                {record.updated_by_user_name && ` 由${record.updated_by_user_name}`}
              </div>
            )}
            
            {/* Deletion Info (for deleted records) */}
            {isDeleted && record.deleted_at && (
              <>
                <div>
                  刪除：{formatAppointmentDateTime(new Date(record.deleted_at))}
                  {record.updated_by_user_name && ` 由${record.updated_by_user_name}`}
                </div>
                {daysUntilDeletion !== null && daysUntilDeletion > 0 && (
                  <div className="text-red-600">
                    將於{daysUntilDeletion}天後永久刪除
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        {isDeleted ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onRestore}
              className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
            >
              還原
            </button>
            <button
              type="button"
              onClick={onHardDelete}
              className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
            >
              永久刪除
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onOpen}
              className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700"
            >
              開啟
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="px-3 py-1 text-sm text-red-600 hover:text-red-700 border border-red-600 rounded hover:bg-red-50"
            >
              刪除
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

import React, { useState } from 'react';
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
import { MedicalRecordModal } from './MedicalRecordModal';
import { formatDateOnly } from '../utils/calendarUtils';
import { getErrorMessage } from '../types/api';
import { logger } from '../utils/logger';

interface PatientMedicalRecordsSectionProps {
  patientId: number;
}

export const PatientMedicalRecordsSection: React.FC<PatientMedicalRecordsSectionProps> = ({
  patientId,
}) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const { confirm, alert } = useModal();
  const [showDeleted, setShowDeleted] = useState(false);
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    recordId: number | null;
    mode: 'create' | 'edit' | 'view';
  }>({
    isOpen: false,
    recordId: null,
    mode: 'create',
  });

  const { data, isLoading, error } = usePatientMedicalRecords(
    activeClinicId ?? null,
    patientId,
    { include_deleted: showDeleted }
  );

  const deleteMutation = useDeleteMedicalRecord(activeClinicId ?? null, patientId);
  const restoreMutation = useRestoreMedicalRecord(activeClinicId ?? null, patientId);
  const hardDeleteMutation = useHardDeleteMedicalRecord(activeClinicId ?? null, patientId);

  const handleCreate = () => {
    setModalState({ isOpen: true, recordId: null, mode: 'create' });
  };

  const handleView = (recordId: number) => {
    setModalState({ isOpen: true, recordId, mode: 'view' });
  };

  const handleEdit = (recordId: number) => {
    setModalState({ isOpen: true, recordId, mode: 'edit' });
  };

  const handleDelete = async (recordId: number) => {
    const confirmed = await confirm(
      '此病歷將移至回收桶，30天後自動刪除。確定刪除？',
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

  const closeModal = () => {
    setModalState({ isOpen: false, recordId: null, mode: 'create' });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-red-600">
        載入病歷記錄時發生錯誤
      </div>
    );
  }

  const records = data?.records || [];
  const activeRecords = records.filter(r => !r.is_deleted);
  const deletedRecords = records.filter(r => r.is_deleted);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-gray-900">病歷記錄</h3>
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
              onView={() => handleView(record.id)}
              onEdit={() => handleEdit(record.id)}
              onDelete={() => handleDelete(record.id)}
            />
          ))}
        </div>
      )}

      {deletedRecords.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowDeleted(!showDeleted)}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            {showDeleted ? '隱藏' : '查看'}最近刪除 ({deletedRecords.length})
          </button>

          {showDeleted && (
            <div className="mt-3 space-y-2 border-t pt-3">
              {deletedRecords.map((record) => (
                <MedicalRecordCard
                  key={record.id}
                  record={record}
                  isDeleted
                  onRestore={() => handleRestore(record.id)}
                  onHardDelete={() => handleHardDelete(record.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {modalState.isOpen && (
        <MedicalRecordModal
          patientId={patientId}
          recordId={modalState.recordId}
          mode={modalState.mode}
          onClose={closeModal}
        />
      )}
    </div>
  );
};

interface MedicalRecordCardProps {
  record: MedicalRecord;
  isDeleted?: boolean;
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
  onHardDelete?: () => void;
}

const MedicalRecordCard: React.FC<MedicalRecordCardProps> = ({
  record,
  isDeleted,
  onView,
  onEdit,
  onDelete,
  onRestore,
  onHardDelete,
}) => {
  return (
    <div
      className={`p-4 border rounded-lg ${
        isDeleted ? 'bg-gray-50 border-gray-300' : 'bg-white border-gray-200 hover:border-primary-300'
      } transition-colors`}
    >
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <h4 className="font-medium text-gray-900">
            {record.template_snapshot.name}
          </h4>
          <p className="text-sm text-gray-500 mt-1">
            {formatDateOnly(record.created_at)}
          </p>
          {isDeleted && record.deleted_at && (
            <p className="text-xs text-red-600 mt-1">
              已刪除於 {formatDateOnly(record.deleted_at)}
            </p>
          )}
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
              onClick={onView}
              className="px-3 py-1 text-sm text-primary-600 hover:text-primary-700 border border-primary-600 rounded hover:bg-primary-50"
            >
              查看
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700"
            >
              編輯
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

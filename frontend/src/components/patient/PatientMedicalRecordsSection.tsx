import React, { useState } from 'react';
import moment from 'moment-timezone';
import { usePatientMedicalRecords, useDeleteMedicalRecord } from '../../hooks/queries';
import { LoadingSpinner } from '../shared';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../types/api';
import { useModal } from '../../contexts/ModalContext';

const TAIWAN_TIMEZONE = 'Asia/Taipei';

const formatDate = (dateString: string, format: string = 'YYYY-MM-DD HH:mm'): string => {
  return moment(dateString).tz(TAIWAN_TIMEZONE).format(format);
};

interface PatientMedicalRecordsSectionProps {
  patientId: number;
  canEdit: boolean;
  onCreateRecord: () => void;
}

export const PatientMedicalRecordsSection: React.FC<PatientMedicalRecordsSectionProps> = ({
  patientId,
  canEdit,
  onCreateRecord,
}) => {
  const { alert, confirm } = useModal();
  const { data: records, isLoading, error, refetch } = usePatientMedicalRecords(patientId);
  const deleteMutation = useDeleteMedicalRecord();
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleDelete = async (recordId: number) => {
    const confirmed = await confirm('確定要刪除此病歷記錄嗎？此操作無法復原。');
    if (!confirmed) return;

    setDeletingId(recordId);
    try {
      await deleteMutation.mutateAsync({ recordId, patientId });
      await alert('病歷記錄已刪除');
    } catch (err) {
      logger.error('Delete medical record error:', err);
      const errorMessage = getErrorMessage(err);
      await alert(errorMessage || '刪除病歷記錄失敗');
    } finally {
      setDeletingId(null);
    }
  };

  const handleViewRecord = (recordId: number) => {
    // TODO: Navigate to medical record editor page when Phase 4 is implemented
    logger.info('View medical record:', recordId);
    alert('病歷編輯功能即將推出');
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">病歷記錄</h2>
        <div className="flex justify-center py-8">
          <LoadingSpinner />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">病歷記錄</h2>
        <div className="text-red-600 text-sm">
          載入病歷記錄失敗
          <button onClick={() => refetch()} className="ml-2 text-blue-600 hover:text-blue-800">
            重試
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">病歷記錄</h2>
        {canEdit && (
          <button
            onClick={onCreateRecord}
            className="btn btn-primary text-sm flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新增病歷
          </button>
        )}
      </div>

      {!records || records.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-gray-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="text-sm">尚無病歷記錄</p>
          {canEdit && (
            <button
              onClick={onCreateRecord}
              className="mt-4 text-blue-600 hover:text-blue-800 text-sm font-medium"
            >
              建立第一筆病歷記錄
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {records.map((record) => (
            <div
              key={record.id}
              className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-medium text-gray-900">
                      {record.template_name || '未命名範本'}
                    </h3>
                    <span className="text-xs text-gray-500">
                      #{record.id}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600 space-y-1">
                    <div>
                      建立時間：{formatDate(record.created_at, 'YYYY-MM-DD HH:mm')}
                    </div>
                    <div>
                      最後更新：{formatDate(record.updated_at, 'YYYY-MM-DD HH:mm')}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => handleViewRecord(record.id)}
                    className="text-blue-600 hover:text-blue-800 text-sm font-medium px-3 py-1 rounded hover:bg-blue-50"
                  >
                    查看
                  </button>
                  {canEdit && (
                    <button
                      onClick={() => handleDelete(record.id)}
                      disabled={deletingId === record.id}
                      className="text-red-600 hover:text-red-800 text-sm font-medium px-3 py-1 rounded hover:bg-red-50 disabled:opacity-50"
                    >
                      {deletingId === record.id ? '刪除中...' : '刪除'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

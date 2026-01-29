import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import moment from 'moment-timezone';
import { usePatientMedicalRecords, useDeleteMedicalRecord } from '../../hooks/queries';
import { apiService } from '../../services/api';
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
  const navigate = useNavigate();
  const { alert, confirm } = useModal();
  const { data: records, isLoading, error, refetch } = usePatientMedicalRecords(patientId);
  const deleteMutation = useDeleteMedicalRecord();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

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

  const handleDownloadPdf = async (recordId: number, date: string) => {
    setDownloadingId(recordId);
    try {
      const blob = await apiService.downloadMedicalRecordPDF(recordId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = moment(date).format('YYYYMMDD');
      a.download = `MedicalRecord_${recordId}_${dateStr}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      logger.error('Download PDF error:', err);
      await alert('產生 PDF 失敗，請稍後再試');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleViewRecord = (recordId: number) => {
    navigate(`/admin/clinic/patients/${patientId}/medical-records/${recordId}`);
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
        <div className="space-y-4">
          {records.map((record) => (
            <div
              key={record.id}
              className="group relative flex gap-4 p-4 border border-gray-100 rounded-xl hover:border-blue-200 hover:bg-blue-50/30 transition-all duration-200"
            >
              <div className="flex-none">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start mb-1">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900 truncate">
                      {record.template_name || '未命名範本'}
                    </h3>
                    <p className="text-xs text-gray-500 font-mono">#{record.id}</p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleDownloadPdf(record.id, record.created_at)}
                      disabled={downloadingId === record.id}
                      className="p-2 text-gray-500 hover:text-blue-600 hover:bg-white rounded-lg transition-colors"
                      title="下載 PDF"
                    >
                      {downloadingId === record.id ? (
                        <LoadingSpinner size="sm" />
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      )}
                    </button>
                    {canEdit && (
                      <button
                        onClick={() => handleDelete(record.id)}
                        disabled={deletingId === record.id}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-white rounded-lg transition-colors"
                        title="刪除病歷"
                      >
                        {deletingId === record.id ? (
                          <LoadingSpinner size="sm" />
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        )}
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                  <div className="flex items-center text-xs text-gray-500">
                    <svg className="w-3.5 h-3.5 mr-1.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    建立：{formatDate(record.created_at, 'YYYY-MM-DD HH:mm')}
                  </div>
                  <div className="flex items-center text-xs text-gray-500">
                    <svg className="w-3.5 h-3.5 mr-1.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    更新：{formatDate(record.updated_at, 'YYYY-MM-DD HH:mm')}
                  </div>
                </div>
                <div className="mt-3">
                  <button
                    onClick={() => handleViewRecord(record.id)}
                    className="w-full sm:w-auto px-4 py-1.5 bg-blue-50 text-blue-700 text-sm font-semibold rounded-lg hover:bg-blue-100 transition-colors"
                  >
                    開啟病歷編輯器
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

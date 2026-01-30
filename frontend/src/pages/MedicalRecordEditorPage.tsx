import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LoadingSpinner, ErrorMessage } from '../components/shared';
import { useMedicalRecord, useUpdateMedicalRecord } from '../hooks/queries';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../types/api';
import { useModal } from '../contexts/ModalContext';
import { useUnsavedChanges } from '../contexts/UnsavedChangesContext';
import PageHeader from '../components/PageHeader';
import { MedicalRecordHeader } from '../components/medical-records/MedicalRecordHeader';
import { ClinicalWorkspace } from '../components/medical-records/ClinicalWorkspace';
import { SyncStatus, SyncStatusType } from '../components/medical-records/SyncStatus';
import type { WorkspaceData } from '../types';

const MedicalRecordEditorPage: React.FC = () => {
  const { patientId, recordId } = useParams<{ patientId: string; recordId: string }>();
  const navigate = useNavigate();
  const { alert } = useModal();
  const { hasUnsavedChanges, setHasUnsavedChanges } = useUnsavedChanges();
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [pendingHeaderValues, setPendingHeaderValues] = useState<Record<string, string | string[] | number | boolean> | null>(null);
  const [pendingWorkspaceData, setPendingWorkspaceData] = useState<WorkspaceData | null>(null);
  const [lastUpdateType, setLastUpdateType] = useState<'toggle' | 'text'>('text');

  const recordIdNum = recordId ? parseInt(recordId, 10) : undefined;
  const patientIdNum = patientId ? parseInt(patientId, 10) : undefined;

  const { data: record, isLoading, error, refetch } = useMedicalRecord(recordIdNum);
  const updateMutation = useUpdateMedicalRecord();

  // Handle online/offline status - we don't need isOnline state anymore
  useEffect(() => {
    const handleOnline = () => {};
    const handleOffline = () => {};

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Determine current sync status
  const getSyncStatus = (): SyncStatusType => {
    if (isSaving) return 'saving';
    if (hasUnsavedChanges) return 'saving'; // Debouncing/Pending state
    if (lastSaved) return 'saved';
    return 'none';
  };

  // Initialize lastSaved with record.updated_at when record loads
  useEffect(() => {
    if (record?.updated_at) {
      setLastSaved(new Date(record.updated_at));
    }
  }, [record?.updated_at]);

  // Scroll to top when component mounts
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [recordIdNum]);

  // Clean up unsaved changes flag on unmount
  useEffect(() => {
    return () => {
      setHasUnsavedChanges(false);
    };
  }, [setHasUnsavedChanges]);

  // Consolidated autosave effect
  useEffect(() => {
    if (!pendingHeaderValues && !pendingWorkspaceData) return;

    const delay = lastUpdateType === 'toggle' ? 500 : 3000;

    const timer = setTimeout(async () => {
      if (!recordIdNum || !record) return;

      setIsSaving(true);
      const headerToSave = pendingHeaderValues || record.header_values;
      const workspaceToSave = pendingWorkspaceData || record.workspace_data;

      try {
        await updateMutation.mutateAsync({
          recordId: recordIdNum,
          data: {
            header_values: headerToSave,
            workspace_data: workspaceToSave,
            version: record.version,
          },
        });
        setLastSaved(new Date());
        setPendingHeaderValues(null);
        setPendingWorkspaceData(null);
        setHasUnsavedChanges(false);
        // After a successful save, we MUST refetch to get the new version number
        // from the server, which will then be passed down to children to clear their "Saving" state.
        refetch();
      } catch (err) {
        logger.error('Consolidated autosave error:', err);
        const errorMessage = getErrorMessage(err);
        if (errorMessage?.includes('CONCURRENCY_ERROR')) {
          // For autosave, we just refetch and let the user know if their change failed
          // instead of a blocking alert.
          refetch();
        }
      } finally {
        setIsSaving(false);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [pendingHeaderValues, pendingWorkspaceData, recordIdNum, record, updateMutation, refetch, setHasUnsavedChanges, lastUpdateType]);

  const handleHeaderUpdate = useCallback(async (headerValues: Record<string, string | string[] | number | boolean>, isToggle: boolean = false) => {
    setPendingHeaderValues(headerValues);
    setLastUpdateType(isToggle ? 'toggle' : 'text');
    setHasUnsavedChanges(true);
  }, [setHasUnsavedChanges]);

  const handleDirtyStateChange = useCallback((isDirty: boolean) => {
    setHasUnsavedChanges(isDirty || !!pendingHeaderValues || !!pendingWorkspaceData);
  }, [pendingHeaderValues, pendingWorkspaceData, setHasUnsavedChanges]);

  const handleWorkspaceUpdate = useCallback(async (workspaceData: WorkspaceData) => {
    setPendingWorkspaceData(workspaceData);
    setLastUpdateType('text'); // Workspace changes (drawing) use text-like long debounce
    setHasUnsavedChanges(true);
  }, [setHasUnsavedChanges]);

  const handleDownloadPdf = async () => {
    if (!recordIdNum) return;

    setIsDownloading(true);
    try {
      const blob = await apiService.downloadMedicalRecordPDF(recordIdNum);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date(record?.created_at || '').toISOString().split('T')[0];
      a.download = `MedicalRecord_${record?.id}_${dateStr}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      logger.error('Download PDF error:', err);
      await alert('產生 PDF 失敗，請稍後再試');
    } finally {
      setIsDownloading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  if (error || !record) {
    return (
      <div className="max-w-4xl mx-auto">
        <ErrorMessage
          message={typeof error === 'string' ? error : error?.message || '無法載入病歷記錄'}
          onRetry={refetch}
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-4">
        <button
          onClick={() => navigate(`/admin/clinic/patients/${patientIdNum}`)}
          className="text-blue-600 hover:text-blue-800 font-medium mb-2"
        >
          ← 返回病患詳情
        </button>
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <PageHeader title={record.template_name || '病歷記錄'} />
        <div className="flex items-center gap-4">
          <button
            onClick={handleDownloadPdf}
            disabled={isDownloading || hasUnsavedChanges}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={hasUnsavedChanges ? '請先儲存變更後再下載' : '下載 PDF'}
          >
            {isDownloading ? (
              <LoadingSpinner size="sm" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            )}
            下載 PDF
          </button>
          <SyncStatus status={getSyncStatus()} />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">記錄 ID</div>
          <div className="font-mono text-sm font-semibold text-gray-700">#{record.id}</div>
        </div>
        <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">建立時間</div>
          <div className="text-sm font-semibold text-gray-700">{new Date(record.created_at).toLocaleString('zh-TW')}</div>
        </div>
        <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">最後更新</div>
          <div className="text-sm font-semibold text-gray-700">
            {record.updated_at ? new Date(record.updated_at).toLocaleString('zh-TW') : '無'}
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Structured Header Section */}
        <MedicalRecordHeader
          headerStructure={record.header_structure}
          headerValues={record.header_values}
          onUpdate={handleHeaderUpdate}
          onDirtyStateChange={handleDirtyStateChange}
        />

        {/* Clinical Workspace Section - Phase 4 */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">臨床工作區</h2>
          <ClinicalWorkspace
            recordId={record.id}
            initialData={record.workspace_data}
            initialVersion={record.version}
            onUpdate={handleWorkspaceUpdate}
          />
        </div>
      </div>
    </div>
  );
};

export default MedicalRecordEditorPage;

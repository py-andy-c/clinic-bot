import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import type { WorkspaceData, MedicalRecord } from '../types';

const MedicalRecordEditorPage: React.FC = () => {
  const { patientId, recordId } = useParams<{ patientId: string; recordId: string }>();
  const navigate = useNavigate();
  const { alert } = useModal();
  const { hasUnsavedChanges, setHasUnsavedChanges, onSaveRef } = useUnsavedChanges();
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [pendingHeaderValues, setPendingHeaderValues] = useState<Record<string, string | string[] | number | boolean> | null>(null);
  const [pendingWorkspaceData, setPendingWorkspaceData] = useState<WorkspaceData | null>(null);
  const [lastUpdateType, setLastUpdateType] = useState<'toggle' | 'text'>('text');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Refs for background saving access without closure issues
  const pendingHeaderValuesRef = useRef<Record<string, string | string[] | number | boolean> | null>(null);
  const pendingWorkspaceDataRef = useRef<WorkspaceData | null>(null);
  const recordRef = useRef<MedicalRecord | null>(null);

  useEffect(() => {
    pendingHeaderValuesRef.current = pendingHeaderValues;
  }, [pendingHeaderValues]);

  useEffect(() => {
    pendingWorkspaceDataRef.current = pendingWorkspaceData;
  }, [pendingWorkspaceData]);

  const recordIdNum = recordId ? parseInt(recordId, 10) : undefined;
  const patientIdNum = patientId ? parseInt(patientId, 10) : undefined;

  const { data: record, isLoading, error, refetch } = useMedicalRecord(recordIdNum);
  const updateMutation = useUpdateMedicalRecord();

  useEffect(() => {
    recordRef.current = record || null;
  }, [record]);

  // Handle external navigation (refresh/tab close)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (hasUnsavedChanges) {
        const headerToSave = pendingHeaderValuesRef.current || recordRef.current?.header_values;
        const workspaceToSave = pendingWorkspaceDataRef.current || recordRef.current?.workspace_data;
        const currentVersion = recordRef.current?.version;

        if (recordIdNum && recordRef.current && currentVersion !== undefined) {
          // Trigger a background save with keepalive
          // We don't await this because the page is closing
          const updateData: Parameters<typeof apiService.updateMedicalRecord>[1] = {
            version: currentVersion,
          };
          if (headerToSave) updateData.header_values = headerToSave;
          if (workspaceToSave) updateData.workspace_data = workspaceToSave as unknown as Record<string, unknown>;

          apiService.updateMedicalRecord(recordIdNum, updateData, { keepalive: true }).catch(err => {
            logger.error('Background save failed:', err);
          });
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges, recordIdNum]);

  // Determine current sync status
  const getSyncStatus = (): SyncStatusType => {
    if (saveError) return 'error';
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
      onSaveRef.current = null;
    };
  }, [setHasUnsavedChanges, onSaveRef]);

  const performSave = useCallback(async () => {
    if (!recordIdNum || !recordRef.current || recordRef.current.version === undefined) return;
    if (!pendingHeaderValuesRef.current && !pendingWorkspaceDataRef.current) return;

    setIsSaving(true);
    const headerToSave = pendingHeaderValuesRef.current || recordRef.current.header_values;
    const workspaceToSave = pendingWorkspaceDataRef.current || recordRef.current.workspace_data;

    try {
      await updateMutation.mutateAsync({
        recordId: recordIdNum,
        data: {
          header_values: headerToSave,
          workspace_data: workspaceToSave,
          version: recordRef.current.version,
        },
      });
      setLastSaved(new Date());
      setPendingHeaderValues(null);
      setPendingWorkspaceData(null);
      setHasUnsavedChanges(false);
      setSaveError(null);
      // No need to manual refetch() as the mutation onSuccess now updates the query cache
    } catch (err) {
      logger.error('Manual/Flush save error:', err);
      const errorMessage = getErrorMessage(err);

      if (errorMessage?.includes('CONCURRENCY_ERROR')) {
        refetch();
      } else {
        // DO NOT clear pending changes here anymore.
        // Instead, keep them so the user can fix the issue and retry.
        setSaveError(errorMessage || '伺服器錯誤');
        // We still consider it as having unsaved changes
        setHasUnsavedChanges(true);
      }
    } finally {
      setIsSaving(false);
    }
  }, [recordIdNum, updateMutation, refetch, setHasUnsavedChanges]);

  // Register flush function for internal navigation
  useEffect(() => {
    onSaveRef.current = performSave;
  }, [performSave, onSaveRef]);

  // Consolidated autosave effect
  useEffect(() => {
    if (!pendingHeaderValues && !pendingWorkspaceData) return;
    if (saveError) return; // Pause autosave if there is an error

    const delay = lastUpdateType === 'toggle' ? 500 : 3000;

    const timer = setTimeout(async () => {
      await performSave();
    }, delay);

    return () => clearTimeout(timer);
  }, [pendingHeaderValues, pendingWorkspaceData, lastUpdateType, performSave, saveError]);

  const handleHeaderUpdate = useCallback(async (headerValues: Record<string, string | string[] | number | boolean>, isToggle: boolean = false) => {
    if (!record) return;

    // Deep equality check to avoid unnecessary saves on focus/blur
    const currentValues = pendingHeaderValues || record.header_values;
    if (JSON.stringify(headerValues) === JSON.stringify(currentValues)) {
      return;
    }

    setPendingHeaderValues(headerValues);
    setLastUpdateType(isToggle ? 'toggle' : 'text');
    setHasUnsavedChanges(true);
    setSaveError(null); // Clear error when user makes new changes
  }, [record, pendingHeaderValues, setHasUnsavedChanges]);

  const handleDirtyStateChange = useCallback((isDirty: boolean) => {
    setHasUnsavedChanges(isDirty || !!pendingHeaderValues || !!pendingWorkspaceData);
  }, [pendingHeaderValues, pendingWorkspaceData, setHasUnsavedChanges]);

  const handleWorkspaceUpdate = useCallback(async (workspaceData: WorkspaceData) => {
    if (!record) return;

    // Deep equality check to avoid unnecessary saves
    const currentData = pendingWorkspaceData || record.workspace_data;
    if (JSON.stringify(workspaceData) === JSON.stringify(currentData)) {
      return;
    }

    setPendingWorkspaceData(workspaceData);
    setLastUpdateType('text'); // Workspace changes (drawing) use text-like long debounce
    setHasUnsavedChanges(true);
    setSaveError(null); // Clear error when user makes new changes
  }, [record, pendingWorkspaceData, setHasUnsavedChanges]);

  const handleBack = async () => {
    if (hasUnsavedChanges) {
      await performSave();
    }
    navigate(`/admin/clinic/patients/${patientIdNum}`);
  };

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
    <>
      <div className="max-w-4xl mx-auto">
        <div className="mb-4">
          <button
            onClick={handleBack}
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
            <SyncStatus
              status={getSyncStatus()}
              errorMessage={saveError}
              onRetry={performSave}
            />
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

        <div className="space-y-6 mb-12">
          {/* Structured Header Section */}
          <MedicalRecordHeader
            headerStructure={record.header_structure}
            headerValues={record.header_values}
            onUpdate={handleHeaderUpdate}
            onDirtyStateChange={handleDirtyStateChange}
          />
        </div>
      </div>

      {/* Clinical Workspace Section - Phase 4 - Full Width Container */}
      <div className="bg-gray-200 border-t border-gray-300 min-h-screen">
        <div className="max-w-4xl mx-auto pt-12 px-4 sm:px-6 lg:px-8">
          <h2 className="text-xl font-semibold mb-6">臨床工作區</h2>
        </div>
        <ClinicalWorkspace
          key={record.id}
          recordId={record.id}
          initialData={record.workspace_data}
          onUpdate={handleWorkspaceUpdate}
          syncStatus={getSyncStatus()}
        />
      </div>
    </>
  );
};

export default MedicalRecordEditorPage;

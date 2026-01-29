import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LoadingSpinner, ErrorMessage } from '../components/shared';
import { useMedicalRecord, useUpdateMedicalRecord } from '../hooks/queries';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../types/api';
import { useModal } from '../contexts/ModalContext';
import { useUnsavedChanges } from '../contexts/UnsavedChangesContext';
import PageHeader from '../components/PageHeader';
import { MedicalRecordHeader } from '../components/medical-records/MedicalRecordHeader';
import { ClinicalWorkspace } from '../components/medical-records/ClinicalWorkspace';
import type { WorkspaceData } from '../types';

const MedicalRecordEditorPage: React.FC = () => {
  const { patientId, recordId } = useParams<{ patientId: string; recordId: string }>();
  const navigate = useNavigate();
  const { alert } = useModal();
  const { setHasUnsavedChanges } = useUnsavedChanges();
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const recordIdNum = recordId ? parseInt(recordId, 10) : undefined;
  const patientIdNum = patientId ? parseInt(patientId, 10) : undefined;

  const { data: record, isLoading, error, refetch } = useMedicalRecord(recordIdNum);
  const updateMutation = useUpdateMedicalRecord();

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

  const handleHeaderUpdate = useCallback(async (headerValues: Record<string, any>) => {
    if (!recordIdNum) return;

    setIsSaving(true);
    setHasUnsavedChanges(false); // Clear unsaved changes flag during save
    try {
      await updateMutation.mutateAsync({
        recordId: recordIdNum,
        data: { header_values: headerValues },
      });
      setLastSaved(new Date());
    } catch (err) {
      logger.error('Update medical record header error:', err);
      const errorMessage = getErrorMessage(err);
      await alert(errorMessage || '更新病歷記錄失敗');
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [recordIdNum, updateMutation, setHasUnsavedChanges, alert]);

  const handleDirtyStateChange = useCallback((isDirty: boolean) => {
    setHasUnsavedChanges(isDirty);
  }, [setHasUnsavedChanges]);

  const handleWorkspaceUpdate = useCallback(async (workspaceData: WorkspaceData) => {
    if (!recordIdNum) return;

    setIsSaving(true);
    setHasUnsavedChanges(false);
    try {
      await updateMutation.mutateAsync({
        recordId: recordIdNum,
        data: { workspace_data: workspaceData },
      });
      setLastSaved(new Date());
    } catch (err) {
      logger.error('Update medical record workspace error:', err);
      const errorMessage = getErrorMessage(err);
      await alert(errorMessage || '更新病歷工作區失敗');
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [recordIdNum, updateMutation, setHasUnsavedChanges, alert]);

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

      <PageHeader title={record.template_name || '病歷記錄'} />

      <div className="mb-4 text-sm text-gray-600 space-y-1">
        <div>記錄 ID: #{record.id}</div>
        <div>建立時間: {new Date(record.created_at).toLocaleString('zh-TW')}</div>
        {lastSaved && (
          <div className="text-green-600">
            最後儲存: {lastSaved.toLocaleTimeString('zh-TW')}
          </div>
        )}
      </div>

      {isSaving && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
          <LoadingSpinner size="sm" />
          <span className="text-sm text-blue-800">儲存中...</span>
        </div>
      )}

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
            onUpdate={handleWorkspaceUpdate}
            isSaving={isSaving}
          />
        </div>
      </div>
    </div>
  );
};

export default MedicalRecordEditorPage;

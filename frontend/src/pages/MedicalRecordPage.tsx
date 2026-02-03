import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { LoadingSpinner, ErrorMessage } from '../components/shared';
import { BaseModal } from '../components/shared/BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from '../components/shared/ModalParts';
import { MedicalRecordDynamicForm } from '../components/MedicalRecordDynamicForm';
import { MedicalRecordPhotoSelector } from '../components/MedicalRecordPhotoSelector';
import {
  useMedicalRecord,
  useUpdateMedicalRecord,
  medicalRecordKeys,
} from '../hooks/useMedicalRecords';
import { usePatientDetail } from '../hooks/queries';
import { usePatientAppointments } from '../hooks/queries/usePatientAppointments';
import { useAuth } from '../hooks/useAuth';
import { useModal } from '../contexts/ModalContext';
import { useUnsavedChangesDetection } from '../hooks/useUnsavedChangesDetection';
import { getErrorMessage } from '../types/api';
import { logger } from '../utils/logger';
import { AxiosError } from 'axios';
import { TemplateField } from '../types/medicalRecord';
import { formatAppointmentTimeRange } from '../utils/calendarUtils';

/**
 * Generate dynamic Zod schema based on template fields.
 * Modified to mark ALL fields as optional regardless of template's required flag.
 */
const createDynamicSchema = (fields: TemplateField[] | undefined) => {
  if (!fields || fields.length === 0) {
    return z.object({
      values: z.record(z.any()),
    });
  }

  const valuesShape: Record<string, z.ZodTypeAny> = {};

  fields.forEach((field) => {
    const fieldId = field.id;

    // All fields are optional for validation purposes
    let fieldSchema: z.ZodTypeAny;

    switch (field.type) {
      case 'text':
      case 'textarea':
      case 'dropdown':
      case 'radio':
        fieldSchema = z.string().optional();
        break;
      case 'number':
        fieldSchema = z.union([
          z.number(),
          z.string().transform(val => val === '' ? undefined : Number(val))
        ]).optional();
        break;
      case 'checkbox':
        fieldSchema = z.array(z.string()).optional();
        break;
      case 'date':
        fieldSchema = z.string().optional();
        break;
      default:
        fieldSchema = z.any().optional();
    }

    valuesShape[fieldId] = fieldSchema;
  });

  return z.object({
    values: z.object(valuesShape),
  });
};

type RecordFormData = {
  values: Record<string, any>;
  appointment_id?: number | null;
};

/**
 * Full-page editor for medical records.
 * Provides focused documentation experience with auto-save ready architecture.
 */
const MedicalRecordPage: React.FC = () => {
  const { patientId: patientIdParam, recordId: recordIdParam } = useParams<{
    patientId: string;
    recordId: string;
  }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const { alert } = useModal();

  const patientId = patientIdParam ? parseInt(patientIdParam, 10) : undefined;
  const recordId = recordIdParam ? parseInt(recordIdParam, 10) : undefined;

  const [selectedPhotoIds, setSelectedPhotoIds] = useState<number[]>([]);
  const [initialPhotoIds, setInitialPhotoIds] = useState<number[]>([]); // Track initial state
  const [conflictState, setConflictState] = useState<{
    show: boolean;
    currentRecord: any;
    updatedByUserName?: string;
    userChanges: RecordFormData;
  } | null>(null);

  // Fetch record
  const { data: record, isLoading: loadingRecord, error: recordError } = useMedicalRecord(
    activeClinicId ?? null,
    recordId ?? null
  );

  // Fetch patient info for header
  const { data: patient } = usePatientDetail(patientId);

  // Fetch appointments for re-linking
  const { data: appointments } = usePatientAppointments(patientId ?? 0);

  const updateMutation = useUpdateMedicalRecord(activeClinicId ?? null, patientId ?? 0);

  // Generate dynamic schema based on template fields
  const dynamicSchema = useMemo(
    () => createDynamicSchema(record?.template_snapshot?.fields),
    [record?.template_snapshot?.fields]
  );

  const methods = useForm<RecordFormData>({
    resolver: zodResolver(dynamicSchema),
    defaultValues: {
      values: {},
      appointment_id: null,
    },
    mode: 'onSubmit',
  });

  // Load record data
  useEffect(() => {
    if (record) {
      methods.reset({
        values: record.values || {},
        appointment_id: record.appointment_id ?? null,
      });
      // Initialize selected photos
      if (record.photos) {
        const photoIds = record.photos.map(p => p.id);
        setSelectedPhotoIds(photoIds);
        setInitialPhotoIds(photoIds); // Track initial state
      }
    }
  }, [record, methods]);

  // Calculate if there are unsaved changes (form + photos)
  const hasUnsavedChanges = () => {
    const formDirty = methods.formState.isDirty;
    const photosDirty = JSON.stringify(selectedPhotoIds.sort()) !== JSON.stringify(initialPhotoIds.sort());
    return formDirty || photosDirty;
  };

  // Setup unsaved changes detection
  useUnsavedChangesDetection({
    hasUnsavedChanges,
  });

  const handleBack = () => {
    // Navigation blocking is handled by useUnsavedChangesDetection hook
    navigate(`/admin/clinic/patients/${patientId}`);
  };

  const onSubmit = async (data: RecordFormData) => {
    if (!record) return;

    try {
      const updateData: {
        version: number;
        values?: Record<string, any>;
        appointment_id?: number | null;
        photo_ids?: number[];
      } = {
        version: record.version,
        values: data.values,
        appointment_id: data.appointment_id ?? null,
        photo_ids: selectedPhotoIds,
      };

      await updateMutation.mutateAsync({
        recordId: record.id,
        data: updateData,
      });
      await alert('病歷記錄已成功更新', '更新成功');
      methods.reset(data); // Reset form state to mark as not dirty
      setInitialPhotoIds([...selectedPhotoIds]); // Reset photo state
    } catch (error) {
      logger.error('Failed to save medical record:', error);

      // Handle version conflict (409)
      if (error instanceof AxiosError && error.response?.status === 409) {
        const errorDetail = error.response.data?.detail;
        const currentRecord = errorDetail?.current_record;
        const updatedByUserName = errorDetail?.updated_by_user_name;

        setConflictState({
          show: true,
          currentRecord,
          updatedByUserName,
          userChanges: data,
        });
      } else {
        await alert(getErrorMessage(error), '儲存失敗');
      }
    }
  };

  const handleConflictReload = () => {
    if (!activeClinicId || !recordId) return;

    // Invalidate query to get fresh data (including new version and photos)
    queryClient.invalidateQueries({
      queryKey: medicalRecordKeys.detail(activeClinicId, recordId)
    });
    setConflictState(null);
    // The useEffect will handle resetting form and photo state when fresh data arrives
  };

  const handleConflictForceSave = async () => {
    if (!conflictState || !record) return;

    try {
      const forceSaveData: {
        version: number;
        values?: Record<string, any>;
        photo_ids?: number[];
      } = {
        version: conflictState.currentRecord.version,
        values: conflictState.userChanges.values,
        photo_ids: selectedPhotoIds,
      };

      await updateMutation.mutateAsync({
        recordId: record.id,
        data: forceSaveData,
      });
      await alert('病歷記錄已強制儲存', '儲存成功');
      setConflictState(null);
      methods.reset(conflictState.userChanges);
    } catch (forceSaveError) {
      logger.error('Force save failed:', forceSaveError);
      await alert(getErrorMessage(forceSaveError), '強制儲存失敗');
      setConflictState(null);
    }
  };

  const handleConflictCancel = () => {
    setConflictState(null);
  };

  const isSaving = updateMutation.isPending;

  if (loadingRecord) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  if (recordError || !record || !patientId) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <ErrorMessage
          message="無法載入病歷記錄"
          onRetry={() => navigate(`/admin/clinic/patients/${patientId}`)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Back Button matching PatientDetailPage style */}
        <div className="mb-4">
          <button
            onClick={handleBack}
            className="text-blue-600 hover:text-blue-800 font-medium transition-colors"
          >
            ← 返回病患詳情
          </button>
        </div>

        {/* The "Document" - Clean, white-on-white with a subtle shadow/border */}
        <div className="bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-xl overflow-hidden border border-gray-100 mb-12">
          {/* Document Header */}
          <div className="px-10 pt-10 pb-8 border-b border-gray-100">
            <div className="flex justify-between items-start gap-6">
              <div className="flex-1 min-w-0">
                <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight truncate">
                  {record.template_snapshot.name}
                </h1>
                <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm text-gray-500">
                  <span className="flex items-center gap-2">
                    <span className="text-gray-400 font-medium uppercase tracking-wider text-[10px]">病患</span>
                    <span className="font-semibold text-gray-800">{patient?.full_name || '載入中...'}</span>
                  </span>
                  {record.created_at && (
                    <span className="flex items-center gap-2">
                      <span className="text-gray-400 font-medium uppercase tracking-wider text-[10px]">建立時間</span>
                      <span className="font-semibold text-gray-800">
                        {new Date(record.created_at).toLocaleString('zh-TW', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={methods.handleSubmit(onSubmit)}
                disabled={isSaving || !hasUnsavedChanges()}
                className="btn-primary px-10 py-3 text-base shadow-sm hover:shadow-md transition-all"
              >
                {isSaving ? '儲存中...' : '儲存變更'}
              </button>
            </div>

            {/* Appointment Context - Ultra Clean Selection */}
            <div className="mt-8 pt-8 border-t border-gray-100 flex flex-wrap items-center gap-6">
              <label htmlFor="appointment_id" className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                關聯預約
              </label>
              <div className="flex-1 max-w-sm relative">
                <select
                  id="appointment_id"
                  {...methods.register('appointment_id', {
                    setValueAs: (v) => v === '' ? null : parseInt(v)
                  })}
                  className="w-full text-sm appearance-none bg-white border border-gray-200 rounded-lg px-4 py-2.5 pr-10 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                >
                  <option value="">無關聯預約</option>
                  {appointments?.appointments
                    ?.filter((apt) => apt.status === 'confirmed')
                    .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
                    .map((apt) => {
                      const aptId = apt.calendar_event_id || apt.id;
                      const startDate = new Date(apt.start_time);
                      const endDate = new Date(apt.end_time);
                      const timeStr = formatAppointmentTimeRange(startDate, endDate);
                      const serviceName = apt.appointment_type_name || '預約';

                      return (
                        <option key={aptId} value={aptId}>
                          {timeStr} - {serviceName}
                        </option>
                      );
                    })}
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-gray-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              <span className="text-xs text-gray-400 italic">(與其他變更一起儲存)</span>
            </div>
          </div>

          {/* Document Content */}
          <div className="px-10 py-10">
            <FormProvider {...methods}>
              <form onSubmit={methods.handleSubmit(onSubmit)} className="space-y-16">
                {/* Dynamic Form Fields */}
                <section>
                  <div className="mb-8 flex items-baseline justify-between border-b border-gray-100 pb-3">
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight">病歷內容</h2>
                  </div>
                  <div className="max-w-3xl">
                    {record.template_snapshot?.fields && (
                      <MedicalRecordDynamicForm fields={record.template_snapshot.fields} />
                    )}
                  </div>
                </section>

                {/* Photo Selector */}
                <section>
                  <div className="mb-8 flex items-baseline justify-between border-b border-gray-100 pb-3">
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight">附加照片</h2>
                  </div>
                  <div className="bg-white rounded-xl">
                    <MedicalRecordPhotoSelector
                      clinicId={activeClinicId ?? null}
                      patientId={patientId}
                      selectedPhotoIds={selectedPhotoIds}
                      onPhotoIdsChange={setSelectedPhotoIds}
                      recordId={recordId ?? null}
                    />
                  </div>
                </section>
              </form>
            </FormProvider>
          </div>
        </div>
      </div>

      {/* Conflict Resolution Dialog */}
      {conflictState?.show && (
        <BaseModal onClose={handleConflictCancel}>
          <ModalHeader title="版本衝突" onClose={handleConflictCancel} />
          <ModalBody>
            <div className="space-y-4">
              <p className="text-gray-700">
                此病歷已被
                {conflictState.updatedByUserName ? (
                  <span className="font-semibold"> {conflictState.updatedByUserName} </span>
                ) : (
                  ' 其他使用者 '
                )}
                {conflictState.currentRecord?.updated_at && (
                  <>
                    在 <span className="font-semibold">
                      {new Date(conflictState.currentRecord.updated_at).toLocaleString('zh-TW')}
                    </span>{' '}
                  </>
                )}
                更新
              </p>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="text-sm text-yellow-800">
                  <strong>您可以選擇：</strong>
                </p>
                <ul className="mt-2 text-sm text-yellow-700 space-y-1 list-disc list-inside">
                  <li><strong>重新載入</strong>：查看最新版本（放棄您的變更）</li>
                  <li><strong>強制儲存</strong>：覆蓋對方的變更（保留您的變更）</li>
                  <li><strong>取消</strong>：繼續編輯</li>
                </ul>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <button
              type="button"
              onClick={handleConflictCancel}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConflictReload}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              重新載入
            </button>
            <button
              type="button"
              onClick={handleConflictForceSave}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              強制儲存
            </button>
          </ModalFooter>
        </BaseModal>
      )}
    </div>
  );
};

export default MedicalRecordPage;

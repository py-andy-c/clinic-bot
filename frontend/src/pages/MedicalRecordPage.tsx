import React, { useEffect, useState, useMemo, useCallback } from 'react';
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
import { getGenderLabel } from '../utils/genderUtils';
import { TemplateField, PatientPhoto } from '../types/medicalRecord';
import { formatAppointmentTimeRange } from '../utils/calendarUtils';
import { apiService } from '../services/api';

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
      case 'date':
        fieldSchema = z.string()
          .transform(val => (val === '' ? null : val))
          .nullable()
          .optional();
        break;
      case 'number':
        fieldSchema = z.union([
          z.number(),
          z.string().transform(val => val === '' ? undefined : Number(val)),
          z.null()
        ]).optional();
        break;
      case 'checkbox':
        fieldSchema = z.preprocess(
          (val) => {
            if (Array.isArray(val)) return val;
            if (val === null || val === undefined) return [];
            if (typeof val === 'boolean') return [];
            return [String(val)];
          },
          z.array(z.string())
        ).optional();
        break;
      default:
        fieldSchema = z.any().optional();
    }

    valuesShape[fieldId] = fieldSchema;
  });

  return z.object({
    values: z.object(valuesShape),
    appointment_id: z.number().nullable().optional(),
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
  const [photoUpdates, setPhotoUpdates] = useState<Record<number, Partial<PatientPhoto>>>({}); // Track photo description changes
  const [isSelectAppointmentModalOpen, setIsSelectAppointmentModalOpen] = useState(false);
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

  // Fetch appointments for re-linking - only when modal is open
  const { data: appointments, isLoading: loadingAppointments } = usePatientAppointments(patientId ?? 0, {
    enabled: isSelectAppointmentModalOpen
  });

  const updateMutation = useUpdateMedicalRecord(activeClinicId ?? null, patientId ?? 0);

  // Callback ref to auto-scroll to the selected item when it's rendered
  const scrollToSelected = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      node.scrollIntoView({ block: 'center' });
    }
  }, []);

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
    mode: 'onChange', // Changed to onChange for better UI feedback
  });

  // Destructure formState to ensure reactivity
  const { isDirty } = methods.formState;

  // Watch current appointment selection for real-time UI updates
  const currentAppointmentId = methods.watch('appointment_id');

  // Resolve the appointment object to display (either from initial record or from loaded appointments list)
  const displayAppointment = useMemo(() => {
    if (!currentAppointmentId) return null;

    // If it matches initial, use that data (most reliable when modal hasn't opened yet)
    if (currentAppointmentId === record?.appointment_id && record?.appointment) {
      return record.appointment;
    }

    // Otherwise look for it in the loaded appointments list (after user opens modal and picks one)
    return appointments?.appointments?.find(apt => apt.id === currentAppointmentId);
  }, [currentAppointmentId, record, appointments]);

  // Load record data
  useEffect(() => {
    if (record) {
      // Normalize nulls to empty strings for form compatibility
      const normalizedValues = { ...(record.values || {}) };
      record.template_snapshot?.fields?.forEach(field => {
        if (
          ['text', 'textarea', 'dropdown', 'radio', 'date'].includes(field.type) &&
          normalizedValues[field.id] === null
        ) {
          normalizedValues[field.id] = '';
        }
      });

      methods.reset({
        values: normalizedValues,
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
  const photosDirty = useMemo(() => {
    const idsChanged = JSON.stringify([...selectedPhotoIds].sort()) !== JSON.stringify([...initialPhotoIds].sort());
    const descriptionsChanged = Object.keys(photoUpdates).length > 0;
    return idsChanged || descriptionsChanged;
  }, [selectedPhotoIds, initialPhotoIds, photoUpdates]);

  const hasUnsavedChanges = useCallback(() => {
    return isDirty || photosDirty;
  }, [isDirty, photosDirty]);

  // Handle photo description updates
  const handlePhotoUpdate = useCallback((photoId: number, updates: Partial<PatientPhoto>) => {
    setPhotoUpdates(prev => ({
      ...prev,
      [photoId]: { ...prev[photoId], ...updates }
    }));
  }, []);

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

      // Save medical record first
      await updateMutation.mutateAsync({
        recordId: record.id,
        data: updateData,
      });

      // Save photo description updates with better error handling
      let photoUpdatesFailed = false;
      const failedPhotoIds: number[] = [];

      if (Object.keys(photoUpdates).length > 0) {
        const photoUpdatePromises = Object.entries(photoUpdates).map(([photoIdStr, updates]) => {
          const photoId = parseInt(photoIdStr, 10);
          return { photoId, promise: apiService.updatePatientPhoto(photoId, updates) };
        });

        const results = await Promise.allSettled(photoUpdatePromises.map(p => p.promise));

        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            photoUpdatesFailed = true;
            const photoId = photoUpdatePromises[index]?.photoId;
            if (photoId) {
              failedPhotoIds.push(photoId);
              logger.error(`Photo ${photoId} description update failed:`, result.reason);
            }
          }
        });
      }

      // Reset states after successful save
      methods.reset(methods.getValues()); // Use raw values for cleaner reset
      setInitialPhotoIds([...selectedPhotoIds]); // Reset photo state

      // Only clear successful photo updates, keep failed ones for retry
      if (photoUpdatesFailed) {
        const failedUpdates: Record<number, Partial<PatientPhoto>> = {};
        failedPhotoIds.forEach(photoId => {
          if (photoUpdates[photoId]) {
            failedUpdates[photoId] = photoUpdates[photoId];
          }
        });
        setPhotoUpdates(failedUpdates);
      } else {
        setPhotoUpdates({}); // Clear all if everything succeeded
      }

      setIsSelectAppointmentModalOpen(false); // Close modal if open

      // Show appropriate success message
      if (photoUpdatesFailed) {
        await alert('病歷記錄已更新，但部分照片說明更新失敗。請再次點擊儲存以重試。', '部分成功');
      } else {
        await alert('病歷記錄已成功更新', '更新成功');
      }
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
    setPhotoUpdates({}); // Clear pending photo description edits
    setConflictState(null);
    // The useEffect will handle resetting form and photo state when fresh data arrives
  };

  const handleConflictForceSave = async () => {
    if (!conflictState || !record) return;

    try {
      const forceSaveData: {
        version: number;
        values?: Record<string, any>;
        appointment_id?: number | null;
        photo_ids?: number[];
      } = {
        version: conflictState.currentRecord.version,
        values: conflictState.userChanges.values,
        appointment_id: conflictState.userChanges.appointment_id ?? null,
        photo_ids: selectedPhotoIds,
      };

      // Force save medical record first
      await updateMutation.mutateAsync({
        recordId: record.id,
        data: forceSaveData,
      });

      // Save photo description updates with better error handling
      let photoUpdatesFailed = false;
      const failedPhotoIds: number[] = [];

      if (Object.keys(photoUpdates).length > 0) {
        const photoUpdatePromises = Object.entries(photoUpdates).map(([photoIdStr, updates]) => {
          const photoId = parseInt(photoIdStr, 10);
          return { photoId, promise: apiService.updatePatientPhoto(photoId, updates) };
        });

        const results = await Promise.allSettled(photoUpdatePromises.map(p => p.promise));

        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            photoUpdatesFailed = true;
            const photoId = photoUpdatePromises[index]?.photoId;
            if (photoId) {
              failedPhotoIds.push(photoId);
              logger.error(`Photo ${photoId} description update failed:`, result.reason);
            }
          }
        });
      }

      // Show appropriate success message
      if (photoUpdatesFailed) {
        await alert('病歷記錄已強制儲存，但部分照片說明更新失敗。請再次點擊儲存以重試。', '部分成功');

        // Only clear successful photo updates, keep failed ones for retry
        const failedUpdates: Record<number, Partial<PatientPhoto>> = {};
        failedPhotoIds.forEach(photoId => {
          if (photoUpdates[photoId]) {
            failedUpdates[photoId] = photoUpdates[photoId];
          }
        });
        setPhotoUpdates(failedUpdates);
      } else {
        await alert('病歷記錄已強制儲存', '儲存成功');
        setPhotoUpdates({}); // Clear all if everything succeeded
      }

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
    <div className="min-h-screen bg-white py-0 px-0 md:py-8 md:px-4 print:p-0">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .document-page { 
            box-shadow: none !important; 
            border: none !important; 
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
          }
          select { -webkit-appearance: none; -moz-appearance: none; appearance: none; border: none !important; padding: 0 !important; }
        }
      `}</style>

      <div className="max-w-4xl mx-auto">
        {/* Back Button - Hidden on Print */}
        <div className="mb-6 no-print px-5 py-4 md:p-0">
          <button
            onClick={handleBack}
            className="text-blue-600 hover:text-blue-800 font-medium transition-colors flex items-center gap-1"
          >
            ← 返回病患詳情
          </button>
        </div>

        {/* The "Document" Page */}
        <div className="bg-white md:shadow-[0_4px_30px_rgb(0,0,0,0.06)] md:rounded-sm overflow-hidden md:border border-gray-100 mb-0 md:mb-12 document-page">
          {/* Record Title & Metadata Block */}
          <div className="px-5 py-6 md:px-12 md:pt-12 md:pb-10 bg-gray-50/5 border-b border-gray-100">
            <div className="flex justify-between items-start mb-10">
              <div className="flex flex-col gap-2">
                <h1 className="text-2xl md:text-3xl lg:text-4xl font-extrabold text-blue-900 tracking-tight">
                  {record.template_snapshot.name}
                </h1>
                {record.template_snapshot.description && (
                  <p className="text-sm md:text-base text-gray-500 max-w-2xl">
                    {record.template_snapshot.description}
                  </p>
                )}
              </div>
              <div className="text-right no-print">
                <button
                  onClick={methods.handleSubmit(onSubmit)}
                  disabled={isSaving || !hasUnsavedChanges()}
                  className="btn-primary px-8 py-2.5 shadow-md hover:shadow-xl transition-all"
                >
                  {isSaving ? '儲存中...' : '儲存變更'}
                </button>
              </div>
            </div>

            {/* Grouped Information Row */}
            <div className="space-y-6">
              {/* Patient Data Row */}
              <div className="flex flex-wrap gap-x-4 md:gap-x-10 gap-y-3 text-sm">
                {patient?.full_name && (
                  <div className="flex items-center gap-2.5">
                    <span className="text-gray-500 font-bold uppercase tracking-wider text-sm">病患姓名</span>
                    <span className="font-bold text-gray-900">{patient.full_name}</span>
                  </div>
                )}
                {patient?.birthday && (
                  <div className="flex items-center gap-2.5">
                    <span className="text-gray-500 font-bold uppercase tracking-wider text-sm">出生日期</span>
                    <span className="font-bold text-gray-900">{patient.birthday}</span>
                  </div>
                )}
                {patient?.gender && (
                  <div className="flex items-center gap-2.5">
                    <span className="text-gray-500 font-bold uppercase tracking-wider text-sm">性別</span>
                    <span className="font-bold text-gray-900">{getGenderLabel(patient.gender)}</span>
                  </div>
                )}
                {patient?.phone_number && (
                  <div className="flex items-center gap-2.5">
                    <span className="text-gray-500 font-bold uppercase tracking-wider text-sm">電話</span>
                    <span className="font-bold text-gray-900">{patient.phone_number}</span>
                  </div>
                )}

              </div>

              {/* Appointment Context Row */}
              <div className="flex items-center gap-4 text-sm no-print">
                <span className="font-bold text-gray-500 uppercase tracking-wider text-sm whitespace-nowrap">
                  關聯預約
                </span>

                <div className="flex-1 flex items-center gap-2 group">
                  <span className="text-gray-900 font-medium">
                    {displayAppointment ? (
                      `${formatAppointmentTimeRange(new Date(displayAppointment.start_time), new Date(displayAppointment.end_time))}${displayAppointment.appointment_type_name ? ` • ${displayAppointment.appointment_type_name}` : ''}`
                    ) : (
                      '(未選取 / 無預約)'
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsSelectAppointmentModalOpen(true)}
                    className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-all"
                    title="修改關聯預約"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Document Content Sections */}
          <div className="px-5 py-6 md:px-12 md:py-10 space-y-12">
            <FormProvider {...methods}>
              <form onSubmit={methods.handleSubmit(onSubmit)} className="space-y-12">
                {/* Dynamic Form Content */}
                <section>
                  <div className="max-w-none">
                    {record.template_snapshot?.fields && (
                      <div className="grid grid-cols-1 gap-x-8 gap-y-10">
                        <MedicalRecordDynamicForm fields={record.template_snapshot.fields} />
                      </div>
                    )}
                  </div>
                </section>

                {/* Photos with formal caption if printed, or interactive selector if web */}
                <section className="print:break-before-page">
                  <div className="bg-white">
                    <MedicalRecordPhotoSelector
                      clinicId={activeClinicId ?? null}
                      patientId={patientId}
                      selectedPhotoIds={selectedPhotoIds}
                      onPhotoIdsChange={setSelectedPhotoIds}
                      onPhotoUpdate={handlePhotoUpdate}
                      recordId={recordId ?? null}
                    />
                  </div>
                </section>

                {/* Print-only Signature Area */}
                <section className="hidden print:block pt-16 mt-16 border-t border-gray-100">
                  <div className="flex justify-between">
                    <div className="w-1/3">
                      <div className="border-b border-gray-900 pb-2 mb-2 text-sm"></div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">診所負責人簽章</p>
                    </div>
                    <div className="w-1/3">
                      <div className="border-b border-gray-900 pb-2 mb-2 text-sm text-center">
                        {new Date().toLocaleDateString('zh-TW')}
                      </div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">日期</p>
                    </div>
                  </div>
                </section>
              </form>
            </FormProvider>
          </div>

          {/* Print-only Footer */}
          <div className="hidden print:block px-12 pb-12 pt-8 text-center text-[9px] text-gray-400 italic">
            本附件僅供醫療参考，不作他用。本系統產生之內容僅供授權醫護人員使用。
          </div>
        </div>
      </div>

      {/* Conflict Resolution Dialog */}
      {conflictState?.show && (
        <BaseModal onClose={handleConflictCancel}>
          <ModalHeader title="版本衝突" onClose={handleConflictCancel} showClose={true} />
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

      {/* Appointment Selection Modal */}
      {isSelectAppointmentModalOpen && (
        <BaseModal onClose={() => setIsSelectAppointmentModalOpen(false)}>
          <ModalHeader title="選擇關聯預約" onClose={() => setIsSelectAppointmentModalOpen(false)} showClose={true} />
          <ModalBody>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
              <div
                ref={methods.getValues('appointment_id') === null ? scrollToSelected : null}
                onClick={() => {
                  methods.setValue('appointment_id', null, { shouldDirty: true });
                  setIsSelectAppointmentModalOpen(false);
                }}
                className={`p-3 border rounded-lg cursor-pointer transition-all ${methods.getValues('appointment_id') === null
                  ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                  : 'border-gray-100 hover:border-gray-300 hover:bg-gray-50'
                  }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-600">(未選取 / 無預約)</span>
                  {methods.getValues('appointment_id') === null && (
                    <div className="h-5 w-5 rounded-full bg-blue-500 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </div>
              </div>

              {loadingAppointments ? (
                <div className="flex justify-center py-8">
                  <LoadingSpinner size="md" />
                </div>
              ) : (
                appointments?.appointments
                  ?.filter((apt) => apt.status === 'confirmed' || apt.id === record?.appointment_id)
                  .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
                  .map((apt) => {
                    const aptId = apt.id;
                    const isSelected = methods.getValues('appointment_id') === aptId;
                    const startDate = new Date(apt.start_time);
                    const endDate = new Date(apt.end_time);
                    const timeStr = formatAppointmentTimeRange(startDate, endDate);
                    const serviceName = apt.appointment_type_name || '預約';

                    return (
                      <div
                        key={aptId}
                        ref={isSelected ? scrollToSelected : null}
                        onClick={() => {
                          methods.setValue('appointment_id', aptId, { shouldDirty: true });
                          setIsSelectAppointmentModalOpen(false);
                        }}
                        className={`p-3 border rounded-lg cursor-pointer transition-all ${isSelected
                          ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                          : 'border-gray-100 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-gray-900">{timeStr}</span>
                            <span className="text-gray-400">|</span>
                            <span className="text-sm text-gray-600">{serviceName}</span>
                          </div>
                          {isSelected && (
                            <div className="h-5 w-5 rounded-full bg-blue-500 flex items-center justify-center">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </ModalBody>

        </BaseModal>
      )}
    </div>
  );
};

export default MedicalRecordPage;

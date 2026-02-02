import React, { useEffect, useState, useMemo } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BaseModal } from './shared/BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from './shared/ModalParts';
import { LoadingSpinner } from './shared';
import { FormField } from './forms';
import { MedicalRecordDynamicForm } from './MedicalRecordDynamicForm';
import { MedicalRecordPhotoSelector } from './MedicalRecordPhotoSelector';
import {
  useMedicalRecord,
  useCreateMedicalRecord,
  useUpdateMedicalRecord,
} from '../hooks/useMedicalRecords';
import { useMedicalRecordTemplates } from '../hooks/useMedicalRecordTemplates';
import { usePatientAppointments } from '../hooks/queries/usePatientAppointments';
import { useAuth } from '../hooks/useAuth';
import { useModal } from '../contexts/ModalContext';
import { useUnsavedChangesDetection } from '../hooks/useUnsavedChangesDetection';
import { getErrorMessage } from '../types/api';
import { logger } from '../utils/logger';
import { AxiosError } from 'axios';
import { TemplateField } from '../types/medicalRecord';
import { formatDateOnly, formatAppointmentTimeRange } from '../utils/calendarUtils';

interface MedicalRecordModalProps {
  patientId: number;
  recordId: number | null; // null for create, number for edit/view
  mode: 'create' | 'edit' | 'view';
  onClose: () => void;
  defaultAppointmentId?: number;
}

// Generate dynamic Zod schema based on template fields
const createDynamicSchema = (fields: TemplateField[] | undefined) => {
  if (!fields || fields.length === 0) {
    return z.object({
      template_id: z.number().min(1, '請選擇模板'),
      values: z.record(z.any()),
    });
  }

  const valuesShape: Record<string, z.ZodTypeAny> = {};

  fields.forEach((field) => {
    const fieldId = field.id;

    // Base validation based on field type
    let fieldSchema: z.ZodTypeAny;

    switch (field.type) {
      case 'number':
        fieldSchema = z.union([z.number(), z.string().transform(val => val === '' ? undefined : Number(val))]);
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

    // Apply required validation
    if (field.required) {
      if (field.type === 'checkbox') {
        fieldSchema = z.array(z.string()).min(1, `${field.label}為必填欄位`);
      } else if (field.type === 'number') {
        fieldSchema = z.union([
          z.number({ required_error: `${field.label}為必填欄位` }),
          z.string().min(1, `${field.label}為必填欄位`).transform(val => Number(val))
        ]);
      } else {
        fieldSchema = z.string().min(1, `${field.label}為必填欄位`);
      }
    }

    valuesShape[fieldId] = fieldSchema;
  });

  return z.object({
    template_id: z.number().min(1, '請選擇模板'),
    values: z.object(valuesShape),
  });
};

type RecordFormData = {
  template_id: number;
  appointment_id?: number | null;
  values: Record<string, any>;
};

export const MedicalRecordModal: React.FC<MedicalRecordModalProps> = ({
  patientId,
  recordId,
  mode,
  onClose,
  defaultAppointmentId,
}) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const { alert, confirm } = useModal();
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<number[]>([]);
  const [conflictState, setConflictState] = useState<{
    show: boolean;
    currentRecord: any;
    updatedByUserName?: string;
    userChanges: RecordFormData;
  } | null>(null);

  const isCreate = mode === 'create';
  const isView = mode === 'view';
  const isEdit = mode === 'edit';

  // Fetch record if editing/viewing
  const { data: record, isLoading: loadingRecord } = useMedicalRecord(
    activeClinicId ?? null,
    recordId
  );

  // Fetch templates for create mode
  const { data: templates } = useMedicalRecordTemplates(activeClinicId ?? null);

  // Fetch patient appointments for linking
  const { data: appointments } = usePatientAppointments(patientId);

  const createMutation = useCreateMedicalRecord(activeClinicId ?? null, patientId);
  const updateMutation = useUpdateMedicalRecord(activeClinicId ?? null, patientId);

  // Get selected template for schema generation
  const selectedTemplate = isCreate
    ? templates?.find((t) => t.id === selectedTemplateId)
    : record?.template_snapshot;

  // Generate dynamic schema based on template fields
  const dynamicSchema = useMemo(
    () => createDynamicSchema(selectedTemplate?.fields),
    [selectedTemplate?.fields]
  );

  // Calculate default appointment
  const defaultAppointmentValue = useMemo(() => {
    // 1. If explicitly provided via props, use it
    if (defaultAppointmentId) return defaultAppointmentId;

    // 2. If editing an existing record, use the saved value
    if (record?.appointment_id) return record.appointment_id;

    // 3. Smart Pre-selection for new records
    if (!appointments?.appointments) return null;

    const confirmedApps = appointments.appointments.filter(a => a.status === 'confirmed');
    if (confirmedApps.length === 0) return null;

    // a. Sort chronologically (Past -> Future)
    const sortedApps = [...confirmedApps].sort((a, b) =>
      new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

    const now = new Date();
    const todayStr = formatDateOnly(now.toISOString());

    // b. Priority 1: Appointment on TODAY
    const infoToday = sortedApps.find(a => formatDateOnly(a.start_time) === todayStr);
    if (infoToday) return infoToday.calendar_event_id || infoToday.id;

    // c. Priority 2: Most recent PAST appointment (closest to now but in the past)
    // Since sortedApps is chronological, we look for the last item where start_time < now
    const pastApps = sortedApps.filter(a => new Date(a.start_time) < now);
    if (pastApps.length > 0) {
      const lastPast = pastApps[pastApps.length - 1]; // Last one in the list is the most recent
      if (lastPast) {
        return lastPast.calendar_event_id || lastPast.id;
      }
    }

    // d. Fallback: No selection (let user choose future appointment if that's all there is)
    return null;

  }, [defaultAppointmentId, record?.appointment_id, appointments?.appointments]);

  const methods = useForm<RecordFormData>({
    resolver: zodResolver(dynamicSchema),
    defaultValues: {
      template_id: 0,
      appointment_id: defaultAppointmentId || null, // Will be updated by useEffect below
      values: {},
    },
    mode: 'onSubmit', // Only validate on submit
  });

  // Sync the smart default when calculated
  useEffect(() => {
    if (isCreate && defaultAppointmentValue !== null) {
      // Only set if field is not dirty (user hasn't manually changed it yet)
      const currentVal = methods.getValues('appointment_id');
      if (!currentVal) {
        methods.setValue('appointment_id', defaultAppointmentValue);
      }
    }
  }, [defaultAppointmentValue, isCreate, methods]);

  // Setup unsaved changes detection
  useUnsavedChangesDetection({
    hasUnsavedChanges: () => !isView && methods.formState.isDirty,
  });

  // Handle close with unsaved changes confirmation
  const handleClose = async () => {
    if (!isView && methods.formState.isDirty) {
      const confirmed = await confirm('您有未儲存的變更，確定要離開嗎？', '確認離開');
      if (!confirmed) {
        return;
      }
    }
    onClose();
  };

  // Load record data when editing/viewing
  useEffect(() => {
    if (record && (isEdit || isView)) {
      methods.reset({
        template_id: record.template_id,
        appointment_id: record.appointment_id ?? null,
        values: record.values || {},
      });
      setSelectedTemplateId(record.template_id);
    }
  }, [record, isEdit, isView, methods]);

  const onSubmit = async (data: RecordFormData) => {
    try {
      if (isCreate) {
        const createData: {
          template_id: number;
          values: Record<string, any>;
          appointment_id?: number;
          photo_ids?: number[];
        } = {
          template_id: data.template_id,
          values: data.values,
        };
        if (data.appointment_id) {
          createData.appointment_id = data.appointment_id;
        }
        if (selectedPhotoIds.length > 0) {
          createData.photo_ids = selectedPhotoIds;
        }
        await createMutation.mutateAsync(createData);
        await alert('病歷記錄已成功建立', '建立成功');
      } else if (isEdit && record) {
        const updateData: {
          version: number;
          values?: Record<string, any>;
          appointment_id?: number | null;
          photo_ids?: number[];
        } = {
          version: record.version,
          values: data.values,
        };
        // Only include appointment_id if it's explicitly set (not undefined)
        if (data.appointment_id !== undefined) {
          updateData.appointment_id = data.appointment_id;
        }
        // Always include photo_ids for edit (even if empty, to allow unlinking)
        updateData.photo_ids = selectedPhotoIds;

        await updateMutation.mutateAsync({
          recordId: record.id,
          data: updateData,
        });
        await alert('病歷記錄已成功更新', '更新成功');
      }
      onClose();
    } catch (error) {
      logger.error('Failed to save medical record:', error);

      // Handle version conflict (409)
      if (error instanceof AxiosError && error.response?.status === 409) {
        const errorDetail = error.response.data?.detail;
        const currentRecord = errorDetail?.current_record;
        const updatedByUserName = errorDetail?.updated_by_user_name;

        // Show conflict resolution dialog
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
    if (conflictState?.currentRecord) {
      methods.reset({
        template_id: conflictState.currentRecord.template_id,
        appointment_id: conflictState.currentRecord.appointment_id ?? null,
        values: conflictState.currentRecord.values || {},
      });
    }
    setConflictState(null);
  };

  const handleConflictForceSave = async () => {
    if (!conflictState || !isEdit || !record) return;

    try {
      const forceSaveData: { version: number; values?: Record<string, any>; appointment_id?: number | null } = {
        version: conflictState.currentRecord.version, // Use latest version
        values: conflictState.userChanges.values, // Keep user's changes
      };
      if (conflictState.userChanges.appointment_id !== undefined) {
        forceSaveData.appointment_id = conflictState.userChanges.appointment_id;
      }
      await updateMutation.mutateAsync({
        recordId: record.id,
        data: forceSaveData,
      });
      await alert('病歷記錄已強制儲存', '儲存成功');
      setConflictState(null);
      onClose();
    } catch (forceSaveError) {
      logger.error('Force save failed:', forceSaveError);
      await alert(getErrorMessage(forceSaveError), '強制儲存失敗');
      setConflictState(null);
    }
  };

  const handleConflictCancel = () => {
    setConflictState(null);
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const getTitle = () => {
    if (isCreate) return '新增病歷記錄';
    if (isView) return '查看病歷記錄';
    return '編輯病歷記錄';
  };

  return (
    <BaseModal onClose={handleClose}>
      <FormProvider {...methods}>
        <form onSubmit={methods.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
          <ModalHeader title={getTitle()} onClose={handleClose} />

          <ModalBody>
            {loadingRecord ? (
              <div className="flex justify-center items-center py-12">
                <LoadingSpinner size="lg" />
              </div>
            ) : (
              <div className="space-y-6">
                {/* Template Selector (Create mode only) */}
                {isCreate && (
                  <FormField name="template_id" label="病歷模板 *">
                    <select
                      {...methods.register('template_id', { valueAsNumber: true })}
                      onChange={(e) => {
                        const templateId = parseInt(e.target.value);
                        setSelectedTemplateId(templateId);
                        methods.setValue('template_id', templateId);
                        methods.setValue('values', {}); // Reset values when template changes
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      disabled={isView}
                    >
                      <option value={0}>請選擇模板...</option>
                      {templates?.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </FormField>
                )}

                {/* Template Name (Edit/View mode) */}
                {(isEdit || isView) && record && (
                  <div className="pb-4 border-b">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      病歷模板
                    </label>
                    <p className="text-gray-900">{record.template_snapshot.name}</p>
                  </div>
                )}

                {/* Appointment Selector (Optional) */}
                <FormField name="appointment_id" label="關聯預約 (選填)">
                  <select
                    {...methods.register('appointment_id', {
                      setValueAs: (v) => v === '' ? null : parseInt(v)
                    })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    disabled={isView}
                  >
                    <option value="">無關聯預約</option>
                    {appointments?.appointments
                      ?.filter((apt) => apt.status === 'confirmed')
                      .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()) // Sort Newest -> Oldest
                      .map((apt) => {
                        const aptId = apt.calendar_event_id || apt.id;
                        // const dateStr = formatDateOnly(apt.start_time); // Unused
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
                </FormField>

                {/* Dynamic Form Fields */}
                {selectedTemplate && selectedTemplate.fields && (
                  <MedicalRecordDynamicForm fields={selectedTemplate.fields} />
                )}

                {/* Photo Selector */}
                {selectedTemplate && !isView && (
                  <div className="pt-6 border-t">
                    <MedicalRecordPhotoSelector
                      clinicId={activeClinicId ?? null}
                      patientId={patientId}
                      selectedPhotoIds={selectedPhotoIds}
                      onPhotoIdsChange={setSelectedPhotoIds}
                      recordId={recordId}
                    />
                  </div>
                )}

                {!selectedTemplate && isCreate && (
                  <div className="text-center py-8 text-gray-500">
                    請先選擇病歷模板
                  </div>
                )}
              </div>
            )}
          </ModalBody>

          <ModalFooter>
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              disabled={isSaving}
            >
              {isView ? '關閉' : '取消'}
            </button>
            {!isView && (
              <button
                type="submit"
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isSaving || !selectedTemplate}
              >
                {isSaving ? '儲存中...' : '儲存'}
              </button>
            )}
          </ModalFooter>
        </form>
      </FormProvider>

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
    </BaseModal>
  );
};

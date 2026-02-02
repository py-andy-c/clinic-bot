import React, { useEffect, useState, useMemo } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BaseModal } from './shared/BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from './shared/ModalParts';
import { LoadingSpinner } from './shared';
import { FormField } from './forms';
import { MedicalRecordDynamicForm } from './MedicalRecordDynamicForm';
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
}) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const { alert, confirm } = useModal();
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);

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

  const methods = useForm<RecordFormData>({
    resolver: zodResolver(dynamicSchema),
    defaultValues: {
      template_id: 0,
      appointment_id: null,
      values: {},
    },
    mode: 'onSubmit', // Only validate on submit
  });

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
        const createData: { template_id: number; values: Record<string, any>; appointment_id?: number } = {
          template_id: data.template_id,
          values: data.values,
        };
        if (data.appointment_id) {
          createData.appointment_id = data.appointment_id;
        }
        await createMutation.mutateAsync(createData);
        await alert('病歷記錄已成功建立', '建立成功');
      } else if (isEdit && record) {
        const updateData: { version: number; values?: Record<string, any>; appointment_id?: number | null } = {
          version: record.version,
          values: data.values,
        };
        // Only include appointment_id if it's explicitly set (not undefined)
        if (data.appointment_id !== undefined) {
          updateData.appointment_id = data.appointment_id;
        }
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
        const currentRecord = error.response.data?.current_record;
        const updatedBy = currentRecord?.updated_by_user_id;
        const updatedAt = currentRecord?.updated_at;
        
        const message = updatedBy && updatedAt
          ? `此病歷已被其他使用者在 ${new Date(updatedAt).toLocaleString('zh-TW')} 更新\n\n您可以選擇：\n• 確定：重新載入最新版本（放棄您的變更）\n• 取消：繼續編輯`
          : '此病歷已被其他使用者更新\n\n點擊「確定」重新載入最新版本，或「取消」繼續編輯';
        
        const shouldReload = await confirm(message, '版本衝突');
        
        if (shouldReload && currentRecord) {
          // Reload with latest data
          methods.reset({
            template_id: currentRecord.template_id,
            appointment_id: currentRecord.appointment_id ?? null,
            values: currentRecord.values || {},
          });
        }
      } else {
        await alert(getErrorMessage(error), '儲存失敗');
      }
    }
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
        <form onSubmit={methods.handleSubmit(onSubmit)}>
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
                      .map((apt) => {
                        const aptId = apt.calendar_event_id || apt.id;
                        const dateStr = formatDateOnly(apt.start_time);
                        const startDate = new Date(apt.start_time);
                        const endDate = new Date(apt.end_time);
                        const timeStr = formatAppointmentTimeRange(startDate, endDate);
                        const serviceName = apt.appointment_type_name || '預約';
                        return (
                          <option key={aptId} value={aptId}>
                            {dateStr} {timeStr} - {serviceName}
                          </option>
                        );
                      })}
                  </select>
                </FormField>

                {/* Dynamic Form Fields */}
                {selectedTemplate && selectedTemplate.fields && (
                  <MedicalRecordDynamicForm fields={selectedTemplate.fields} />
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
    </BaseModal>
  );
};

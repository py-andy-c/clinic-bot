import React, { useEffect } from 'react';
import { useForm, FormProvider, useFieldArray, useFormContext } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BaseModal } from './shared/BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from './shared/ModalParts';
import { LoadingSpinner } from './shared/LoadingSpinner';
import { FormInput, FormTextarea, FormField } from './forms';
import { MedicalRecordDynamicForm } from './MedicalRecordDynamicForm';
import {
  useMedicalRecordTemplate,
  useCreateMedicalRecordTemplate,
  useUpdateMedicalRecordTemplate
} from '../hooks/useMedicalRecordTemplates';
import { useAuth } from '../hooks/useAuth';
import { useModal } from '../contexts/ModalContext';
import { useUnsavedChangesDetection } from '../hooks/useUnsavedChangesDetection';
import { TemplateFieldType } from '../types/medicalRecord';
import { getErrorMessage } from '../types/api';
import { logger } from '../utils/logger';

interface MedicalRecordTemplateEditorModalProps {
  templateId: number | null; // null for new template
  defaultType?: import('../types/medicalRecord').MedicalRecordTemplateType;
  onClose: () => void;
}

// Field schema
const TemplateFieldSchema = z.object({
  id: z.string().optional(), // UUID from backend, undefined for new fields
  label: z.string().min(1, '欄位名稱不可為空'),
  type: z.enum(['text', 'textarea', 'number', 'date', 'dropdown', 'radio', 'checkbox']),
  required: z.boolean(),
  placeholder: z.string().optional().or(z.literal('')),
  description: z.string().optional(),
  options: z.union([z.array(z.string()), z.string()]).optional(), // Allow both array and string (textarea)
  order: z.number(),
});

// Template schema
const TemplateSchema = z.object({
  name: z.string().min(1, '模板名稱不可為空'),
  template_type: z.enum(['medical_record', 'patient_form']),
  max_photos: z.number().min(0).max(20),
  description: z.string().optional(),
  fields: z.array(TemplateFieldSchema),
});

type TemplateFormData = z.infer<typeof TemplateSchema>;

const FIELD_TYPE_OPTIONS: { value: TemplateFieldType; label: string }[] = [
  { value: 'text', label: '單行文字' },
  { value: 'textarea', label: '多行文字' },
  { value: 'number', label: '數字' },
  { value: 'date', label: '日期' },
  { value: 'dropdown', label: '下拉選單' },
  { value: 'radio', label: '單選按鈕' },
  { value: 'checkbox', label: '多選框' },
];

export const MedicalRecordTemplateEditorModal: React.FC<MedicalRecordTemplateEditorModalProps> = ({
  templateId,
  defaultType = 'medical_record',
  onClose,
}) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const { alert, confirm } = useModal();
  const [activeTab, setActiveTab] = React.useState<'edit' | 'preview'>('edit');

  const isEdit = templateId !== null;
  const { data: template, isLoading } = useMedicalRecordTemplate(
    activeClinicId ?? null,
    templateId
  );
  const createMutation = useCreateMedicalRecordTemplate(activeClinicId ?? null);
  const updateMutation = useUpdateMedicalRecordTemplate(activeClinicId ?? null);

  const methods = useForm<TemplateFormData>({
    resolver: zodResolver(TemplateSchema),
    defaultValues: {
      name: '',
      template_type: defaultType,
      max_photos: 5,
      description: '',
      fields: [],
    },
  });

  const { fields, append, remove, move } = useFieldArray({
    control: methods.control,
    name: 'fields',
  });

  // Setup unsaved changes detection
  useUnsavedChangesDetection({
    hasUnsavedChanges: () => methods.formState.isDirty,
  });

  // Handle close with unsaved changes confirmation
  const handleClose = async () => {
    if (methods.formState.isDirty) {
      const confirmed = await confirm('您有未儲存的變更，確定要離開嗎？', '確認離開');
      if (!confirmed) {
        return;
      }
    }
    onClose();
  };

  // Load template data when editing
  useEffect(() => {
    if (template && isEdit) {
      methods.reset({
        name: template.name,
        template_type: template.template_type,
        max_photos: template.max_photos,
        description: template.description || '',
        fields: template.fields.map((field, index) => ({
          ...field,
          // Convert options array to newline-separated string for textarea
          options: field.options ? field.options.join('\n') : undefined,
          order: index,
        })),
      });
    }
  }, [template, isEdit, methods]);

  const handleAddField = () => {
    append({
      label: '',
      type: 'text',
      required: false,
      placeholder: '',
      description: '',
      options: '', // Initialize as empty string for textarea consistency
      order: fields.length,
    });
  };

  const handleRemoveField = (index: number) => {
    remove(index);
  };

  const handleMoveField = (fromIndex: number, direction: 'up' | 'down') => {
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (toIndex >= 0 && toIndex < fields.length) {
      move(fromIndex, toIndex);
    }
  };

  const onSubmit = async (data: TemplateFormData) => {
    try {
      // Helper function to convert options string to array
      const processFieldOptions = (field: any) => {
        // Only process options for field types that support them
        const supportsOptions = ['dropdown', 'radio', 'checkbox'].includes(field.type);

        if (!supportsOptions) {
          return undefined; // Clear options for non-select field types
        }

        if (field.options && typeof field.options === 'string') {
          // Split by newline and filter out empty lines
          return field.options
            .split('\n')
            .map((opt: string) => opt.trim())
            .filter((opt: string) => opt.length > 0);
        }
        return field.options || undefined;
      };

      if (isEdit && template) {
        // Update existing template
        await updateMutation.mutateAsync({
          templateId: template.id,
          data: {
            version: template.version,
            name: data.name,
            max_photos: data.max_photos,
            description: data.description,
            fields: data.fields.map((field, index) => ({
              ...field,
              id: field.id || '', // Backend will generate ID if empty
              placeholder: field.placeholder || undefined,
              description: field.description || undefined,
              options: processFieldOptions(field),
              order: index,
            })),
          },
        });
        await alert('模板已成功更新', '更新成功');
      } else {
        // Create new template
        await createMutation.mutateAsync({
          name: data.name,
          template_type: data.template_type,
          max_photos: data.max_photos,
          description: data.description,
          fields: data.fields.map((field, index) => ({
            label: field.label,
            type: field.type,
            required: field.required,
            placeholder: field.placeholder || undefined,
            description: field.description || undefined,
            options: processFieldOptions(field),
            order: index,
          })),
        });
        await alert('模板已成功建立', '建立成功');
      }
      onClose();
    } catch (error) {
      logger.error('Failed to save template:', error);
      await alert(getErrorMessage(error), '儲存失敗');
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const watchedFields = methods.watch('fields');
  const previewFields = watchedFields.map((f, i) => ({
    ...f,
    id: f.id || `preview-${i}`,
    options: typeof f.options === 'string' 
      ? f.options.split('\n').map(o => o.trim()).filter(Boolean) 
      : f.options
  }));

  return (
    <BaseModal onClose={handleClose} fullScreen>
      <FormProvider {...methods}>
        <form onSubmit={methods.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
          <div className="flex flex-col flex-1 min-h-0">
            <ModalHeader
              title={isEdit ? '編輯模板' : '新增模板'}
              onClose={handleClose}
              showClose
            />
            <div className="bg-white border-b flex px-6">
              <button
                type="button"
                onClick={() => setActiveTab('edit')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'edit'
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                編輯內容
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('preview')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'preview'
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                預覽表單
              </button>
            </div>

            <ModalBody className="bg-gray-50">
              {isLoading ? (
                <div className="flex justify-center items-center py-12">
                  <LoadingSpinner size="lg" />
                </div>
              ) : (
                <div className="w-full h-full">
                  {activeTab === 'edit' ? (
                    <div key="edit-content" className="max-w-4xl mx-auto w-full grid grid-cols-1 md:grid-cols-3 gap-6 py-6">
                      <div className="md:col-span-1 space-y-6">
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 space-y-4">
                          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">基本設定</h3>
                          <FormField name="name" label="模板名稱">
                            <FormInput
                              name="name"
                              placeholder="例如：一般檢查、初診記錄"
                            />
                          </FormField>
                          <FormField name="template_type" label="模板類型">
                            <select
                              {...methods.register('template_type')}
                              disabled={isEdit}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-500"
                            >
                              <option value="medical_record">病歷模板</option>
                              <option value="patient_form">患者表單</option>
                            </select>
                          </FormField>
          <FormField 
            name="max_photos" 
            label="照片數量上限"
            description="病患填寫時可上傳的照片數量 (0-20)"
          >
            <FormInput
              name="max_photos"
              type="number"
              min={0}
              max={20}
            />
          </FormField>
                          <FormField name="description" label="模板說明">
                            <FormTextarea
                              name="description"
                              placeholder="描述此模板的用途（選填）"
                              rows={3}
                            />
                          </FormField>
                        </div>
                      </div>

                      <div className="md:col-span-2 space-y-4">
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                          <div className="flex items-center justify-between mb-6">
                            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">表單欄位</h3>
                            <span className="text-xs text-gray-500">{fields.length} 個欄位</span>
                          </div>

                          <div className="space-y-4">
                            {fields.map((field, index) => (
                              <FieldEditor
                                key={field.id}
                                index={index}
                                field={field}
                                onRemove={() => handleRemoveField(index)}
                                onMoveUp={() => handleMoveField(index, 'up')}
                                onMoveDown={() => handleMoveField(index, 'down')}
                                canMoveUp={index > 0}
                                canMoveDown={index < fields.length - 1}
                              />
                            ))}

                            <button
                              type="button"
                              onClick={handleAddField}
                              className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:text-primary-600 hover:border-primary-500 hover:bg-primary-50 transition-all flex items-center justify-center gap-2 group"
                            >
                              <span className="text-2xl group-hover:scale-110 transition-transform">+</span>
                              <span className="font-medium">新增欄位</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div key="preview-content" className="max-w-2xl mx-auto w-full py-12">
                      <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200">
                        <div className="mb-8 border-b pb-6">
                          <h1 className="text-2xl font-bold text-gray-900">{methods.watch('name') || '未命名模板'}</h1>
                          {methods.watch('description') && (
                            <p className="mt-2 text-gray-600">{methods.watch('description')}</p>
                          )}
                        </div>
                        
                        <MedicalRecordDynamicForm fields={previewFields as any} />
                        
                        {methods.watch('max_photos') > 0 && (
                          <div className="mt-8 pt-8 border-t">
                            <h3 className="text-sm font-medium text-gray-700 mb-4">照片上傳 (上限 {methods.watch('max_photos')} 張)</h3>
                            <div className="grid grid-cols-3 gap-4">
                              <div className="aspect-square border-2 border-dashed border-gray-300 rounded-xl flex items-center justify-center text-gray-400">
                                <span className="text-2xl">+</span>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="mt-12">
                          <button
                            type="button"
                            className="w-full py-3 bg-primary-600 text-white rounded-xl font-semibold shadow-lg shadow-primary-200"
                            disabled
                          >
                            提交表單 (預覽模式)
                          </button>
                        </div>
                      </div>
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
                取消
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isSaving}
              >
                {isSaving ? '儲存中...' : '儲存'}
              </button>
            </ModalFooter>
          </div>
        </form>
      </FormProvider>
    </BaseModal>
  );
};

// Field Editor Component
interface FieldEditorProps {
  index: number;
  field: any;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

const FieldEditor: React.FC<FieldEditorProps> = ({
  index,
  field,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}) => {
  const { register, watch } = useFormContext<TemplateFormData>();
  const fieldType = watch(`fields.${index}.type`) || field.type;
  const needsOptions = ['dropdown', 'radio', 'checkbox'].includes(fieldType);

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
      {/* Hidden input to preserve field ID during updates */}
      <input type="hidden" {...register(`fields.${index}.id`)} />

      <div className="flex items-start gap-4">
        {/* Move buttons */}
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
            title="上移"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
            title="下移"
          >
            ↓
          </button>
        </div>

        {/* Field content */}
        <div className="flex-1 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField name={`fields.${index}.label`} label="欄位名稱">
              <FormInput
                name={`fields.${index}.label`}
                placeholder="例如：體重、血壓"
              />
            </FormField>
            <FormField name={`fields.${index}.type`} label="欄位類型">
              <select
                {...register(`fields.${index}.type`)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                {FIELD_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          {/* Deprecated Placeholder UI - removed per design decision */}
          {/* <FormField name={`fields.${index}.placeholder`} label="提示文字（選填）">
            <FormInput
              name={`fields.${index}.placeholder`}
              placeholder="例如：請輸入數值"
            />
          </FormField> */}

          <FormField name={`fields.${index}.description`} label="欄位說明（選填）">
            <FormInput
              name={`fields.${index}.description`}
              placeholder="例如：請填寫收縮壓與舒張壓"
            />
          </FormField>

          {needsOptions && (
            <FormField name={`fields.${index}.options`} label="選項（每行一個）">
              <FormTextarea
                name={`fields.${index}.options`}
                placeholder="選項1&#10;選項2&#10;選項3"
                rows={3}
              />
            </FormField>
          )}

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              {...register(`fields.${index}.required`)}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">必填欄位</span>
          </label>
        </div>

        {/* Remove button */}
        <button
          type="button"
          onClick={onRemove}
          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          title="刪除欄位"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

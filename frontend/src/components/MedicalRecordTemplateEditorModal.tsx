import React, { useEffect } from 'react';
import { useForm, FormProvider, useFieldArray, useFormContext } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BaseModal } from './shared/BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from './shared/ModalParts';
import { LoadingSpinner } from './shared';
import { FormInput, FormTextarea, FormField } from './forms';
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
import { processFieldOptions } from '../utils/templateFieldUtils';

interface MedicalRecordTemplateEditorModalProps {
  templateId: number | null; // null for new template
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
  description: z.string().optional(),
  is_patient_form: z.boolean(),
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
      description: '',
      is_patient_form: false,
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
        description: template.description || '',
        is_patient_form: template.is_patient_form,
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
      if (isEdit && template) {
        // Update existing template
        await updateMutation.mutateAsync({
          templateId: template.id,
          data: {
            version: template.version,
            name: data.name,
            description: data.description,
            is_patient_form: data.is_patient_form,
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
          description: data.description,
          is_patient_form: data.is_patient_form,
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

  return (
    <BaseModal
      onClose={handleClose}
      aria-label={isEdit ? '編輯病歷模板' : '新增病歷模板'}
      showCloseButton={false}
      fullScreen={true}
    >
      <FormProvider {...methods}>
        <form onSubmit={methods.handleSubmit(onSubmit)} className="flex flex-col h-full bg-white md:bg-gray-50/50">
          <ModalHeader
            title={isEdit ? '編輯病歷模板' : '新增病歷模板'}
            onClose={handleClose}
            showClose
          />

          {/* Tab Navigation */}
          <div className="border-b border-gray-200 bg-white">
            <div className="max-w-7xl mx-auto px-5 md:px-8">
              <nav className="flex gap-8" aria-label="Tabs">
                <button
                  type="button"
                  onClick={() => setActiveTab('edit')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === 'edit'
                      ? 'border-primary-600 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  編輯模板
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('preview')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === 'preview'
                      ? 'border-primary-600 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  預覽表單
                </button>
              </nav>
            </div>
          </div>

          <ModalBody className="!p-0 bg-white md:bg-transparent">
            {isLoading ? (
              <div className="flex justify-center items-center h-64">
                <LoadingSpinner size="lg" />
              </div>
            ) : (
              <>
                {/* Edit Tab Content */}
                {activeTab === 'edit' && (
                  <div className="p-0 md:p-8">
                    <div className="grid grid-cols-1 lg:grid-cols-12 md:gap-8 max-w-7xl mx-auto w-full">
                      {/* Left Column: Basic Info - Spans 4 columns on LG */}
                      <div className="lg:col-span-4 space-y-0 md:space-y-6">
                        <section className="bg-white md:rounded-2xl p-5 md:p-6 md:shadow-sm border-b md:border border-gray-100 border-x-0">
                          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                            <span className="w-1.5 h-6 bg-blue-500 rounded-full"></span>
                            基本資訊
                          </h3>
                          <div className="space-y-5">
                            <FormField name="name" label="模板名稱">
                              <FormInput
                                name="name"
                                placeholder="例如：一般檢查、初診記錄"
                                className="w-full"
                              />
                            </FormField>
                            <FormField name="description" label="模板說明">
                              <FormTextarea
                                name="description"
                                placeholder="描述此模板的用途（選填）"
                                rows={4}
                                className="w-full"
                              />
                            </FormField>
                            <div className="pt-2">
                              <label className="flex items-center gap-3 cursor-pointer select-none group">
                                <input
                                  type="checkbox"
                                  {...methods.register('is_patient_form')}
                                  className="w-5 h-5 border-gray-300 rounded text-blue-600 focus:ring-blue-500 transition-colors"
                                />
                                <div className="flex flex-col">
                                  <span className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                                    開放病患填寫
                                  </span>
                                  <span className="text-xs text-gray-500">
                                    開啟後，此模板可作為病患表單發送給病患填寫。
                                  </span>
                                </div>
                              </label>
                            </div>
                          </div>
                        </section>

                        <div className="hidden lg:block bg-blue-50 rounded-xl p-5 border border-blue-100">
                          <h4 className="text-sm font-semibold text-blue-900 mb-2 flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            小提示
                          </h4>
                          <p className="text-xs text-blue-700 leading-relaxed">
                            您可以在右側新增不同類型的欄位。建議將相關的欄位放在一起，病歷記錄時會更流暢。
                          </p>
                        </div>
                      </div>

                      {/* Right Column: Fields Section - Spans 8 columns on LG */}
                      <div className="lg:col-span-8 space-y-0 md:space-y-6">
                        <section className="bg-white md:rounded-2xl p-5 md:p-6 md:shadow-sm border-b md:border border-gray-100 border-x-0">
                          <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                              <span className="w-1.5 h-6 bg-purple-500 rounded-full"></span>
                              表單欄位
                            </h3>
                            <span className="text-xs font-medium px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full">
                              共 {fields.length} 個欄位
                            </span>
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

                            <div className="px-4 md:px-0">
                              <button
                                type="button"
                                onClick={handleAddField}
                                className="w-full py-6 border-2 border-dashed border-gray-200 rounded-xl text-gray-500 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50/50 transition-all flex flex-col items-center justify-center gap-2 group"
                              >
                                <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                                  <span className="text-2xl group-hover:scale-110 transition-transform">+</span>
                                </div>
                                <span className="font-semibold">新增欄位</span>
                                <span className="text-xs text-gray-400 font-normal">點擊此處為您的模板添加新的資料項目</span>
                              </button>
                            </div>
                          </div>
                        </section>
                      </div>
                    </div>
                  </div>
                )}

                {/* Preview Tab Content - Only render when active to avoid unnecessary watch() subscriptions */}
                {activeTab === 'preview' && (
                  <FormPreview />
                )}
              </>
            )}
          </ModalBody>

          <ModalFooter className="bg-white border-t border-gray-200">
            <div className="max-w-7xl mx-auto w-full flex justify-end gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                disabled={isSaving}
              >
                取消
              </button>
              <button
                type="submit"
                className="px-8 py-2.5 text-sm font-semibold bg-primary-600 text-white rounded-lg hover:bg-primary-700 shadow-sm shadow-primary-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                disabled={isSaving}
              >
                {isSaving && <LoadingSpinner size="sm" className="!border-white" />}
                {isSaving ? '儲存中...' : '儲存模板'}
              </button>
            </div>
          </ModalFooter>
        </form>
      </FormProvider>
    </BaseModal>
  );
};

// Form Preview Component
const FormPreview: React.FC = () => {
  const { watch } = useFormContext<TemplateFormData>();
  
  // Only watch specific fields needed for preview (performance optimization)
  const name = watch('name');
  const description = watch('description');
  const fields = watch('fields') || [];

  // Local state for preview form values
  type PreviewValue = string | string[] | number | undefined;
  const [previewValues, setPreviewValues] = React.useState<Record<string, PreviewValue>>({});

  // Type for processed fields with options as array
  type ProcessedField = z.infer<typeof TemplateFieldSchema> & {
    options?: string[] | undefined;
  };

  // Convert options string to array for preview
  const processedFields = React.useMemo(() => {
    return fields.map((field): ProcessedField => {
      if (['dropdown', 'radio', 'checkbox'].includes(field.type)) {
        return { ...field, options: processFieldOptions(field) };
      }
      // For non-option fields, ensure options is undefined
      const { options, ...rest } = field;
      return rest as ProcessedField;
    });
  }, [fields]);

  const handleInputChange = (fieldId: string, value: PreviewValue) => {
    setPreviewValues(prev => ({ ...prev, [fieldId]: value }));
  };

  const handleCheckboxChange = (fieldId: string, value: string, checked: boolean) => {
    setPreviewValues(prev => {
      const currentValues = Array.isArray(prev[fieldId]) ? prev[fieldId] : [];
      if (checked) {
        return { ...prev, [fieldId]: [...currentValues, value] };
      } else {
        return { ...prev, [fieldId]: currentValues.filter((v: string) => v !== value) };
      }
    });
  };

  const renderPreviewField = (field: ProcessedField, index: number) => {
    const fieldId = field.id || `field-${index}`;
    const label = field.required ? (
      <>
        {field.label || `欄位 ${index + 1}`} <span className="text-red-500">*</span>
      </>
    ) : (field.label || `欄位 ${index + 1}`);

    switch (field.type) {
      case 'text':
        return (
          <div key={index} className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              {label}
            </label>
            {field.description && (
              <p className="text-xs text-gray-500">{field.description}</p>
            )}
            <input
              type="text"
              value={previewValues[fieldId] || ''}
              onChange={(e) => handleInputChange(fieldId, e.target.value)}
              placeholder={field.placeholder || ''}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
        );

      case 'textarea':
        return (
          <div key={index} className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              {label}
            </label>
            {field.description && (
              <p className="text-xs text-gray-500">{field.description}</p>
            )}
            <textarea
              value={previewValues[fieldId] || ''}
              onChange={(e) => handleInputChange(fieldId, e.target.value)}
              placeholder={field.placeholder || ''}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
          </div>
        );

      case 'number':
        return (
          <div key={index} className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              {label}
            </label>
            {field.description && (
              <p className="text-xs text-gray-500">{field.description}</p>
            )}
            <input
              type="number"
              value={previewValues[fieldId] || ''}
              onChange={(e) => handleInputChange(fieldId, e.target.value)}
              placeholder={field.placeholder || ''}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
        );

      case 'date':
        return (
          <div key={index} className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              {label}
            </label>
            {field.description && (
              <p className="text-xs text-gray-500">{field.description}</p>
            )}
            <input
              type="date"
              value={previewValues[fieldId] || ''}
              onChange={(e) => handleInputChange(fieldId, e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
        );

      case 'dropdown':
        return (
          <div key={index} className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              {label}
            </label>
            {field.description && (
              <p className="text-xs text-gray-500">{field.description}</p>
            )}
            <select
              value={previewValues[fieldId] || ''}
              onChange={(e) => handleInputChange(fieldId, e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">請選擇...</option>
              {field.options && Array.isArray(field.options) && field.options.length > 0 ? (
                field.options.map((option: string, idx: number) => (
                  <option key={idx} value={option}>
                    {option}
                  </option>
                ))
              ) : (
                <option disabled className="text-gray-400">尚未設定選項</option>
              )}
            </select>
          </div>
        );

      case 'radio':
        return (
          <div key={index} className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              {label}
            </label>
            {field.description && (
              <p className="text-xs text-gray-500 mb-2">{field.description}</p>
            )}
            <div className="space-y-2">
              {field.options && Array.isArray(field.options) && field.options.length > 0 ? (
                field.options.map((option: string, idx: number) => (
                  <label key={idx} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name={fieldId}
                      value={option}
                      checked={previewValues[fieldId] === option}
                      onChange={(e) => handleInputChange(fieldId, e.target.value)}
                      className="rounded-full border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-700">{option}</span>
                  </label>
                ))
              ) : (
                <p className="text-xs text-gray-400 italic">尚未設定選項</p>
              )}
            </div>
          </div>
        );

      case 'checkbox':
        return (
          <div key={index} className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              {label}
            </label>
            {field.description && (
              <p className="text-xs text-gray-500 mb-2">{field.description}</p>
            )}
            <div className="space-y-2">
              {field.options && Array.isArray(field.options) && field.options.length > 0 ? (
                field.options.map((option: string, idx: number) => {
                  const currentValues = Array.isArray(previewValues[fieldId]) ? previewValues[fieldId] : [];
                  return (
                    <label key={idx} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        value={option}
                        checked={currentValues.includes(option)}
                        onChange={(e) => handleCheckboxChange(fieldId, option, e.target.checked)}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="text-sm text-gray-700">{option}</span>
                    </label>
                  );
                })
              ) : (
                <p className="text-xs text-gray-400 italic">尚未設定選項</p>
              )}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="p-0 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white md:rounded-2xl p-5 md:p-8 md:shadow-sm md:border border-gray-100">
          {/* Preview Header */}
          <div className="mb-8 pb-6 border-b border-gray-200">
            <h2 className="text-2xl font-bold text-gray-900">
              {name || '未命名模板'}
            </h2>
            {description && (
              <p className="text-sm text-gray-600 mt-2">{description}</p>
            )}
          </div>

          {/* Preview Fields */}
          {processedFields.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">尚未新增欄位</h3>
              <p className="text-sm text-gray-500">
                請切換到「編輯模板」頁籤新增表單欄位
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-6">
                {processedFields
                  .sort((a, b) => a.order - b.order)
                  .map((field, index) => renderPreviewField(field, index))}
              </div>

              {/* Photo Upload Section */}
              <div className="mt-8 pt-8 border-t border-gray-100">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="block text-sm font-medium text-gray-700">
                      附錄 (選填)
                    </label>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        // No-op: dummy button for preview only
                      }}
                      className="cursor-pointer inline-flex items-center px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <span className="ml-1.5">上傳照片</span>
                    </button>
                  </div>
                  <div className="text-center py-12 text-gray-500 text-sm border-2 border-dashed border-gray-200 rounded-lg">
                    <p>尚無附錄照片</p>
                    <p className="text-xs mt-2 text-gray-400">點擊上方按鈕上傳照片</p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
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
    <div className="group border-b md:border border-gray-200 md:rounded-xl p-5 md:p-5 bg-white md:hover:border-blue-200 md:hover:shadow-md transition-all">
      {/* Hidden input to preserve field ID during updates */}
      <input type="hidden" {...register(`fields.${index}.id`)} />

      <div className="flex items-start gap-3 md:gap-5">
        {/* Move buttons - Column version for desktop, row for mobile? No, let's keep it consistent but nicer */}
        <div className="flex flex-col gap-1 mt-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            title="上移"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            title="下移"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {/* Field content */}
        <div className="flex-1 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField name={`fields.${index}.label`} label="欄位名稱">
              <FormInput
                name={`fields.${index}.label`}
                placeholder="例如：體重、血壓"
                className="w-full"
              />
            </FormField>
            <FormField name={`fields.${index}.type`} label="欄位類型">
              <select
                {...register(`fields.${index}.type`)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-sm"
              >
                {FIELD_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <FormField name={`fields.${index}.description`} label="欄位說明（選填）">
              <FormInput
                name={`fields.${index}.description`}
                placeholder="例如：請填寫收縮壓與舒張壓"
                className="w-full"
              />
            </FormField>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  {...register(`fields.${index}.required`)}
                  className="w-4 h-4 border-gray-300 rounded text-blue-600 focus:ring-blue-500 transition-colors"
                />
                <span className="text-sm font-medium text-gray-700">必填欄位</span>
              </label>
            </div>
          </div>

          {needsOptions && (
            <div className="pt-2">
              <FormField name={`fields.${index}.options`} label="選項設定 (每行一個選項)">
                <FormTextarea
                  name={`fields.${index}.options`}
                  placeholder="選項 1&#10;選項 2&#10;選項 3"
                  rows={3}
                  className="w-full text-sm font-mono"
                />
              </FormField>
            </div>
          )}
        </div>

        {/* Remove button */}
        <button
          type="button"
          onClick={onRemove}
          className="mt-1 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all opacity-40 group-hover:opacity-100"
          title="刪除欄位"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
};

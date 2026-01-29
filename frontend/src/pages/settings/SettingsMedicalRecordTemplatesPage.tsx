import React, { useState } from 'react';
import { useMedicalRecordTemplates, useMedicalRecordTemplateMutations } from '../../hooks/queries/useMedicalRecordTemplates';
import { MedicalRecordTemplate } from '../../types';
import { Button, LoadingSpinner, BaseModal, SearchInput, ModalHeader, ModalBody, ModalFooter } from '../../components/shared';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { clsx } from 'clsx';

// --- Validation Schema ---

const fieldSchema = z.object({
    id: z.string(),
    label: z.string().min(1, '請輸入欄位名稱'),
    type: z.enum(['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'radio']),
    placeholder: z.string().optional(),
    unit: z.string().optional(),
    required: z.boolean(),
    options: z.array(z.string()).optional(),
});

const templateSchema = z.object({
    name: z.string().min(1, '請輸入範本名稱'),
    is_active: z.boolean(),
    header_fields: z.array(fieldSchema),
    workspace_config: z.object({
        backgroundImageUrl: z.string().optional(),
        base_layers: z.array(z.any()).optional(),
    }),
});

interface TemplateFormValues {
    name: string;
    is_active: boolean;
    header_fields: {
        id: string;
        label: string;
        type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'radio';
        placeholder?: string | undefined;
        unit?: string | undefined;
        required: boolean;
        options?: string[] | undefined;
    }[];
    workspace_config: {
        backgroundImageUrl?: string | undefined;
        base_layers?: any[] | undefined;
    };
}

// --- Components ---

const SettingsMedicalRecordTemplatesPage: React.FC = () => {
    const [showInactive, setShowInactive] = useState(false);
    const { data: templates, isLoading } = useMedicalRecordTemplates(true, showInactive);
    const { createMutation, updateMutation, deleteMutation } = useMedicalRecordTemplateMutations();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState<MedicalRecordTemplate | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    const filteredTemplates = templates?.filter(t => {
        const matchesSearch = t.name.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus = showInactive || t.is_active;
        return matchesSearch && matchesStatus;
    });

    const handleCreate = () => {
        setEditingTemplate(null);
        setIsModalOpen(true);
    };

    const handleEdit = (template: MedicalRecordTemplate) => {
        setEditingTemplate(template);
        setIsModalOpen(true);
    };

    const handleDelete = async (id: number) => {
        if (window.confirm('確定要停用此範本嗎？停用後將無法用於建立新病歷。')) {
            await deleteMutation.mutateAsync(id);
        }
    };

    if (isLoading) return <LoadingSpinner size="xl" fullScreen />;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h2 className="text-2xl font-bold text-gray-900">病歷範本管理</h2>
                <Button
                    onClick={handleCreate}
                    variant="primary"
                    className="shadow-sm"
                >
                    <span className="mr-2">➕</span> 新增範本
                </Button>
            </div>

            {/* Search and Filters */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="max-w-md flex-1">
                    <SearchInput
                        value={searchQuery}
                        onChange={setSearchQuery}
                        placeholder="搜尋範本名稱..."
                    />
                </div>
                <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-white/50 transition-colors">
                    <input
                        type="checkbox"
                        checked={showInactive}
                        onChange={(e) => setShowInactive(e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm font-medium text-gray-600">顯示已停用範本</span>
                </label>
            </div>

            {/* Template List */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredTemplates?.map(template => (
                    <div
                        key={template.id}
                        className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-all group relative overflow-hidden"
                    >
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 group-hover:text-primary-600 transition-colors">
                                    {template.name}
                                </h3>
                                <p className="text-sm text-gray-500 mt-1">
                                    欄位數量: {template.header_fields.length}
                                </p>
                            </div>
                            <span className={clsx(
                                "px-2.5 py-1 rounded-full text-xs font-medium",
                                template.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"
                            )}>
                                {template.is_active ? '啟用中' : '未啟用'}
                            </span>
                        </div>

                        <div className="flex items-center gap-2 mt-auto pt-4 border-t border-gray-50">
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleEdit(template)}
                                className="flex-1"
                            >
                                編輯
                            </Button>
                            <Button
                                variant="danger"
                                size="sm"
                                onClick={() => handleDelete(template.id)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                🗑️
                            </Button>
                        </div>
                    </div>
                ))}

                {filteredTemplates?.length === 0 && (
                    <div className="col-span-full py-20 text-center bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200">
                        <p className="text-gray-500">找不到任何範本，請點擊右上方「新增範本」開始建立。</p>
                    </div>
                )}
            </div>

            {/* Edit/Create Modal */}
            {isModalOpen && (
                <TemplateFormModal
                    onClose={() => setIsModalOpen(false)}
                    initialData={editingTemplate}
                    onSubmit={async (data) => {
                        if (editingTemplate) {
                            await updateMutation.mutateAsync({ id: editingTemplate.id, data: data as Partial<MedicalRecordTemplate> });
                        } else {
                            await createMutation.mutateAsync(data as Partial<MedicalRecordTemplate>);
                        }
                        setIsModalOpen(false);
                    }}
                />
            )}
        </div>
    );
};

// --- Form Modal Component ---

interface TemplateFormModalProps {
    onClose: () => void;
    initialData: MedicalRecordTemplate | null;
    onSubmit: (data: TemplateFormValues) => Promise<void>;
}

const TemplateFormModal: React.FC<TemplateFormModalProps> = ({ onClose, initialData, onSubmit }) => {
    const {
        register,
        control,
        handleSubmit,
        formState: { errors, isSubmitting },
        watch,
    } = useForm<TemplateFormValues>({
        resolver: zodResolver(templateSchema),
        defaultValues: initialData ? {
            name: initialData.name,
            is_active: initialData.is_active,
            header_fields: initialData.header_fields.map(f => ({
                ...f,
                options: f.options || undefined
            })),
            workspace_config: {
                backgroundImageUrl: initialData.workspace_config.backgroundImageUrl || '',
                base_layers: initialData.workspace_config.base_layers || [],
            },
        } : {
            name: '',
            is_active: true,
            header_fields: [],
            workspace_config: {
                backgroundImageUrl: '',
                base_layers: [],
            },
        },
    });

    const { fields, append, remove } = useFieldArray({
        control,
        name: 'header_fields',
    });

    const addField = () => {
        append({
            id: Math.random().toString(36).substring(2, 9),
            label: '',
            type: 'text',
            required: false,
            options: undefined,
        });
    };

    return (
        <BaseModal
            onClose={onClose}
            className="max-w-4xl"
        >
            <ModalHeader
                title={initialData ? '編輯範本' : '新增範本'}
                showClose
                onClose={onClose}
            />
            <ModalBody>
                <form id="template-form" onSubmit={handleSubmit(onSubmit)} className="space-y-8 p-1">
                    {/* Basic Info */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-gray-700">範本名稱</label>
                            <input
                                {...register('name')}
                                placeholder="例如: 初診評估、追蹤紀錄"
                                className={clsx(
                                    "w-full px-4 py-3 rounded-xl border transition-all focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none",
                                    errors.name ? "border-red-300 bg-red-50" : "border-gray-200 bg-gray-50"
                                )}
                            />
                            {errors.name && <p className="text-xs text-red-500 ml-1">{errors.name.message}</p>}
                        </div>

                        <div className="space-y-2 flex flex-col justify-end">
                            <label className="flex items-center gap-3 cursor-pointer group p-3 rounded-xl hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100">
                                <input
                                    type="checkbox"
                                    {...register('is_active')}
                                    className="w-5 h-5 rounded-md border-gray-300 text-primary-600 focus:ring-primary-500 transition-all"
                                />
                                <span className="text-sm font-semibold text-gray-700">啟用此範本</span>
                            </label>
                        </div>
                    </div>

                    {/* Workspace Config */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-bold text-gray-900 border-b pb-2 flex items-center gap-2">
                            🖌️ 工作區配置
                        </h3>
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-gray-700">底圖 URL (可選)</label>
                            <input
                                {...register('workspace_config.backgroundImageUrl')}
                                placeholder="https://example.com/body-chart.png"
                                className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                            />
                            <p className="text-xs text-gray-500">提供底圖 URL，讓治療師在病歷中進行標記。</p>
                        </div>
                    </div>

                    {/* Header Fields Builder */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between border-b pb-2">
                            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                🧩 結構化欄位
                            </h3>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={addField}
                                className="rounded-lg"
                            >
                                ➕ 新增欄位
                            </Button>
                        </div>

                        <div className="space-y-4">
                            {fields.map((field, index) => (
                                <div
                                    key={field.id}
                                    className="p-5 bg-white border border-gray-100 rounded-2xl shadow-sm hover:border-primary-100 transition-all relative group/field"
                                >
                                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-start">
                                        {/* Field Label */}
                                        <div className="sm:col-span-5 space-y-1">
                                            <label className="text-[10px] uppercase tracking-wider font-bold text-gray-400 ml-1">欄位名稱</label>
                                            <input
                                                {...register(`header_fields.${index}.label`)}
                                                placeholder="欄位名稱"
                                                className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-primary-500 outline-none transition-all text-sm"
                                            />
                                        </div>

                                        {/* Field Type */}
                                        <div className="sm:col-span-3 space-y-1">
                                            <label className="text-[10px] uppercase tracking-wider font-bold text-gray-400 ml-1">類型</label>
                                            <select
                                                {...register(`header_fields.${index}.type`)}
                                                className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-primary-500 outline-none bg-white text-sm"
                                            >
                                                <option value="text">文字</option>
                                                <option value="textarea">多行文字</option>
                                                <option value="number">數字</option>
                                                <option value="date">日期</option>
                                                <option value="select">單選選單</option>
                                                <option value="checkbox">複選方塊</option>
                                                <option value="radio">單選按鈕</option>
                                            </select>
                                        </div>

                                        {/* Placeholder */}
                                        <div className="sm:col-span-2 space-y-1">
                                            <label className="text-[10px] uppercase tracking-wider font-bold text-gray-400 ml-1">提示文字</label>
                                            <input
                                                {...register(`header_fields.${index}.placeholder`)}
                                                placeholder="提示文字"
                                                className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-primary-500 outline-none transition-all text-sm"
                                            />
                                        </div>

                                        {/* Unit */}
                                        <div className="sm:col-span-1 space-y-1">
                                            <label className="text-[10px] uppercase tracking-wider font-bold text-gray-400 ml-1">單位</label>
                                            <input
                                                {...register(`header_fields.${index}.unit`)}
                                                placeholder="如: kg"
                                                className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-primary-500 outline-none transition-all text-sm"
                                            />
                                        </div>

                                        {/* Field Required */}
                                        <div className="sm:col-span-2 flex items-center justify-center pt-6">
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    {...register(`header_fields.${index}.required`)}
                                                    className="w-4 h-4 rounded text-primary-600 focus:ring-primary-500"
                                                />
                                                <span className="text-xs font-semibold text-gray-600">必填</span>
                                            </label>
                                        </div>

                                        {/* Actions */}
                                        <div className="sm:col-span-1 flex items-center justify-center pt-6">
                                            <button
                                                type="button"
                                                onClick={() => remove(index)}
                                                className="text-gray-400 hover:text-red-500 transition-colors p-1"
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    </div>

                                    {/* Options for types that need them */}
                                    {['select', 'checkbox', 'radio'].includes(watch(`header_fields.${index}.type`)) && (
                                        <div className="mt-4 pt-4 border-t border-gray-50 space-y-2">
                                            <div className="flex items-center justify-between">
                                                <label className="text-[10px] uppercase tracking-wider font-bold text-gray-400 ml-1">選項 (每行一個)</label>
                                                <span className="text-[10px] text-gray-400">支援包含逗號的文字</span>
                                            </div>
                                            <textarea
                                                placeholder={`選項 A\n選項 B\n選項 C`}
                                                rows={3}
                                                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-primary-500 outline-none resize-none"
                                                {...register(`header_fields.${index}.options`, {
                                                    setValueAs: (v) => {
                                                        if (Array.isArray(v)) return v;
                                                        if (typeof v !== 'string') return [];
                                                        // Handle both comma-separated (legacy) and newline-separated
                                                        const delimiter = v.includes('\n') ? '\n' : ',';
                                                        return v.split(delimiter).map((s: string) => s.trim()).filter(Boolean);
                                                    },
                                                    // When displaying, we want to show it as newline-separated if it's already an array
                                                    // but react-hook-form value for textarea should be a string.
                                                })}
                                                // Map the array value back to string for display in textarea
                                                value={Array.isArray(watch(`header_fields.${index}.options`))
                                                    ? (watch(`header_fields.${index}.options`) as string[]).join('\n')
                                                    : watch(`header_fields.${index}.options`)}
                                                onChange={(e) => {
                                                    // Manual update to bypass default register behavior if needed, 
                                                    // but let's try the simple way first.
                                                    control._fields[`header_fields.${index}.options` as any] &&
                                                        control.register(`header_fields.${index}.options` as any).onChange({
                                                            target: { name: `header_fields.${index}.options`, value: e.target.value }
                                                        } as any);
                                                }}
                                            />
                                        </div>
                                    )}
                                </div>
                            ))}

                            {fields.length === 0 && (
                                <div className="text-center py-10 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-100">
                                    <p className="text-sm text-gray-400 italic">尚未添加欄位。點擊「新增欄位」開始自定義病歷結構。</p>
                                </div>
                            )}
                        </div>
                    </div>
                </form>
            </ModalBody>
            <ModalFooter>
                <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
                    取消
                </Button>
                <Button type="submit" form="template-form" variant="primary" disabled={isSubmitting}>
                    {isSubmitting ? '儲存中...' : '儲存範本'}
                </Button>
            </ModalFooter>
        </BaseModal>
    );
};

export default SettingsMedicalRecordTemplatesPage;

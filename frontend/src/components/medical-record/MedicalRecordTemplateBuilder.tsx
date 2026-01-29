import React, { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { Button } from '../shared';
import { MedicalRecordTemplate } from '../../types';

interface Field {
    id: string;
    label: string;
    type: 'text' | 'number' | 'date' | 'select';
    required: boolean;
    options?: string[];
}

interface MedicalRecordTemplateBuilderProps {
    template?: MedicalRecordTemplate;
    onClose: () => void;
    onSave: () => void;
}

const FIELD_TYPES = [
    { value: 'text', label: '文字' },
    { value: 'number', label: '數字' },
    { value: 'date', label: '日期' },
    { value: 'select', label: '下拉選單' },
];

const MedicalRecordTemplateBuilder: React.FC<MedicalRecordTemplateBuilderProps> = ({
    template,
    onClose,
    onSave,
}) => {
    const [name, setName] = useState(template?.name || '');
    const [fields, setFields] = useState<Field[]>(
        (template?.header_fields as Field[]) || []
    );
    const [isActive, setIsActive] = useState(template?.is_active ?? true);
    const [baseLayers, setBaseLayers] = useState<any[]>(
        template?.workspace_config?.base_layers || []
    );

    const mutation = useMutation({
        mutationFn: (data: any) =>
            template
                ? apiService.updateMedicalRecordTemplate(template.id, data)
                : apiService.createMedicalRecordTemplate(data),
        onSuccess: onSave,
    });

    const addField = () => {
        const newField: Field = {
            id: Math.random().toString(36).substr(2, 9),
            label: '',
            type: 'text',
            required: false,
        };
        setFields([...fields, newField]);
    };

    const updateField = (id: string, updates: Partial<Field>) => {
        setFields(fields.map((f) => (f.id === id ? { ...f, ...updates } : f)));
    };

    const removeField = (id: string) => {
        setFields(fields.filter((f) => f.id !== id));
    };

    const handleSave = () => {
        if (!name.trim()) {
            alert('請輸入模板名稱');
            return;
        }
        mutation.mutate({
            name,
            header_fields: fields,
            workspace_config: { base_layers: baseLayers },
            is_active: isActive,
        });
    };

    return (
        <div className="flex flex-col h-full space-y-6">
            <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-gray-100 shadow-sm sticky top-0 z-10">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <h2 className="text-xl font-bold text-gray-900">
                        {template ? '編輯模板' : '建立新模板'}
                    </h2>
                </div>
                <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                        <input
                            type="checkbox"
                            checked={isActive}
                            onChange={(e) => setIsActive(e.target.checked)}
                            className="rounded text-primary-600 focus:ring-primary-500"
                        />
                        啟用模板
                    </label>
                    <Button
                        variant="primary"
                        onClick={handleSave}
                        loading={mutation.isPending}
                    >
                        儲存模板
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left Column: General Info & Fields */}
                <div className="space-y-6">
                    <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm space-y-4">
                        <h3 className="text-lg font-semibold text-gray-900 border-b pb-2">基本資訊</h3>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">模板名稱</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="例如：初診評估表"
                                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 transition-all"
                            />
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm space-y-4">
                        <div className="flex justify-between items-center border-b pb-2">
                            <h3 className="text-lg font-semibold text-gray-900">表頭欄位 (Structured Header)</h3>
                            <Button size="sm" variant="secondary" onClick={addField}>
                                + 新增欄位
                            </Button>
                        </div>

                        <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                            {fields.map((field, index) => (
                                <div key={field.id} className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3 relative group">
                                    <button
                                        onClick={() => removeField(field.id)}
                                        className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                                    >
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-medium text-gray-500 mb-1">欄位名稱</label>
                                            <input
                                                type="text"
                                                value={field.label}
                                                onChange={(e) => updateField(field.id, { label: e.target.value })}
                                                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-500 mb-1">類型</label>
                                            <select
                                                value={field.type}
                                                onChange={(e) => updateField(field.id, { type: e.target.value as any })}
                                                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500"
                                            >
                                                {FIELD_TYPES.map((t) => (
                                                    <option key={t.value} value={t.value}>{t.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4">
                                        <label className="flex items-center gap-2 text-xs text-gray-600">
                                            <input
                                                type="checkbox"
                                                checked={field.required}
                                                onChange={(e) => updateField(field.id, { required: e.target.checked })}
                                                className="rounded text-primary-600"
                                            />
                                            必填
                                        </label>

                                        {field.type === 'select' && (
                                            <div className="flex-1">
                                                <label className="block text-xs font-medium text-gray-500 mb-1">選項 (逗號分隔)</label>
                                                <input
                                                    type="text"
                                                    value={field.options?.join(', ') || ''}
                                                    onChange={(e) => updateField(field.id, { options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                                                    className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500"
                                                    placeholder="選項 1, 選項 2, 選項 3"
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {fields.length === 0 && (
                                <div className="text-center py-8 text-gray-400 text-sm">
                                    尚未新增任何欄位
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Column: Workspace Config */}
                <div className="space-y-6">
                    <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm space-y-4">
                        <h3 className="text-lg font-semibold text-gray-900 border-b pb-2">工作區設定 (Workspace)</h3>
                        <p className="text-sm text-gray-500 mb-4">
                            設定臨床工作區中的預設底圖。醫師可以在這些底圖上進行書寫、標註。
                        </p>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-gray-700">底圖清單</span>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => {
                                        const url = window.prompt('請輸入底圖圖片網址 (暫時使用 URL，之後改為上傳)');
                                        if (url) {
                                            setBaseLayers([...baseLayers, {
                                                id: Math.random().toString(36).substr(2, 9),
                                                url,
                                                name: '底圖 ' + (baseLayers.length + 1),
                                                type: 'image'
                                            }]);
                                        }
                                    }}
                                >
                                    + 新增底圖
                                </Button>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                {baseLayers.map((layer) => (
                                    <div key={layer.id} className="relative group rounded-lg overflow-hidden border border-gray-200">
                                        <img src={layer.url} alt={layer.name} className="w-full h-32 object-cover" />
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                            <button
                                                onClick={() => setBaseLayers(baseLayers.filter(l => l.id !== layer.id))}
                                                className="p-1.5 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </button>
                                        </div>
                                        <div className="p-2 bg-white text-xs font-medium text-gray-700 truncate">
                                            {layer.name}
                                        </div>
                                    </div>
                                ))}
                                {baseLayers.length === 0 && (
                                    <div className="col-span-2 py-8 text-center bg-gray-50 rounded-lg text-gray-400 text-sm">
                                        尚未設定底圖
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Live Preview (Placeholder for now) */}
                    <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-xl space-y-4 h-[400px] flex flex-col">
                        <h3 className="text-lg font-semibold text-white border-b border-gray-700 pb-2 flex items-center gap-2">
                            <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                            即時預覽
                        </h3>
                        <div className="flex-1 flex items-center justify-center text-gray-500 italic text-sm text-center px-8">
                            這是一個預覽區域。當您在左側新增欄位或底圖時，這裡將顯示醫師在診間看到的實際介面。
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MedicalRecordTemplateBuilder;

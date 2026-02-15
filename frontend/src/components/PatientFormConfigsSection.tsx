import React, { useState, useMemo } from 'react';
import { useFormContext, useFieldArray } from 'react-hook-form';
import { useMedicalRecordTemplates } from '../hooks/useMedicalRecordTemplates';
import { useAuth } from '../hooks/useAuth';
import { BaseModal } from './shared/BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from './shared/ModalParts';
import { TimeInput } from './shared';
import { useModal } from '../contexts/ModalContext';


interface PatientFormConfigsSectionProps {
    disabled?: boolean;
}

interface PatientFormConfigFormData {
    medical_record_template_id: number;
    timing_type: 'before' | 'after';
    timing_mode: 'hours' | 'specific_time';
    hours?: number | null;
    days?: number | null;
    time_of_day?: string | null;
    on_impossible?: 'send_immediately' | 'skip' | null;
    is_enabled: boolean;
    display_order: number;
}

export const PatientFormConfigsSection: React.FC<PatientFormConfigsSectionProps> = ({
    disabled = false,
}) => {
    const { control, watch, formState: { errors } } = useFormContext();
    const { user } = useAuth();
    const { confirm } = useModal();
    const { fields, append, remove, update } = useFieldArray({
        control,
        name: 'patient_form_configs',
    });

    // Re-index display_order when fields change
    React.useEffect(() => {
        fields.forEach((field, idx) => {
            const f = field as any;
            if (f.display_order !== idx) {
                update(idx, { ...f, display_order: idx });
            }
        });
    }, [fields.length, update]);

    const { data: templates = [] } = useMedicalRecordTemplates(user?.active_clinic_id);

    // Only show templates that are marked as patient forms and not deleted
    const patientFormTemplates = useMemo(() =>
        templates.filter(t => t.is_patient_form && !t.is_deleted),
        [templates]
    );

    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [isNewItem, setIsNewItem] = useState(false);
    const [formData, setFormData] = useState<PatientFormConfigFormData | null>(null);

    const getTemplateName = (id: number) => {
        return patientFormTemplates.find(t => t.id === id)?.name || '未知模板';
    };

    const handleAdd = () => {
        if (patientFormTemplates.length === 0) return;
        setIsNewItem(true);
        setFormData({
            medical_record_template_id: patientFormTemplates[0]!.id,
            timing_type: 'before',
            timing_mode: 'hours',
            hours: 24,
            days: 1,
            time_of_day: '09:00',
            on_impossible: 'send_immediately',
            is_enabled: true,
            display_order: fields.length,
        });
    };

    const handleEdit = (index: number) => {
        const field = fields[index] as any;
        setEditingIndex(index);
        setIsNewItem(false);
        setFormData({
            medical_record_template_id: field.medical_record_template_id,
            timing_type: field.timing_type,
            timing_mode: field.timing_mode,
            hours: field.hours,
            days: field.days,
            time_of_day: field.time_of_day,
            on_impossible: field.on_impossible,
            is_enabled: field.is_enabled,
            display_order: field.display_order,
        });
    };

    const handleSave = () => {
        if (!formData) return;

        if (isNewItem) {
            append(formData);
        } else if (editingIndex !== null) {
            update(editingIndex, {
                ...fields[editingIndex],
                ...formData
            });
        }

        setEditingIndex(null);
        setIsNewItem(false);
        setFormData(null);
    };

    const handleRemove = async (index: number) => {
        const confirmed = await confirm('確定要刪除此自動發送設定嗎？', '刪除設定');
        if (confirmed) {
            remove(index);
        }
    };

    const patientFormConfigs = watch('patient_form_configs') || [];

    const renderConfigItem = (field: any, index: number) => {
        const config = patientFormConfigs[index];
        if (!config) return null;

        return (
            <div
                key={field.id}
                className={`bg-white border rounded-xl p-4 transition-all duration-200 hover:border-blue-300 hover:shadow-sm ${!config.is_enabled ? 'opacity-60 bg-gray-50' : 'border-gray-200'
                    }`}
            >
                <div className="flex justify-between items-start mb-3">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-gray-900 truncate">
                                {getTemplateName(config.medical_record_template_id)}
                            </span>
                            {!config.is_enabled && (
                                <span className="px-1.5 py-0.5 bg-gray-200 text-gray-500 text-[10px] font-bold rounded uppercase tracking-wider">
                                    已停用
                                </span>
                            )}
                        </div>
                        <div className="text-sm text-gray-600 flex flex-wrap items-center gap-x-4 gap-y-1">
                            <div className="flex items-center gap-1.5">
                                <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span>{config.timing_type === 'before' ? '預約前' : '預約後'}</span>
                                <span className="font-medium text-blue-700">
                                    {config.timing_mode === 'hours'
                                        ? `${config.hours} 小時`
                                        : `${config.days} 天 ${config.time_of_day}`}
                                </span>
                            </div>
                            {(errors.patient_form_configs as any)?.[index] && (
                                <div className="flex items-center gap-1.5 text-xs text-red-500 font-medium">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    <span>資料格式錯誤</span>
                                </div>
                            )}
                            {config.timing_type === 'before' && (
                                <div className="flex items-center gap-1.5">
                                    <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    <span>過期時：</span>
                                    <span className="font-medium text-amber-700">
                                        {config.on_impossible === 'send_immediately' ? '立即補發' : '直接跳過'}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                        <button
                            type="button"
                            onClick={() => handleEdit(index)}
                            disabled={disabled}
                            className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                        >
                            編輯
                        </button>
                        <button
                            type="button"
                            onClick={() => handleRemove(index)}
                            disabled={disabled}
                            className="text-xs text-red-600 hover:text-red-800 disabled:text-gray-400 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                        >
                            刪除
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={handleAdd}
                    disabled={disabled || patientFormTemplates.length === 0}
                    className="text-sm text-blue-600 hover:text-blue-800 disabled:text-gray-400 font-medium flex items-center gap-1"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    新增設定
                </button>
            </div>

            {fields.length === 0 ? (
                <div className="text-center py-10 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/50">
                    <div className="bg-white w-12 h-12 rounded-full shadow-sm border border-gray-50 flex items-center justify-center mx-auto mb-3">
                        <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    </div>
                    <p className="text-gray-400 text-sm">尚未設定自動發送表單</p>
                    {patientFormTemplates.length === 0 && (
                        <p className="mt-2 text-xs text-amber-500 font-medium">請先於「病歷模板」建立病患表單</p>
                    )}
                </div>
            ) : (
                <div className="space-y-3">
                    {fields.map((field, index) => renderConfigItem(field, index))}
                </div>
            )}

            {(isNewItem || editingIndex !== null) && formData && (
                <BaseModal
                    onClose={() => {
                        setEditingIndex(null);
                        setIsNewItem(false);
                        setFormData(null);
                    }}
                    className="max-w-lg"
                >
                    <ModalHeader
                        title={isNewItem ? '新增自動發送設定' : '編輯自動發送設定'}
                        showClose
                        onClose={() => {
                            setEditingIndex(null);
                            setIsNewItem(false);
                            setFormData(null);
                        }}
                    />
                    <ModalBody>
                        <div className="space-y-6">
                            {/* Template Selection */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">
                                    表單模板 <span className="text-red-500">*</span>
                                </label>
                                <select
                                    value={formData.medical_record_template_id}
                                    onChange={(e) => setFormData(prev => prev ? ({ ...prev, medical_record_template_id: Number(e.target.value) }) : null)}
                                    className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                >
                                    {patientFormTemplates.map(t => (
                                        <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                {/* Timing Type */}
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                                        發送時機 <span className="text-red-500">*</span>
                                    </label>
                                    <div className="flex bg-gray-100 p-1 rounded-lg">
                                        <button
                                            type="button"
                                            onClick={() => setFormData(prev => prev ? ({ ...prev, timing_type: 'before', on_impossible: 'send_immediately' }) : null)}
                                            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${formData.timing_type === 'before' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                                }`}
                                        >
                                            預約前
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setFormData(prev => prev ? ({ ...prev, timing_type: 'after', on_impossible: null }) : null)}
                                            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${formData.timing_type === 'after' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                                }`}
                                        >
                                            預約後
                                        </button>
                                    </div>
                                </div>

                                {/* Timing Mode */}
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                                        時間模式 <span className="text-red-500">*</span>
                                    </label>
                                    <div className="flex bg-gray-100 p-1 rounded-lg">
                                        <button
                                            type="button"
                                            onClick={() => setFormData(prev => prev ? ({ ...prev, timing_mode: 'hours' }) : null)}
                                            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${formData.timing_mode === 'hours' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                                }`}
                                        >
                                            小時
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setFormData(prev => prev ? ({ ...prev, timing_mode: 'specific_time' }) : null)}
                                            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${formData.timing_mode === 'specific_time' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                                }`}
                                        >
                                            特定時間
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Timing Values */}
                            {formData.timing_mode === 'hours' ? (
                                <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                                    <label className="block text-sm font-semibold text-blue-800 mb-2">
                                        發送時間
                                    </label>
                                    <div className="flex items-center gap-2 text-blue-700 text-sm font-medium">
                                        <span>預約「{formData.timing_type === 'before' ? '開始前' : '結束後'}」</span>
                                        <input
                                            type="number"
                                            value={formData.hours ?? 0}
                                            onChange={(e) => setFormData(prev => prev ? ({ ...prev, hours: Number(e.target.value) }) : null)}
                                            className="w-20 bg-white border border-blue-200 rounded-lg px-2 py-1 text-center text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                            min="0"
                                        />
                                        <span>小時發送</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                                    <label className="block text-sm font-semibold text-blue-800 mb-2">
                                        發送時間
                                    </label>
                                    <div className="flex flex-wrap items-center gap-2 text-blue-700 text-sm font-medium">
                                        <span>預約日期的「{formData.timing_type === 'before' ? '前' : '後'}」</span>
                                        <input
                                            type="number"
                                            value={formData.days ?? 1}
                                            onChange={(e) => setFormData(prev => prev ? ({ ...prev, days: Math.max(1, Number(e.target.value)) }) : null)}
                                            className="w-16 bg-white border border-blue-200 rounded-lg px-2 py-1 text-center text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                            min="1"
                                        />
                                        <span>天的</span>
                                        <TimeInput
                                            value={formData.time_of_day || '09:00'}
                                            onChange={(value) => setFormData(prev => prev ? ({ ...prev, time_of_day: value }) : null)}
                                            className="w-28"
                                        />
                                        <span>發送</span>
                                    </div>
                                </div>
                            )}

                            {/* On Impossible Handling (Only for 'before') */}
                            {formData.timing_type === 'before' && (
                                <div className="bg-amber-50 p-4 rounded-xl border border-amber-100">
                                    <label className="block text-sm font-semibold text-amber-800 mb-2">
                                        若預約建立時已過發送時間
                                    </label>
                                    <div className="flex bg-amber-100/50 p-1 rounded-lg mb-2">
                                        <button
                                            type="button"
                                            onClick={() => setFormData(prev => prev ? ({ ...prev, on_impossible: 'send_immediately' }) : null)}
                                            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${formData.on_impossible === 'send_immediately' ? 'bg-white text-amber-700 shadow-sm' : 'text-amber-600 hover:text-amber-800'
                                                }`}
                                        >
                                            立即補發
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setFormData(prev => prev ? ({ ...prev, on_impossible: 'skip' }) : null)}
                                            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${formData.on_impossible === 'skip' ? 'bg-white text-amber-700 shadow-sm' : 'text-amber-600 hover:text-amber-800'
                                                }`}
                                        >
                                            直接跳過
                                        </button>
                                    </div>
                                    <p className="text-[11px] text-amber-700 leading-relaxed font-medium">
                                        {formData.on_impossible === 'send_immediately'
                                            ? '說明：若預約較趕（例：1小時後看診），系統會立即發送表單。'
                                            : '說明：若預約較趕（例：1小時後看診），系統將不會發送此表單。'}
                                    </p>
                                </div>
                            )}

                            <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                                <span className="text-sm font-semibold text-gray-700">啟用此自動發送設定</span>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={formData.is_enabled}
                                        onChange={(e) => setFormData(prev => prev ? ({ ...prev, is_enabled: e.target.checked }) : null)}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                </label>
                            </div>
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <button
                            type="button"
                            onClick={() => {
                                setEditingIndex(null);
                                setIsNewItem(false);
                                setFormData(null);
                            }}
                            className="btn-secondary"
                        >
                            取消
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            className="btn-primary"
                        >
                            儲存設定
                        </button>
                    </ModalFooter>
                </BaseModal>
            )}
        </div>
    );
};

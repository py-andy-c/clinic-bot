import React, { useState, useEffect } from 'react';
import { AppointmentType } from '../types';
import { PatientFormSetting } from '../types/medicalRecord';
import { apiService } from '../services/api';
import { PlaceholderHelper } from './PlaceholderHelper';
import { LoadingSpinner } from './shared/LoadingSpinner';
import { BaseModal } from './shared/BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from './shared/ModalParts';
import { TimeInput } from './shared/TimeInput';
import { generateTemporaryId } from '../utils/idUtils';
import { isTemporaryServiceItemId } from '../utils/idUtils';
import { logger } from '../utils/logger';
import { useNumberInput } from '../hooks/useNumberInput';
import { useMedicalRecordTemplates } from '../hooks/useMedicalRecordTemplates';
import { usePatientFormSettings } from '../hooks/usePatientForms';
import { useAuth } from '../hooks/useAuth';

interface PatientFormSettingsSectionProps {
    appointmentType: AppointmentType;
    onUpdate: (updated: AppointmentType) => void;
    disabled?: boolean;
}

export const PatientFormSettingsSection: React.FC<PatientFormSettingsSectionProps> = ({
    appointmentType,
    onUpdate,
    disabled = false,
}) => {
    const { user } = useAuth();
    const activeClinicId = user?.active_clinic_id;
    const isNewItem = isTemporaryServiceItemId(appointmentType.id);

    const [patientFormSettings, setPatientFormSettings] = useState<PatientFormSetting[]>(
        appointmentType.patient_form_settings || []
    );
    
    const { data: fetchedSettings, isLoading: loading } = usePatientFormSettings(
        !isNewItem && appointmentType.id && appointmentType.patient_form_settings === undefined ? appointmentType.id : null
    );

    const [editingSetting, setEditingSetting] = useState<PatientFormSetting | null>(null);
    const [isNewSetting, setIsNewSetting] = useState(false);
    
    const [formData, setFormData] = useState<Partial<PatientFormSetting>>({
        timing_mode: 'immediate',
        message_template: '',
        flex_button_text: '填寫表單',
        notify_admin: false,
        notify_appointment_practitioner: false,
        notify_assigned_practitioner: false,
        is_enabled: true,
    });

    const [formErrors, setFormErrors] = useState<Record<string, string>>({});
    const [previewModal, setPreviewModal] = useState<{
        isOpen: boolean;
        setting: PatientFormSetting | null;
    }>({ isOpen: false, setting: null });
    const [previewData, setPreviewData] = useState<{
        preview_message: string;
        used_placeholders: Record<string, string>;
        completeness_warnings?: string[];
    } | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);

    const { data: templates } = useMedicalRecordTemplates(activeClinicId, 'patient_form');
    // const { alert } = useModal();

    const hoursAfterInput = useNumberInput(
        formData.hours_after ?? 0,
        (value: number) => setFormData(prev => ({ ...prev, hours_after: value })),
        { fallback: 0, parseFn: 'parseInt', min: 0 }
    );

    const daysAfterInput = useNumberInput(
        formData.days_after ?? 0,
        (value: number) => setFormData(prev => ({ ...prev, days_after: value })),
        { fallback: 0, parseFn: 'parseInt', min: 0 }
    );

    useEffect(() => {
        if (fetchedSettings) {
            const sorted = [...fetchedSettings].sort((a, b) => a.display_order - b.display_order);
            setPatientFormSettings(sorted);
            onUpdate({ ...appointmentType, patient_form_settings: sorted });
        }
    }, [fetchedSettings, appointmentType, onUpdate]);

    useEffect(() => {
        if (appointmentType.patient_form_settings !== undefined) {
            setPatientFormSettings(appointmentType.patient_form_settings);
        }
    }, [appointmentType.patient_form_settings]);

    const updateStagedSettings = (settings: PatientFormSetting[]) => {
        setPatientFormSettings(settings);
        onUpdate({ ...appointmentType, patient_form_settings: settings });
    };

    const handleAddSetting = () => {
        setIsNewSetting(true);
        setEditingSetting(null);
        setFormData({
            timing_mode: 'immediate',
            message_template: '親愛的 {病患姓名}，請填寫以下表單：\n\n{表單連結}\n\n謝謝！',
            flex_button_text: '填寫表單',
            notify_admin: false,
            notify_appointment_practitioner: false,
            notify_assigned_practitioner: false,
            is_enabled: true,
            display_order: patientFormSettings.length,
        });
        setFormErrors({});
    };

    const handleEditSetting = (setting: PatientFormSetting) => {
        setIsNewSetting(false);
        setEditingSetting(setting);
        setFormData({ ...setting });
        setFormErrors({});
    };

    const validateForm = (): boolean => {
        const errors: Record<string, string> = {};
        if (!formData.template_id) errors.template_id = '請選擇表單模板';
        if (!formData.message_template?.includes('{表單連結}')) {
            errors.message_template = '訊息模板必須包含 {表單連結} 變數';
        }
        if (formData.timing_mode === 'hours_after' && (formData.hours_after ?? -1) < 0) {
            errors.hours_after = '小時數必須大於或等於 0';
        }
        if (formData.timing_mode === 'specific_time') {
            if ((formData.days_after ?? -1) < 0) errors.days_after = '天數必須大於或等於 0';
            if (!formData.time_of_day) errors.time_of_day = '請選擇發送時間';
        }
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSaveSetting = () => {
        if (!validateForm()) return;

        if (isNewSetting) {
            const newSetting: PatientFormSetting = {
                ...formData as PatientFormSetting,
                id: generateTemporaryId(),
                clinic_id: appointmentType.clinic_id,
                appointment_type_id: appointmentType.id,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
            const updated = [...patientFormSettings, newSetting].map((s, i) => ({ ...s, display_order: i }));
            updateStagedSettings(updated);
        } else if (editingSetting) {
            const updated = patientFormSettings.map(s =>
                s.id === editingSetting.id ? { ...s, ...formData, updated_at: new Date().toISOString() } : s
            ).sort((a, b) => a.display_order - b.display_order);
            updateStagedSettings(updated);
        }
        setIsNewSetting(false);
        setEditingSetting(null);
    };

    const handlePreview = async (setting: PatientFormSetting) => {
        setPreviewModal({ isOpen: true, setting });
        setLoadingPreview(true);
        try {
            const preview = await apiService.previewPatientFormMessage({
                appointment_type_id: appointmentType.id,
                message_template: setting.message_template,
            });
            setPreviewData(preview);
        } catch (error) {
            logger.error('Failed to load preview:', error);
            setPreviewData(null);
        } finally {
            setLoadingPreview(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={handleAddSetting}
                    disabled={disabled}
                    className="text-sm text-primary-600 hover:text-primary-800 font-medium"
                >
                    + 新增表單發送設定
                </button>
            </div>

            {loading ? (
                <div className="flex justify-center py-8"><LoadingSpinner /></div>
            ) : patientFormSettings.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                    尚無表單設定，點擊「新增表單發送設定」開始
                </div>
            ) : (
                <div className="space-y-3">
                    {patientFormSettings.map((setting) => (
                        <div key={setting.id} className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
                            <div className="px-4 py-3 bg-gray-50 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="text-sm font-medium text-gray-900">
                                        {templates?.find(t => t.id === setting.template_id)?.name || '未命名表單'}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        {setting.timing_mode === 'immediate' ? '預約確認後立即發送' : 
                                         setting.timing_mode === 'hours_after' ? `預約結束後 ${setting.hours_after} 小時` :
                                         `預約日期後 ${setting.days_after} 天 ${setting.time_of_day}`}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button 
                                        onClick={() => handlePreview(setting)} 
                                        className="text-xs text-primary-600"
                                        aria-label="預覽訊息"
                                    >
                                        預覽
                                    </button>
                                    <button 
                                        onClick={() => handleEditSetting(setting)} 
                                        className="text-xs text-primary-600"
                                        aria-label="編輯設定"
                                    >
                                        編輯
                                    </button>
                                    <button 
                                        onClick={() => updateStagedSettings(patientFormSettings.filter(s => s.id !== setting.id))}
                                        className="text-xs text-red-600"
                                        aria-label="刪除設定"
                                    >
                                        刪除
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {(isNewSetting || editingSetting) && (
                <BaseModal onClose={() => { setIsNewSetting(false); setEditingSetting(null); }} className="max-w-2xl">
                    <ModalHeader title={isNewSetting ? '新增表單設定' : '編輯表單設定'} showClose onClose={() => { setIsNewSetting(false); setEditingSetting(null); }} />
                    <ModalBody className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">選擇表單模板 *</label>
                                <select
                                    value={formData.template_id || ''}
                                    onChange={e => setFormData({ ...formData, template_id: Number(e.target.value) })}
                                    className="w-full border-gray-300 rounded-lg text-sm"
                                >
                                    <option value="">請選擇...</option>
                                    {templates?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select>
                                {formErrors.template_id && <p className="text-red-500 text-xs mt-1">{formErrors.template_id}</p>}
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">按鈕文字</label>
                                <input
                                    type="text"
                                    value={formData.flex_button_text || ''}
                                    onChange={e => setFormData({ ...formData, flex_button_text: e.target.value })}
                                    className="w-full border-gray-300 rounded-lg text-sm"
                                    placeholder="預設：填寫表單"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">發送時機 *</label>
                            <div className="flex flex-wrap gap-4">
                                <label className="flex items-center gap-2 text-sm">
                                    <input type="radio" checked={formData.timing_mode === 'immediate'} onChange={() => setFormData({ ...formData, timing_mode: 'immediate' })} />
                                    立即發送
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                    <input type="radio" checked={formData.timing_mode === 'hours_after'} onChange={() => setFormData({ ...formData, timing_mode: 'hours_after', hours_after: 0 })} />
                                    結束後 X 小時
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                    <input type="radio" checked={formData.timing_mode === 'specific_time'} onChange={() => setFormData({ ...formData, timing_mode: 'specific_time', days_after: 0, time_of_day: '21:00' })} />
                                    日期後 Y 天特定時間
                                </label>
                            </div>
                            {formData.timing_mode === 'hours_after' && (
                                <div className="mt-2 flex items-center gap-2">
                                    <input type="number" value={hoursAfterInput.displayValue} onChange={hoursAfterInput.onChange} className="w-20 border-gray-300 rounded-lg text-sm" />
                                    <span className="text-sm text-gray-600">小時</span>
                                </div>
                            )}
                            {formData.timing_mode === 'specific_time' && (
                                <div className="mt-2 flex items-center gap-4">
                                    <div className="flex items-center gap-2">
                                        <input type="number" value={daysAfterInput.displayValue} onChange={daysAfterInput.onChange} className="w-20 border-gray-300 rounded-lg text-sm" />
                                        <span className="text-sm text-gray-600">天後</span>
                                    </div>
                                    <TimeInput value={formData.time_of_day || '21:00'} onChange={v => setFormData({ ...formData, time_of_day: v })} />
                                </div>
                            )}
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <label className="block text-sm font-medium text-gray-700">訊息內容 *</label>
                                <PlaceholderHelper messageType="patient_form" onInsert={p => setFormData({ ...formData, message_template: (formData.message_template || '') + p })} />
                            </div>
                            <textarea
                                value={formData.message_template || ''}
                                onChange={e => setFormData({ ...formData, message_template: e.target.value })}
                                rows={4}
                                className="w-full border-gray-300 rounded-lg text-sm"
                                placeholder="請包含 {表單連結}..."
                            />
                            {formErrors.message_template && <p className="text-red-500 text-xs mt-1">{formErrors.message_template}</p>}
                        </div>

                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-700">提交後通知對象</label>
                            <div className="flex flex-wrap gap-4">
                                <label className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={formData.notify_admin} onChange={e => setFormData({ ...formData, notify_admin: e.target.checked })} />
                                    診所管理員
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={formData.notify_appointment_practitioner} onChange={e => setFormData({ ...formData, notify_appointment_practitioner: e.target.checked })} />
                                    預約治療師
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={formData.notify_assigned_practitioner} onChange={e => setFormData({ ...formData, notify_assigned_practitioner: e.target.checked })} />
                                    病患主責治療師
                                </label>
                            </div>
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <button onClick={() => { setIsNewSetting(false); setEditingSetting(null); }} className="btn-secondary">取消</button>
                        <button onClick={handleSaveSetting} className="btn-primary">儲存</button>
                    </ModalFooter>
                </BaseModal>
            )}

            {previewModal.isOpen && (
                <BaseModal onClose={() => setPreviewModal({ isOpen: false, setting: null })} className="max-w-lg">
                    <ModalHeader title="訊息預覽" showClose onClose={() => setPreviewModal({ isOpen: false, setting: null })} />
                    <ModalBody>
                        {loadingPreview ? <LoadingSpinner /> : previewData ? (
                            <div className="space-y-4">
                                <div className="bg-gray-50 p-4 rounded-lg text-sm whitespace-pre-wrap border border-gray-200">
                                    {previewData.preview_message}
                                </div>
                                <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                                    <div className="text-center py-2 bg-white border border-blue-200 rounded-md text-blue-600 font-medium">
                                        {previewModal.setting?.flex_button_text || '填寫表單'}
                                    </div>
                                </div>
                            </div>
                        ) : <p className="text-red-500">預覽載入失敗</p>}
                    </ModalBody>
                    <ModalFooter>
                        <button onClick={() => setPreviewModal({ isOpen: false, setting: null })} className="btn-primary">關閉</button>
                    </ModalFooter>
                </BaseModal>
            )}
        </div>
    );
};

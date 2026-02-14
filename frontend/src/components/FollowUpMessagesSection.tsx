import React, { useState } from 'react';
import { useFormContext, useFieldArray } from 'react-hook-form';
import { FollowUpMessageBundleData } from '../types';
import { apiService } from '../services/api';
import { PlaceholderHelper } from './PlaceholderHelper';
import { BaseModal } from './shared/BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from './shared/ModalParts';
import { LoadingSpinner, TimeInput } from './shared';
import { isTemporaryServiceItemId } from '../utils/idUtils';
import { logger } from '../utils/logger';
import { useModal } from '../contexts/ModalContext';
import { preventScrollWheelChange } from '../utils/inputUtils';
import { useNumberInput } from '../hooks/useNumberInput';

interface FollowUpMessagesSectionProps {
    appointmentTypeId: number;
    appointmentTypeName?: string;
    clinicId?: number;
    disabled?: boolean;
    clinicInfoAvailability?: {
        has_address?: boolean;
        has_phone?: boolean;
    };
}

interface FollowUpMessageFormData {
    timing_mode: 'hours_after' | 'specific_time';
    hours_after?: number | undefined;
    days_after?: number | undefined;
    time_of_day?: string | undefined; // HH:MM format
    message_template: string;
    is_enabled: boolean;
    display_order: number;
}

const MAX_MESSAGE_LENGTH = 3500;
const WARNING_THRESHOLD = 3000;

interface FollowUpMessageField extends Omit<FollowUpMessageBundleData, 'id'> {
    id: string; // Internal ID for useFieldArray
}

export const FollowUpMessagesSection: React.FC<FollowUpMessagesSectionProps> = ({
    appointmentTypeId,
    appointmentTypeName,
    disabled = false,
    clinicInfoAvailability,
}) => {
    const { control } = useFormContext();
    const { fields, append, remove, update } = useFieldArray({
        control,
        name: 'follow_up_messages',
    });

    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [isNewMessage, setIsNewMessage] = useState(false);

    const [formData, setFormData] = useState<FollowUpMessageFormData>({
        timing_mode: 'hours_after',
        hours_after: 0,
        days_after: 0,
        message_template: '',
        is_enabled: true,
        display_order: 0,
    });
    const [formErrors, setFormErrors] = useState<Record<string, string>>({});
    const [previewModal, setPreviewModal] = useState<{
        isOpen: boolean;
        message: FollowUpMessageField | FollowUpMessageBundleData | null;
    }>({ isOpen: false, message: null });
    const [previewData, setPreviewData] = useState<{
        preview_message: string;
        used_placeholders: Record<string, string>;
        completeness_warnings?: string[];
    } | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);

    // Number input hooks for hours_after and days_after
    const hoursAfterInput = useNumberInput(
        formData.hours_after ?? 0,
        (value) => {
            setFormData(prev => ({ ...prev, hours_after: value }));
            if (formErrors.hours_after) {
                setFormErrors(prev => {
                    const rest = { ...prev };
                    delete rest.hours_after;
                    return rest;
                });
            }
        },
        { fallback: 0, parseFn: 'parseInt', min: 0 }
    );

    const daysAfterInput = useNumberInput(
        formData.days_after ?? 0,
        (value) => {
            setFormData(prev => ({ ...prev, days_after: value }));
            if (formErrors.days_after) {
                setFormErrors(prev => {
                    const rest = { ...prev };
                    delete rest.days_after;
                    return rest;
                });
            }
        },
        { fallback: 0, parseFn: 'parseInt', min: 0 }
    );

    const { confirm } = useModal();


    const handleAddMessage = () => {
        setIsNewMessage(true);
        setEditingIndex(null);
        setFormData({
            timing_mode: 'hours_after',
            hours_after: 0,
            days_after: 0,
            message_template: '{病患姓名}，感謝您今天的預約！\n\n希望今天的服務對您有幫助。如有任何問題或需要協助，歡迎隨時聯繫我們。\n\n期待下次為您服務！',
            is_enabled: true,
            display_order: fields.length,
        });
        setFormErrors({});
    };

    const handleEditMessage = (index: number) => {
        const message = fields[index] as unknown as FollowUpMessageField;
        setIsNewMessage(false);
        setEditingIndex(index);
        setFormData({
            timing_mode: message.timing_mode,
            hours_after: (message.hours_after as number) ?? 0,
            days_after: (message.days_after as number) ?? 0,
            time_of_day: (message.time_of_day as string) ?? undefined,
            message_template: message.message_template,
            is_enabled: message.is_enabled !== false,
            display_order: message.display_order ?? index,
        });
        setFormErrors({});
    };

    const validateForm = (): boolean => {
        const errors: Record<string, string> = {};

        if (formData.timing_mode === 'hours_after') {
            if (formData.hours_after === undefined || formData.hours_after < 0) {
                errors.hours_after = '小時數必須大於或等於 0';
            }
        } else if (formData.timing_mode === 'specific_time') {
            if (formData.days_after === undefined || formData.days_after < 0) {
                errors.days_after = '天數必須大於或等於 0';
            }
            if (!formData.time_of_day || !/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(formData.time_of_day)) {
                errors.time_of_day = '時間格式必須為 HH:MM（例如：21:00）';
            }
        }

        if (!formData.message_template || !formData.message_template.trim()) {
            errors.message_template = '訊息模板為必填';
        } else if (formData.message_template.length > MAX_MESSAGE_LENGTH) {
            errors.message_template = `訊息模板長度不能超過 ${MAX_MESSAGE_LENGTH} 字元`;
        }

        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSaveMessage = () => {
        if (!validateForm()) {
            return;
        }

        const dataToSave = {
            timing_mode: formData.timing_mode,
            hours_after: formData.timing_mode === 'hours_after' ? (formData.hours_after ?? null) : null,
            days_after: formData.timing_mode === 'specific_time' ? (formData.days_after ?? null) : null,
            time_of_day: formData.timing_mode === 'specific_time' ? (formData.time_of_day ?? null) : null,
            message_template: formData.message_template,
            is_enabled: formData.is_enabled,
            display_order: formData.display_order,
        };

        if (isNewMessage) {
            append(dataToSave);
            setIsNewMessage(false);
        } else if (editingIndex !== null) {
            const original = fields[editingIndex] as unknown as FollowUpMessageField;
            update(editingIndex, {
                ...original,
                ...dataToSave
            });
            setEditingIndex(null);
        }
    };

    const handleToggleEnabled = (index: number) => {
        const message = fields[index] as unknown as FollowUpMessageField;
        update(index, { ...message, is_enabled: !message.is_enabled });
    };

    const handlePreview = async (message: FollowUpMessageField | FollowUpMessageBundleData) => {
        setPreviewModal({ isOpen: true, message });
        setLoadingPreview(true);
        setPreviewData(null);
        try {
            const previewRequest: Parameters<typeof apiService.previewFollowUpMessage>[0] = {
                timing_mode: message.timing_mode,
                message_template: message.message_template,
            };

            if (isTemporaryServiceItemId(appointmentTypeId)) {
                previewRequest.appointment_type_name = appointmentTypeName || '服務項目';
            } else {
                previewRequest.appointment_type_id = appointmentTypeId;
            }

            if (message.timing_mode === 'hours_after' && typeof message.hours_after === 'number') {
                previewRequest.hours_after = message.hours_after;
            }
            if (message.timing_mode === 'specific_time') {
                if (typeof message.days_after === 'number') previewRequest.days_after = message.days_after;
                if (typeof message.time_of_day === 'string') previewRequest.time_of_day = message.time_of_day;
            }
            const preview = await apiService.previewFollowUpMessage(previewRequest);
            setPreviewData(preview);
        } catch (error: unknown) {
            logger.error('Failed to load preview:', error);
            setPreviewData(null);
        } finally {
            setLoadingPreview(false);
        }
    };

    const renderMessageItem = (field: FollowUpMessageField, index: number) => {
        const message = field;
        const charCount = message.message_template.length;
        const isOverLimit = charCount > MAX_MESSAGE_LENGTH;
        const isWarning = charCount > WARNING_THRESHOLD;

        return (
            <div key={field.id} className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="w-full px-4 py-3 bg-gray-50 flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 text-left">
                        <div className="text-left">
                            <div className="text-sm font-medium text-gray-900">
                                追蹤訊息 #{index + 1}
                            </div>
                            <div className="text-xs text-gray-500">
                                {message.timing_mode === 'hours_after'
                                    ? `預約結束後 ${message.hours_after || 0} 小時`
                                    : `預約日期後 ${message.days_after || 0} 天的 ${message.time_of_day || '21:00'}`}
                            </div>
                        </div>
                    </div>
                    <div
                        className="flex items-center cursor-pointer ml-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <input
                            type="checkbox"
                            checked={message.is_enabled !== false}
                            onChange={() => handleToggleEnabled(index)}
                            disabled={disabled}
                            className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
                        />
                    </div>
                </div>

                <div className="p-4 space-y-3 bg-white border-t border-gray-100">
                    <div className="text-sm text-gray-600">
                        <div className="mb-2">
                            <span className="font-medium">發送時機：</span>
                            {message.timing_mode === 'hours_after'
                                ? `預約結束後 ${message.hours_after || 0} 小時`
                                : `預約日期後 ${message.days_after || 0} 天的 ${message.time_of_day || '21:00'}`}
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-sm font-medium text-gray-700">
                                訊息模板 <span className="text-red-500">*</span>
                            </label>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => handlePreview(message)}
                                    disabled={disabled}
                                    className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400"
                                >
                                    預覽訊息
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleEditMessage(index)}
                                    disabled={disabled}
                                    className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400"
                                >
                                    編輯
                                </button>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        const confirmed = await confirm('確定要刪除此追蹤訊息嗎？', '刪除追蹤訊息');
                                        if (confirmed) {
                                            remove(index);
                                        }
                                    }}
                                    disabled={disabled}
                                    className="text-xs text-red-600 hover:text-red-800 disabled:text-gray-400"
                                >
                                    刪除
                                </button>
                            </div>
                        </div>
                        <textarea
                            value={message.message_template}
                            readOnly
                            rows={6}
                            className={`w-full px-3 py-2 border rounded-lg text-sm resize-none bg-gray-50 ${isOverLimit ? 'border-red-500' : isWarning ? 'border-yellow-500' : 'border-gray-300'
                                }`}
                        />
                        <div className="flex items-center justify-between mt-1">
                            <div className={`text-xs ${isOverLimit ? 'text-red-600' : isWarning ? 'text-yellow-600' : 'text-gray-500'}`}>
                                {charCount} / {MAX_MESSAGE_LENGTH} {isOverLimit && '(超過限制)'}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <>
            <div>
                <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center gap-2">
                        {/* Placeholder for optional title or info */}
                    </div>
                    <button
                        type="button"
                        onClick={handleAddMessage}
                        disabled={disabled}
                        className="text-sm text-blue-600 hover:text-blue-800 disabled:text-gray-400 disabled:cursor-not-allowed"
                    >
                        + 新增追蹤訊息
                    </button>
                </div>

                {fields.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 text-sm">
                        尚無追蹤訊息，點擊「新增追蹤訊息」開始設定
                    </div>
                ) : (
                    <div className="space-y-3">
                        {fields.map((field, index) => renderMessageItem(field as unknown as FollowUpMessageField, index))}
                    </div>
                )}
            </div>

            {(editingIndex !== null || isNewMessage) && (
                <BaseModal
                    onClose={() => {
                        setEditingIndex(null);
                        setIsNewMessage(false);
                        setFormErrors({});
                    }}
                    aria-label={isNewMessage ? '新增追蹤訊息' : '編輯追蹤訊息'}
                    className="max-w-2xl"
                >
                    <ModalHeader
                        title={isNewMessage ? '新增追蹤訊息' : '編輯追蹤訊息'}
                        showClose
                        onClose={() => {
                            setEditingIndex(null);
                            setIsNewMessage(false);
                            setFormErrors({});
                        }}
                    />
                    <ModalBody>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    發送時機 <span className="text-red-500">*</span>
                                </label>
                                <div className="space-y-3">
                                    <label className="flex items-center">
                                        <input
                                            type="radio"
                                            name="timing_mode"
                                            value="hours_after"
                                            checked={formData.timing_mode === 'hours_after'}
                                            onChange={() => {
                                                setFormData(prev => ({
                                                    ...prev,
                                                    timing_mode: 'hours_after',
                                                    days_after: undefined,
                                                    time_of_day: undefined,
                                                    hours_after: prev.hours_after !== undefined ? prev.hours_after : 0,
                                                }));
                                                setFormErrors(prev => {
                                                    const rest = { ...prev };
                                                    delete rest.days_after;
                                                    delete rest.time_of_day;
                                                    return rest;
                                                });
                                            }}
                                            className="mr-2"
                                        />
                                        <span className="text-sm text-gray-700">預約結束後 X 小時</span>
                                    </label>
                                    {formData.timing_mode === 'hours_after' && (
                                        <div className="ml-6">
                                            <input
                                                type="number"
                                                min="0"
                                                step="1"
                                                value={hoursAfterInput.displayValue}
                                                onChange={hoursAfterInput.onChange}
                                                onBlur={hoursAfterInput.onBlur}
                                                onWheel={preventScrollWheelChange}
                                                className={`input w-24 ${formErrors.hours_after ? 'border-red-500' : ''}`}
                                            />
                                            <span className="ml-2 text-sm text-gray-600">小時</span>
                                            {formErrors.hours_after && (
                                                <p className="text-red-600 text-xs mt-1">{formErrors.hours_after}</p>
                                            )}
                                        </div>
                                    )}

                                    <label className="flex items-center">
                                        <input
                                            type="radio"
                                            name="timing_mode"
                                            value="specific_time"
                                            checked={formData.timing_mode === 'specific_time'}
                                            onChange={() => {
                                                setFormData(prev => ({
                                                    ...prev,
                                                    timing_mode: 'specific_time',
                                                    hours_after: undefined,
                                                    days_after: prev.days_after !== undefined ? prev.days_after : 0,
                                                    time_of_day: prev.time_of_day || '21:00',
                                                }));
                                                setFormErrors(prev => {
                                                    const rest = { ...prev };
                                                    delete rest.hours_after;
                                                    return rest;
                                                });
                                            }}
                                            className="mr-2"
                                        />
                                        <span className="text-sm text-gray-700">預約日期後 Y 天的特定時間</span>
                                    </label>
                                    {formData.timing_mode === 'specific_time' && (
                                        <div className="ml-6 space-y-2">
                                            <div>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="1"
                                                    value={daysAfterInput.displayValue}
                                                    onChange={daysAfterInput.onChange}
                                                    onBlur={daysAfterInput.onBlur}
                                                    onWheel={preventScrollWheelChange}
                                                    className={`input w-24 ${formErrors.days_after ? 'border-red-500' : ''}`}
                                                />
                                                <span className="ml-2 text-sm text-gray-600">天後的</span>
                                                {formErrors.days_after && (
                                                    <p className="text-red-600 text-xs mt-1">{formErrors.days_after}</p>
                                                )}
                                            </div>
                                            <div>
                                                <TimeInput
                                                    value={formData.time_of_day ?? '21:00'}
                                                    onChange={(value) => {
                                                        setFormData(prev => ({ ...prev, time_of_day: value }));
                                                        if (formErrors.time_of_day) {
                                                            setFormErrors(prev => {
                                                                const rest = { ...prev };
                                                                delete rest.time_of_day;
                                                                return rest;
                                                            });
                                                        }
                                                    }}
                                                    className="w-32"
                                                    error={formErrors.time_of_day || null}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-sm font-medium text-gray-700">
                                        訊息模板 <span className="text-red-500">*</span>
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <PlaceholderHelper
                                            messageType="reminder"
                                            onInsert={(placeholder) => {
                                                const textarea = document.querySelector('textarea[name="follow_up_message_template"]') as HTMLTextAreaElement;
                                                if (textarea) {
                                                    const start = textarea.selectionStart;
                                                    const end = textarea.selectionEnd;
                                                    const newTemplate = formData.message_template.substring(0, start) + placeholder + formData.message_template.substring(end);
                                                    setFormData(prev => ({ ...prev, message_template: newTemplate }));
                                                    setTimeout(() => {
                                                        textarea.focus();
                                                        textarea.setSelectionRange(start + placeholder.length, start + placeholder.length);
                                                    }, 0);
                                                }
                                            }}
                                            disabled={disabled}
                                            {...(clinicInfoAvailability !== undefined && { clinicInfoAvailability })}
                                        />
                                    </div>
                                </div>
                                <textarea
                                    name="follow_up_message_template"
                                    value={formData.message_template}
                                    onChange={(e) => {
                                        setFormData(prev => ({ ...prev, message_template: e.target.value }));
                                        if (formErrors.message_template) {
                                            setFormErrors(prev => {
                                                const rest = { ...prev };
                                                delete rest.message_template;
                                                return rest;
                                            });
                                        }
                                    }}
                                    rows={8}
                                    className={`w-full px-3 py-2 border rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${formErrors.message_template ? 'border-red-500' : 'border-gray-300'
                                        }`}
                                    placeholder="輸入訊息模板..."
                                />
                                <div className="flex items-center justify-between mt-1">
                                    <div className="text-xs text-gray-500">
                                        {formErrors.message_template && (
                                            <span className="text-red-600">{formErrors.message_template}</span>
                                        )}
                                    </div>
                                    <div className={`text-xs ${formData.message_template.length > MAX_MESSAGE_LENGTH
                                        ? 'text-red-600'
                                        : formData.message_template.length > WARNING_THRESHOLD
                                            ? 'text-yellow-600'
                                            : 'text-gray-500'
                                        }`}>
                                        {formData.message_template.length} / {MAX_MESSAGE_LENGTH}
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={formData.is_enabled}
                                        onChange={(e) => setFormData(prev => ({ ...prev, is_enabled: e.target.checked }))}
                                        className="mr-2"
                                    />
                                    <span className="text-sm font-medium text-gray-700">啟用此追蹤訊息</span>
                                </label>
                            </div>
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <button
                            type="button"
                            onClick={() => {
                                setEditingIndex(null);
                                setIsNewMessage(false);
                                setFormErrors({});
                            }}
                            className="btn-secondary"
                        >
                            取消
                        </button>
                        <button
                            type="button"
                            onClick={handleSaveMessage}
                            className="btn-primary"
                        >
                            儲存
                        </button>
                    </ModalFooter>
                </BaseModal>
            )}

            {previewModal.isOpen && (
                <BaseModal
                    onClose={() => {
                        setPreviewModal({ isOpen: false, message: null });
                        setPreviewData(null);
                    }}
                    aria-label="訊息預覽"
                    className="max-w-2xl"
                >
                    <ModalHeader title="訊息預覽" showClose onClose={() => {
                        setPreviewModal({ isOpen: false, message: null });
                        setPreviewData(null);
                    }} />
                    <ModalBody>
                        {loadingPreview ? (
                            <div className="flex justify-center py-8">
                                <LoadingSpinner />
                            </div>
                        ) : previewData ? (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        預覽訊息
                                    </label>
                                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 whitespace-pre-wrap text-sm">
                                        {previewData.preview_message}
                                    </div>
                                </div>

                                {previewData.completeness_warnings && previewData.completeness_warnings.length > 0 && (
                                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                                        <div className="text-xs font-medium text-yellow-800 mb-2">建議補充以下資訊以提升訊息完整度：</div>
                                        <ul className="space-y-1">
                                            {previewData.completeness_warnings.map((warning, index) => (
                                                <li key={index} className="text-xs text-yellow-700 flex gap-2">
                                                    <span>•</span>
                                                    <span>{warning}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {Object.keys(previewData.used_placeholders).length > 0 && (
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            使用的變數
                                        </label>
                                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                            <div className="space-y-2">
                                                {Object.entries(previewData.used_placeholders).map(([key, value]) => (
                                                    <div key={key} className="text-sm">
                                                        <span className="font-mono text-blue-600">{key}</span>
                                                        <span className="text-gray-600 mx-2">→</span>
                                                        <span className="text-gray-900">{value || '(空)'}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                                <p className="text-sm text-red-800">無法載入預覽，請稍後再試。</p>
                            </div>
                        )}
                    </ModalBody>
                    <ModalFooter>
                        <button
                            type="button"
                            onClick={() => setPreviewModal({ isOpen: false, message: null })}
                            className="btn-primary"
                        >
                            關閉
                        </button>
                    </ModalFooter>
                </BaseModal>
            )}
        </>
    );
};

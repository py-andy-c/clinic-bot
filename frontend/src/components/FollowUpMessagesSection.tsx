import React, { useState, useEffect, useCallback } from 'react';
import { FollowUpMessage, AppointmentType } from '../types';
import { apiService } from '../services/api';
import { PlaceholderHelper } from './PlaceholderHelper';
import { BaseModal } from './shared/BaseModal';
import { LoadingSpinner } from './shared';
import { isTemporaryServiceItemId } from '../utils/idUtils';
import { logger } from '../utils/logger';
import { useModal } from '../contexts/ModalContext';

interface FollowUpMessagesSectionProps {
  appointmentType: AppointmentType;
  onUpdate: (updated: AppointmentType) => void;
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

export const FollowUpMessagesSection: React.FC<FollowUpMessagesSectionProps> = ({
  appointmentType,
  onUpdate,
  disabled = false,
  clinicInfoAvailability,
}) => {
  const isNewItem = isTemporaryServiceItemId(appointmentType.id);
  
  // Initialize from appointmentType.follow_up_messages if available (staged changes)
  // Otherwise load from API for existing items
  const [followUpMessages, setFollowUpMessages] = useState<FollowUpMessage[]>(
    appointmentType.follow_up_messages || []
  );
  const [loading, setLoading] = useState(false);
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set());
  const [editingMessage, setEditingMessage] = useState<FollowUpMessage | null>(null);
  const [isNewMessage, setIsNewMessage] = useState(false);
  const [formData, setFormData] = useState<FollowUpMessageFormData>({
    timing_mode: 'hours_after',
    hours_after: 0,
    message_template: '',
    is_enabled: true,
    display_order: 0,
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [previewModal, setPreviewModal] = useState<{
    isOpen: boolean;
    message: FollowUpMessage | null;
  }>({ isOpen: false, message: null });
  const [previewData, setPreviewData] = useState<{
    preview_message: string;
    used_placeholders: Record<string, string>;
    completeness_warnings?: string[];
  } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const { confirm, alert } = useModal();

  // Load follow-up messages when modal opens (only for existing items without staged changes)
  const loadFollowUpMessages = useCallback(async () => {
    if (isNewItem || !appointmentType.id) return;
    // If we already have staged changes, don't reload from API
    if (appointmentType.follow_up_messages !== undefined) return;
    
    setLoading(true);
    try {
      const response = await apiService.getFollowUpMessages(appointmentType.id);
      const messages = response.follow_up_messages.sort((a, b) => a.display_order - b.display_order);
      setFollowUpMessages(messages);
      // Expand all messages by default
      setExpandedMessages(new Set(messages.map(m => m.id)));
      // Update parent with loaded messages
      onUpdate({ ...appointmentType, follow_up_messages: messages });
    } catch (error: any) {
      logger.error('Failed to load follow-up messages:', error);
      const errorMessage = error?.response?.data?.detail || '無法載入追蹤訊息';
      await alert(errorMessage, '載入失敗');
      // Set empty list on error so UI shows empty state
      setFollowUpMessages([]);
      onUpdate({ ...appointmentType, follow_up_messages: [] });
    } finally {
      setLoading(false);
    }
  }, [isNewItem, appointmentType, onUpdate, alert]);

  useEffect(() => {
    if (!isNewItem && appointmentType.id && appointmentType.follow_up_messages === undefined) {
      loadFollowUpMessages();
    } else if (appointmentType.follow_up_messages !== undefined) {
      // Use staged messages
      setFollowUpMessages(appointmentType.follow_up_messages);
      setExpandedMessages(new Set(appointmentType.follow_up_messages.map(m => m.id)));
    } else {
      // For new items, start with empty list
      setFollowUpMessages([]);
    }
  }, [appointmentType.id, appointmentType.follow_up_messages, isNewItem, loadFollowUpMessages]);

  // Helper function to update parent with staged changes
  const updateStagedMessages = (messages: FollowUpMessage[]) => {
    setFollowUpMessages(messages);
    onUpdate({ ...appointmentType, follow_up_messages: messages });
  };

  const toggleMessage = (messageId: number) => {
    const newExpanded = new Set(expandedMessages);
    if (newExpanded.has(messageId)) {
      newExpanded.delete(messageId);
    } else {
      newExpanded.add(messageId);
    }
    setExpandedMessages(newExpanded);
  };

  const handleAddMessage = () => {
    setIsNewMessage(true);
    setEditingMessage(null);
    setFormData({
      timing_mode: 'hours_after',
      hours_after: 0,
      message_template: '{病患姓名}，感謝您今天的預約！\n\n希望今天的服務對您有幫助。如有任何問題或需要協助，歡迎隨時聯繫我們。\n\n期待下次為您服務！',
      is_enabled: true,
      display_order: followUpMessages.length,
    });
    setFormErrors({});
  };

  const handleEditMessage = (message: FollowUpMessage) => {
    setIsNewMessage(false);
    setEditingMessage(message);
    setFormData({
      timing_mode: message.timing_mode,
      hours_after: message.hours_after ?? undefined,
      days_after: message.days_after ?? undefined,
      time_of_day: message.time_of_day ?? undefined,
      message_template: message.message_template,
      is_enabled: message.is_enabled,
      display_order: message.display_order,
    });
    setFormErrors({});
  };

  const handleDeleteMessage = async (messageId: number) => {
    // Stage deletion - remove from local state
    const updated = followUpMessages.filter(m => m.id !== messageId);
    updateStagedMessages(updated);
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
    } else if (formData.message_template.length > 3500) {
      errors.message_template = '訊息模板長度不能超過 3500 字元';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveMessage = () => {
    if (!validateForm()) {
      return;
    }

    if (isNewMessage) {
      // Create new message in staging with temporary ID (negative timestamp)
      const newMessage: FollowUpMessage = {
        id: -Date.now(),
        appointment_type_id: appointmentType.id,
        clinic_id: appointmentType.clinic_id,
        timing_mode: formData.timing_mode,
        hours_after: formData.timing_mode === 'hours_after' ? (formData.hours_after ?? null) : null,
        days_after: formData.timing_mode === 'specific_time' ? (formData.days_after ?? null) : null,
        time_of_day: formData.timing_mode === 'specific_time' ? (formData.time_of_day ?? null) : null,
        message_template: formData.message_template,
        is_enabled: formData.is_enabled,
        display_order: formData.display_order,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const updated = [...followUpMessages, newMessage].sort((a, b) => a.display_order - b.display_order);
      updateStagedMessages(updated);
      setEditingMessage(null);
      setIsNewMessage(false);
    } else if (editingMessage) {
      // Update existing message in staging
      const updated = followUpMessages.map(m =>
        m.id === editingMessage.id
          ? {
              ...m,
              timing_mode: formData.timing_mode,
              hours_after: formData.timing_mode === 'hours_after' ? (formData.hours_after ?? null) : null,
              days_after: formData.timing_mode === 'specific_time' ? (formData.days_after ?? null) : null,
              time_of_day: formData.timing_mode === 'specific_time' ? (formData.time_of_day ?? null) : null,
              message_template: formData.message_template,
              is_enabled: formData.is_enabled,
              display_order: formData.display_order,
              updated_at: new Date().toISOString(),
            }
          : m
      ).sort((a, b) => a.display_order - b.display_order);
      updateStagedMessages(updated);
      setEditingMessage(null);
    }
  };

  const handleToggleEnabled = (message: FollowUpMessage) => {
    // Stage toggle change
    const updated = followUpMessages.map(m =>
      m.id === message.id ? { ...m, is_enabled: !m.is_enabled, updated_at: new Date().toISOString() } : m
    );
    updateStagedMessages(updated);
  };

  const handlePreview = async (message: FollowUpMessage) => {
    setPreviewModal({ isOpen: true, message });
    setLoadingPreview(true);
    setPreviewData(null);
    try {
      const previewData: {
        appointment_type_id?: number;
        appointment_type_name?: string;
        timing_mode: 'hours_after' | 'specific_time';
        hours_after?: number;
        days_after?: number;
        time_of_day?: string;
        message_template: string;
      } = {
        timing_mode: message.timing_mode,
        message_template: message.message_template,
      };
      
      // Handle temporary IDs - send name instead of ID for new items
      if (isTemporaryServiceItemId(appointmentType.id)) {
        previewData.appointment_type_name = appointmentType.name || '服務項目';
      } else {
        previewData.appointment_type_id = appointmentType.id;
      }
      
      if (message.timing_mode === 'hours_after' && message.hours_after !== null && message.hours_after !== undefined) {
        previewData.hours_after = message.hours_after;
      }
      if (message.timing_mode === 'specific_time') {
        if (message.days_after !== null && message.days_after !== undefined) {
          previewData.days_after = message.days_after;
        }
        if (message.time_of_day !== null && message.time_of_day !== undefined) {
          previewData.time_of_day = message.time_of_day;
        }
      }
      const preview = await apiService.previewFollowUpMessage(previewData);
      setPreviewData(preview);
    } catch (error: any) {
      logger.error('Failed to load preview:', error);
      // Keep modal open but show error state (handled by !previewData check in render)
      setPreviewData(null);
    } finally {
      setLoadingPreview(false);
    }
  };


  const renderMessageItem = (message: FollowUpMessage, index: number) => {
    const isExpanded = expandedMessages.has(message.id);
    const charCount = message.message_template.length;
    const isOverLimit = charCount > 3500;
    const isWarning = charCount > 3000;

    return (
      <div key={message.id} className="border border-gray-200 rounded-lg overflow-hidden">
        {/* Message Header */}
        <div className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors flex items-center justify-between">
          <button
            type="button"
            onClick={() => toggleMessage(message.id)}
            className="flex items-center gap-3 flex-1 text-left"
            disabled={disabled}
          >
            <svg
              className={`w-5 h-5 text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <div className="text-left">
              <div className="text-sm font-medium text-gray-900">
                追蹤訊息 #{index + 1}
              </div>
              <div className="text-xs text-gray-500">
                {message.timing_mode === 'hours_after'
                  ? `預約結束後 ${message.hours_after ?? 0} 小時`
                  : `預約日期後 ${message.days_after ?? 0} 天的 ${message.time_of_day ?? '21:00'}`}
              </div>
            </div>
          </button>
          <div
            className="flex items-center cursor-pointer ml-4"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={message.is_enabled}
              onChange={() => handleToggleEnabled(message)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              disabled={disabled}
              className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
              aria-label="啟用追蹤訊息"
            />
          </div>
        </div>

        {/* Message Content */}
        {isExpanded && (
          <div className="p-4 space-y-3 bg-white">
            <div className="text-sm text-gray-600">
              <div className="mb-2">
                <span className="font-medium">發送時機：</span>
                {message.timing_mode === 'hours_after'
                  ? `預約結束後 ${message.hours_after ?? 0} 小時`
                  : `預約日期後 ${message.days_after ?? 0} 天的 ${message.time_of_day ?? '21:00'}`}
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
                    onClick={() => handleEditMessage(message)}
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
                        handleDeleteMessage(message.id);
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
                className={`w-full px-3 py-2 border rounded-lg text-sm resize-none bg-gray-50 ${
                  isOverLimit ? 'border-red-500' : isWarning ? 'border-yellow-500' : 'border-gray-300'
                }`}
              />
              <div className="flex items-center justify-between mt-1">
                <div className="text-xs text-gray-500">
                  {!message.message_template.trim() && (
                    <span className="text-red-600">訊息模板為必填</span>
                  )}
                </div>
                <div className={`text-xs ${isOverLimit ? 'text-red-600' : isWarning ? 'text-yellow-600' : 'text-gray-500'}`}>
                  {charCount} / 3500 {isOverLimit && '(超過限制)'}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm p-0 md:p-6">
        <div className="px-4 py-4 md:px-0 md:py-0">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">追蹤訊息設定</h3>
            <button
              type="button"
              onClick={handleAddMessage}
              disabled={disabled}
              className="text-sm text-blue-600 hover:text-blue-800 disabled:text-gray-400 disabled:cursor-not-allowed"
            >
              + 新增追蹤訊息
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner />
            </div>
          ) : followUpMessages.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">
              尚無追蹤訊息，點擊「新增追蹤訊息」開始設定
            </div>
          ) : (
            <div className="space-y-3">
              {followUpMessages.map((message, index) => renderMessageItem(message, index))}
            </div>
          )}
        </div>
      </div>

      {/* Edit/Create Modal */}
      {editingMessage !== null || isNewMessage ? (
        <BaseModal
          onClose={() => {
            setEditingMessage(null);
            setIsNewMessage(false);
            setFormErrors({});
          }}
          aria-label={isNewMessage ? '新增追蹤訊息' : '編輯追蹤訊息'}
          className="max-w-2xl"
        >
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-4">
              {isNewMessage ? '新增追蹤訊息' : '編輯追蹤訊息'}
            </h2>

            <div className="space-y-4">
              {/* Timing Mode Selection */}
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
                          // Ensure hours_after is set to 0 if it's undefined
                          hours_after: prev.hours_after !== undefined ? prev.hours_after : 0,
                        }));
                        setFormErrors(prev => {
                          const { days_after, time_of_day, ...rest } = prev;
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
                        value={formData.hours_after ?? 0}
                        onChange={(e) => {
                          const value = parseInt(e.target.value, 10);
                          setFormData(prev => ({ ...prev, hours_after: isNaN(value) ? 0 : value }));
                          if (formErrors.hours_after) {
                            setFormErrors(prev => {
                              const { hours_after, ...rest } = prev;
                              return rest;
                            });
                          }
                        }}
                        className={`input w-24 ${formErrors.hours_after ? 'border-red-500' : ''}`}
                      />
                      <span className="ml-2 text-sm text-gray-600">小時</span>
                      {formErrors.hours_after && (
                        <p className="text-red-600 text-xs mt-1">{formErrors.hours_after}</p>
                      )}
                      {/* Warning for delays > 90 days (2160 hours) - per design doc recommendation */}
                      {(formData.hours_after ?? 0) > 2160 && (
                        <p className="text-yellow-600 text-xs mt-1">
                          ⚠️ 警告：延遲時間超過 90 天，請確認是否正確
                        </p>
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
                          // Ensure days_after is set to 0 if it's undefined
                          days_after: prev.days_after !== undefined ? prev.days_after : 0,
                          // Ensure time_of_day is set to default if it's undefined
                          time_of_day: prev.time_of_day || '21:00',
                        }));
                        setFormErrors(prev => {
                          const { hours_after, ...rest } = prev;
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
                          value={formData.days_after ?? 0}
                          onChange={(e) => {
                            const value = parseInt(e.target.value, 10);
                            setFormData(prev => ({ ...prev, days_after: isNaN(value) ? 0 : value }));
                            if (formErrors.days_after) {
                              setFormErrors(prev => {
                                const { days_after, ...rest } = prev;
                                return rest;
                              });
                            }
                          }}
                          className={`input w-24 ${formErrors.days_after ? 'border-red-500' : ''}`}
                        />
                        <span className="ml-2 text-sm text-gray-600">天後的</span>
                        {formErrors.days_after && (
                          <p className="text-red-600 text-xs mt-1">{formErrors.days_after}</p>
                        )}
                        {/* Warning for delays > 90 days - per design doc recommendation */}
                        {(formData.days_after ?? 0) > 90 && (
                          <p className="text-yellow-600 text-xs mt-1">
                            ⚠️ 警告：延遲時間超過 90 天，請確認是否正確
                          </p>
                        )}
                      </div>
                      <div>
                        <input
                          type="time"
                          value={formData.time_of_day ?? '21:00'}
                          onChange={(e) => {
                            setFormData(prev => ({ ...prev, time_of_day: e.target.value }));
                            if (formErrors.time_of_day) {
                              setFormErrors(prev => {
                                const { time_of_day, ...rest } = prev;
                                return rest;
                              });
                            }
                          }}
                          className={`input w-32 ${formErrors.time_of_day ? 'border-red-500' : ''}`}
                        />
                        {formErrors.time_of_day && (
                          <p className="text-red-600 text-xs mt-1">{formErrors.time_of_day}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Message Template */}
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
                        const { message_template, ...rest } = prev;
                        return rest;
                      });
                    }
                  }}
                  rows={8}
                  className={`w-full px-3 py-2 border rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                    formErrors.message_template ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="輸入訊息模板..."
                />
                <div className="flex items-center justify-between mt-1">
                  <div className="text-xs text-gray-500">
                    {formErrors.message_template && (
                      <span className="text-red-600">{formErrors.message_template}</span>
                    )}
                  </div>
                  <div className={`text-xs ${
                    formData.message_template.length > 3500
                      ? 'text-red-600'
                      : formData.message_template.length > 3000
                      ? 'text-yellow-600'
                      : 'text-gray-500'
                  }`}>
                    {formData.message_template.length} / 3500
                  </div>
                </div>
              </div>

              {/* Enabled Toggle */}
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

            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  setEditingMessage(null);
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
            </div>
          </div>
        </BaseModal>
      ) : null}

      {/* Preview Modal */}
      {previewModal.isOpen && previewModal.message && (
        <BaseModal
          onClose={() => {
            setPreviewModal({ isOpen: false, message: null });
            setPreviewData(null);
          }}
          aria-label="訊息預覽"
          className="max-w-2xl"
        >
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-4">訊息預覽</h2>

            {loadingPreview && (
              <div className="flex justify-center py-8">
                <LoadingSpinner />
              </div>
            )}

            {!loadingPreview && !previewData && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm text-red-800">無法載入預覽，請稍後再試。</p>
              </div>
            )}

            {previewData && !loadingPreview && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    預覽訊息
                  </label>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 whitespace-pre-wrap text-sm">
                    {previewData.preview_message}
                  </div>
                </div>

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

                {previewData.completeness_warnings && previewData.completeness_warnings.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-yellow-700 mb-2">
                      注意事項
                    </label>
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <ul className="space-y-1">
                        {previewData.completeness_warnings.map((warning, index) => (
                          <li key={index} className="text-sm text-yellow-800">
                            • {warning}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                <div className="flex justify-end pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewModal({ isOpen: false, message: null });
                      setPreviewData(null);
                    }}
                    className="btn-primary px-4 py-2"
                  >
                    關閉
                  </button>
                </div>
              </div>
            )}
          </div>
        </BaseModal>
      )}
    </>
  );
};


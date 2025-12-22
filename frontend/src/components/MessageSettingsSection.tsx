import React, { useState, useRef } from 'react';
import { PlaceholderHelper } from './PlaceholderHelper';
import { MessagePreviewModal } from './MessagePreviewModal';
import {
  DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
  DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
  DEFAULT_REMINDER_MESSAGE,
  MessageType,
  MESSAGE_TYPE_LABELS,
  MESSAGE_TYPE_DESCRIPTIONS,
} from '../constants/messageTemplates';
import { AppointmentType } from '../types';
import { isTemporaryServiceItemId } from '../utils/idUtils';

interface MessageSettingsSectionProps {
  appointmentType: AppointmentType;
  onUpdate: (updated: AppointmentType) => void;
  disabled?: boolean;
}

interface MessageFieldState {
  toggle: boolean;
  message: string;
}

export const MessageSettingsSection: React.FC<MessageSettingsSectionProps> = ({
  appointmentType,
  onUpdate,
  disabled = false,
}) => {
  const [expandedSections, setExpandedSections] = useState<Set<MessageType>>(
    new Set(['patient_confirmation', 'clinic_confirmation', 'reminder'])
  );
  const [previewModal, setPreviewModal] = useState<{
    isOpen: boolean;
    messageType: MessageType;
    template: string;
  }>({ isOpen: false, messageType: 'patient_confirmation', template: '' });

  // Refs for textareas to enable placeholder insertion
  const textareaRefs = useRef<Record<MessageType, HTMLTextAreaElement | null>>({
    patient_confirmation: null,
    clinic_confirmation: null,
    reminder: null,
  });

  // Check if this is a new item (temporary ID)
  const isNewItem = isTemporaryServiceItemId(appointmentType.id);

  // Initialize message fields with defaults if not present
  const getMessageField = (type: MessageType): MessageFieldState => {
    const toggleKey = `send_${type}` as keyof AppointmentType;
    const messageKey = `${type}_message` as keyof AppointmentType;
    
    // For new items: patient_confirmation defaults to true (database default)
    // For existing items: patient_confirmation defaults to false (migration behavior)
    const defaultToggle = type === 'patient_confirmation' 
      ? (isNewItem ? true : false)
      : true;
    
    const toggle = appointmentType[toggleKey] as boolean | undefined ?? defaultToggle;
    let message = appointmentType[messageKey] as string | undefined;
    
    if (!message || message.trim() === '') {
      switch (type) {
        case 'patient_confirmation':
          message = DEFAULT_PATIENT_CONFIRMATION_MESSAGE;
          break;
        case 'clinic_confirmation':
          message = DEFAULT_CLINIC_CONFIRMATION_MESSAGE;
          break;
        case 'reminder':
          message = DEFAULT_REMINDER_MESSAGE;
          break;
      }
    }
    
    return { toggle, message };
  };

  const patientConfirmation = getMessageField('patient_confirmation');
  const clinicConfirmation = getMessageField('clinic_confirmation');
  const reminder = getMessageField('reminder');

  const updateMessageField = (type: MessageType, field: 'toggle' | 'message', value: boolean | string) => {
    const updated: AppointmentType = { ...appointmentType };
    
    if (field === 'toggle') {
      (updated as any)[`send_${type}`] = value as boolean;
    } else {
      (updated as any)[`${type}_message`] = value as string;
    }
    
    onUpdate(updated);
  };

  const handleResetToDefault = (type: MessageType) => {
    let defaultMessage = '';
    switch (type) {
      case 'patient_confirmation':
        defaultMessage = DEFAULT_PATIENT_CONFIRMATION_MESSAGE;
        break;
      case 'clinic_confirmation':
        defaultMessage = DEFAULT_CLINIC_CONFIRMATION_MESSAGE;
        break;
      case 'reminder':
        defaultMessage = DEFAULT_REMINDER_MESSAGE;
        break;
    }
    updateMessageField(type, 'message', defaultMessage);
  };

  const handlePreview = (type: MessageType) => {
    const field = getMessageField(type);
    setPreviewModal({
      isOpen: true,
      messageType: type,
      template: field.message,
    });
  };

  const handleInsertPlaceholder = (type: MessageType, placeholder: string) => {
    const field = getMessageField(type);
    const textarea = textareaRefs.current[type];
    
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newMessage = field.message.substring(0, start) + placeholder + field.message.substring(end);
      updateMessageField(type, 'message', newMessage);
      
      // Restore cursor position after placeholder
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + placeholder.length, start + placeholder.length);
      }, 0);
    } else {
      // Fallback: append to end
      updateMessageField(type, 'message', field.message + placeholder);
    }
  };

  const toggleSection = (type: MessageType) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(type)) {
      newExpanded.delete(type);
    } else {
      newExpanded.add(type);
    }
    setExpandedSections(newExpanded);
  };

  const renderMessageSection = (type: MessageType, field: MessageFieldState) => {
    const isExpanded = expandedSections.has(type);
    const charCount = field.message.length;
    const isOverLimit = charCount > 3500;
    const isWarning = charCount > 3000;

    return (
      <div key={type} className="border border-gray-200 rounded-lg overflow-hidden" data-message-type={type}>
        {/* Section Header */}
        <button
          type="button"
          onClick={() => toggleSection(type)}
          className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors flex items-center justify-between"
          disabled={disabled}
        >
          <div className="flex items-center gap-3">
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
                {MESSAGE_TYPE_LABELS[type]}
              </div>
              <div className="text-xs text-gray-500">
                {MESSAGE_TYPE_DESCRIPTIONS[type]}
              </div>
            </div>
          </div>
          <label className="flex items-center cursor-pointer" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={field.toggle}
              onChange={(e) => updateMessageField(type, 'toggle', e.target.checked)}
              disabled={disabled}
              className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
            />
          </label>
        </button>

        {/* Section Content */}
        {isExpanded && (
          <div className="p-4 space-y-3 bg-white">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">
                  訊息範本 {field.toggle && <span className="text-red-500">*</span>}
                </label>
                <div className="flex items-center gap-2">
                  <PlaceholderHelper
                    messageType={type}
                    onInsert={(placeholder) => handleInsertPlaceholder(type, placeholder)}
                    disabled={disabled}
                  />
                  <button
                    type="button"
                    onClick={() => handlePreview(type)}
                    disabled={disabled || isNewItem}
                    className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400"
                    title={isNewItem ? "請先儲存服務項目後再預覽訊息" : undefined}
                  >
                    預覽訊息
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResetToDefault(type)}
                    disabled={disabled}
                    className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400"
                  >
                    重設為預設值
                  </button>
                </div>
              </div>
              <textarea
                ref={(el) => { textareaRefs.current[type] = el; }}
                name={`${type}_message`}
                value={field.message}
                onChange={(e) => updateMessageField(type, 'message', e.target.value)}
                disabled={disabled}
                rows={8}
                className={`w-full px-3 py-2 border rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  isOverLimit ? 'border-red-500' : isWarning ? 'border-yellow-500' : 'border-gray-300'
                } disabled:bg-gray-100 disabled:cursor-not-allowed`}
                placeholder="輸入訊息範本..."
              />
              <div className="flex items-center justify-between mt-1">
                <div className="text-xs text-gray-500">
                  {field.toggle && !field.message.trim() && (
                    <span className="text-red-600">當開關開啟時，訊息範本為必填</span>
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
      <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm p-0 md:p-6" data-message-settings>
        <div className="px-4 py-4 md:px-0 md:py-0">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">訊息設定</h3>
          <div className="space-y-3">
            {renderMessageSection('patient_confirmation', patientConfirmation)}
            {renderMessageSection('clinic_confirmation', clinicConfirmation)}
            {renderMessageSection('reminder', reminder)}
          </div>
        </div>
      </div>

      <MessagePreviewModal
        isOpen={previewModal.isOpen}
        onClose={() => setPreviewModal({ ...previewModal, isOpen: false })}
        appointmentTypeId={appointmentType.id}
        messageType={previewModal.messageType}
        template={previewModal.template}
      />
    </>
  );
};


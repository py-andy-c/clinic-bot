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
import { WarningPopover } from './shared/WarningPopover';

interface MessageSettingsSectionProps {
  appointmentType: AppointmentType;
  onUpdate: (updated: AppointmentType) => void;
  disabled?: boolean;
  clinicInfoAvailability?: {
    has_address?: boolean;
    has_phone?: boolean;
  };
}

interface MessageFieldState {
  toggle: boolean;
  message: string;
}

export const MessageSettingsSection: React.FC<MessageSettingsSectionProps> = ({
  appointmentType,
  onUpdate,
  disabled = false,
  clinicInfoAvailability,
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

    // Get raw toggle value from appointmentType
    // Check both the direct property and if it exists in the object
    const rawToggle = appointmentType[toggleKey] as boolean | undefined;

    // Default logic: only use defaults if value is actually undefined
    // For patient_confirmation on existing items, migration set it to false, but if user changed it to true, respect that
    let defaultToggle: boolean;
    if (type === 'patient_confirmation' && !isNewItem) {
      // For existing items, if value is undefined, default to false (migration behavior)
      // But if value is explicitly set (true or false), use that value
      defaultToggle = false;
    } else {
      defaultToggle = true;
    }

    // Use raw value if present (including false), otherwise use default
    // This ensures that if database has true, we use true, not the default
    const toggle = rawToggle !== undefined ? rawToggle : defaultToggle;
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

      // Safety net: If toggle is turned ON and message is empty, auto-set default
      if (value === true) {
        const messageKey = `${type}_message` as keyof AppointmentType;
        const currentMessage = updated[messageKey] as string | undefined;

        if (!currentMessage || currentMessage.trim() === '') {
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
          (updated as any)[messageKey] = defaultMessage;
        }
      }
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
        <div className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors flex items-center justify-between">
          <button
            type="button"
            onClick={() => toggleSection(type)}
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
              <div className="text-sm font-medium text-gray-900 flex items-center gap-2">
                <span>{MESSAGE_TYPE_LABELS[type]}</span>
                {type === 'patient_confirmation' && !appointmentType.allow_new_patient_booking && !appointmentType.allow_existing_patient_booking && (
                  <WarningPopover message="此服務項目未開放病患自行預約，此設定不會生效。">
                    <span className="text-amber-600 hover:text-amber-700 cursor-pointer">⚠️</span>
                  </WarningPopover>
                )}
              </div>
              <div className="text-xs text-gray-500">
                {MESSAGE_TYPE_DESCRIPTIONS[type]}
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
              checked={field.toggle}
              onChange={(e) => updateMessageField(type, 'toggle', e.target.checked)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              disabled={disabled}
              className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
              aria-label={`${MESSAGE_TYPE_LABELS[type]} 開關`}
            />
          </div>
        </div>

        {/* Section Content */}
        {isExpanded && (
          <div className="p-4 space-y-3 bg-white">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">
                  訊息模板 {field.toggle && <span className="text-red-500">*</span>}
                </label>
                <div className="flex items-center gap-2">
                  <PlaceholderHelper
                    messageType={type}
                    onInsert={(placeholder) => handleInsertPlaceholder(type, placeholder)}
                    disabled={disabled}
                    {...(clinicInfoAvailability !== undefined && { clinicInfoAvailability })}
                  />
                  <button
                    type="button"
                    onClick={() => handlePreview(type)}
                    disabled={disabled}
                    className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400"
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
                className={`w-full px-3 py-2 border rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${isOverLimit ? 'border-red-500' : isWarning ? 'border-yellow-500' : 'border-gray-300'
                  } disabled:bg-gray-100 disabled:cursor-not-allowed`}
                placeholder="輸入訊息模板..."
              />
              <div className="flex items-center justify-between mt-1">
                <div className="text-xs text-gray-500">
                  {field.toggle && !field.message.trim() && (
                    <span className="text-red-600">當開關開啟時，訊息模板為必填</span>
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
      <div className="space-y-3" data-message-settings>
        {renderMessageSection('patient_confirmation', patientConfirmation)}
        {renderMessageSection('clinic_confirmation', clinicConfirmation)}
        {renderMessageSection('reminder', reminder)}
      </div>

      <MessagePreviewModal
        isOpen={previewModal.isOpen}
        onClose={() => setPreviewModal({ ...previewModal, isOpen: false })}
        {...(isNewItem ? { appointmentTypeName: appointmentType.name } : { appointmentTypeId: appointmentType.id })}
        messageType={previewModal.messageType}
        template={previewModal.template}
      />
    </>
  );
};


import React, { useState, useRef } from 'react';
import { useFormContext } from 'react-hook-form';
import { PlaceholderHelper } from './PlaceholderHelper';
import { MessagePreviewModal } from './MessagePreviewModal';
import {
  DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
  DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
  DEFAULT_REMINDER_MESSAGE,
  DEFAULT_RECURRENT_CLINIC_CONFIRMATION_MESSAGE,
  MessageType,
  MESSAGE_TYPE_LABELS,
  MESSAGE_TYPE_DESCRIPTIONS,
} from '../constants/messageTemplates';
import { isTemporaryServiceItemId } from '../utils/idUtils';
import { WarningPopover } from './shared/WarningPopover';

interface MessageSettingsSectionProps {
  appointmentTypeId: number;
  appointmentTypeName?: string;
  disabled?: boolean;
  clinicInfoAvailability?: {
    has_address?: boolean;
    has_phone?: boolean;
  };
}

export const MessageSettingsSection: React.FC<MessageSettingsSectionProps> = ({
  appointmentTypeId,
  appointmentTypeName,
  disabled = false,
  clinicInfoAvailability,
}) => {
  const { register, watch, setValue } = useFormContext();
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
    recurrent_clinic_confirmation: null,
  });

  const isNewItem = isTemporaryServiceItemId(appointmentTypeId);

  const allow_new_patient_booking = watch('allow_new_patient_booking');
  const allow_existing_patient_booking = watch('allow_existing_patient_booking');

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
      case 'recurrent_clinic_confirmation':
        defaultMessage = DEFAULT_RECURRENT_CLINIC_CONFIRMATION_MESSAGE;
        break;
    }
    setValue(`${type}_message`, defaultMessage, { shouldDirty: true });
  };

  const handlePreview = (type: MessageType) => {
    const template = watch(`${type}_message`);
    setPreviewModal({
      isOpen: true,
      messageType: type,
      template: template || '',
    });
  };

  const handleInsertPlaceholder = (type: MessageType, placeholder: string) => {
    const textarea = textareaRefs.current[type];
    const currentMessage = watch(`${type}_message`) || '';

    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newMessage = currentMessage.substring(0, start) + placeholder + currentMessage.substring(end);
      setValue(`${type}_message`, newMessage, { shouldDirty: true });

      // Restore cursor position after placeholder
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + placeholder.length, start + placeholder.length);
      }, 0);
    } else {
      // Fallback: append to end
      setValue(`${type}_message`, currentMessage + placeholder, { shouldDirty: true });
    }
  };

  const renderMessageSection = (type: MessageType) => {
    const toggleValue = watch(`send_${type}`);
    const messageValue = watch(`${type}_message`) || '';
    const charCount = messageValue.length;
    const isOverLimit = charCount > 3500;
    const isWarning = charCount > 3000;

    return (
      <div key={type} className="border border-gray-200 rounded-lg overflow-hidden" data-message-type={type}>
        {/* Section Header */}
        <div className="w-full px-4 py-3 bg-gray-50 flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 text-left">
            <div className="text-left">
              <div className="text-sm font-medium text-gray-900 flex items-center gap-2">
                <span>{MESSAGE_TYPE_LABELS[type]}</span>
                {type === 'patient_confirmation' && !allow_new_patient_booking && !allow_existing_patient_booking && (
                  <WarningPopover message="此服務項目未開放病患自行預約，此設定不會生效。">
                    <span className="text-amber-600 hover:text-amber-700 cursor-pointer">⚠️</span>
                  </WarningPopover>
                )}
              </div>
              <div className="text-xs text-gray-500">
                {MESSAGE_TYPE_DESCRIPTIONS[type]}
              </div>
            </div>
          </div>
          <div
            className="flex items-center cursor-pointer ml-4"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              {...register(`send_${type}`)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              disabled={disabled}
              className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
              aria-label={`${MESSAGE_TYPE_LABELS[type]} 開關`}
            />
          </div>
        </div>

        {/* Section Content - Always Expanded */}
        <div className="p-4 space-y-3 bg-white border-t border-gray-100">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">
                訊息模板 {toggleValue && <span className="text-red-500">*</span>}
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
              {...register(`${type}_message`)}
              ref={(el) => {
                textareaRefs.current[type] = el;
                const { ref } = register(`${type}_message`);
                if (typeof ref === 'function') ref(el);
                else if (ref) (ref as any).current = el;
              }}
              disabled={disabled}
              rows={8}
              className={`w-full px-3 py-2 border rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${isOverLimit ? 'border-red-500' : isWarning ? 'border-yellow-500' : 'border-gray-300'
                } disabled:bg-gray-100 disabled:cursor-not-allowed`}
              placeholder="輸入訊息模板..."
            />
            <div className="flex items-center justify-between mt-1">
              <div className="text-xs text-gray-500">
                {toggleValue && !messageValue.trim() && (
                  <span className="text-red-600">當開關開啟時，訊息模板為必填</span>
                )}
              </div>
              <div className={`text-xs ${isOverLimit ? 'text-red-600' : isWarning ? 'text-yellow-600' : 'text-gray-500'}`}>
                {charCount} / 3500 {isOverLimit && '(超過限制)'}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="space-y-3" data-message-settings>
        {renderMessageSection('patient_confirmation')}
        {renderMessageSection('clinic_confirmation')}
        {renderMessageSection('recurrent_clinic_confirmation')}
        {renderMessageSection('reminder')}
      </div>

      <MessagePreviewModal
        isOpen={previewModal.isOpen}
        onClose={() => setPreviewModal({ ...previewModal, isOpen: false })}
        {...(isNewItem ? { appointmentTypeName: appointmentTypeName || '' } : { appointmentTypeId })}
        messageType={previewModal.messageType}
        template={previewModal.template}
      />
    </>
  );
};

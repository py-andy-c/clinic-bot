import React, { useState, useEffect } from 'react';
import { BaseModal } from './shared/BaseModal';
import { apiService } from '../services/api';
import { LoadingSpinner } from './shared';
import { MessageType } from '../constants/messageTemplates';

interface MessagePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  appointmentTypeId?: number;
  appointmentTypeName?: string;
  messageType: MessageType;
  template: string;
}

export const MessagePreviewModal: React.FC<MessagePreviewModalProps> = ({
  isOpen,
  onClose,
  appointmentTypeId,
  appointmentTypeName,
  messageType,
  template,
}) => {
  const [preview, setPreview] = useState<{
    preview_message: string;
    used_placeholders: Record<string, string>;
    completeness_warnings?: string[];
    clinic_info_availability?: {
      has_address?: boolean;
      has_phone?: boolean;
    };
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && template) {
      loadPreview();
    } else {
      setPreview(null);
      setError(null);
    }
  }, [isOpen, template, appointmentTypeId, messageType]);

  const loadPreview = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiService.previewAppointmentMessage({
        ...(appointmentTypeId ? { appointment_type_id: appointmentTypeId } : {}),
        ...(appointmentTypeName ? { appointment_type_name: appointmentTypeName } : {}),
        message_type: messageType,
        template,
      });
      setPreview(result);
    } catch (err: unknown) {
      setError(err?.response?.data?.detail || '無法載入預覽');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <BaseModal onClose={onClose} aria-label="訊息預覽" className="max-w-2xl">
      <div className="p-6">
        <h2 className="text-xl font-semibold mb-4">訊息預覽</h2>

        {loading && (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {preview && !loading && (
          <div className="space-y-4">
            {/* Preview Message */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                預覽訊息
              </label>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 whitespace-pre-wrap text-sm">
                {preview.preview_message}
              </div>
            </div>

            {/* Used Placeholders */}
            {Object.keys(preview.used_placeholders).length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  使用的變數
                </label>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="space-y-2">
                    {Object.entries(preview.used_placeholders).map(([key, value]) => (
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

            {/* Completeness Warnings */}
            {preview.completeness_warnings && preview.completeness_warnings.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-yellow-700 mb-2">
                  注意事項
                </label>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <ul className="space-y-1">
                    {preview.completeness_warnings.map((warning, index) => (
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
                onClick={onClose}
                className="btn-primary px-4 py-2"
              >
                關閉
              </button>
            </div>
          </div>
        )}
      </div>
    </BaseModal>
  );
};


import React, { useState } from 'react';
import { useMedicalRecordTemplates, useCreateMedicalRecord } from '../../hooks/queries';
import { LoadingSpinner } from '../shared';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../types/api';
import { useModal } from '../../contexts/ModalContext';

interface CreateMedicalRecordModalProps {
  patientId: number;
  onClose: () => void;
  onSuccess: () => void;
}

export const CreateMedicalRecordModal: React.FC<CreateMedicalRecordModalProps> = ({
  patientId,
  onClose,
  onSuccess,
}) => {
  const { alert } = useModal();
  const { data: templates, isLoading: templatesLoading } = useMedicalRecordTemplates();
  const createMutation = useCreateMedicalRecord();
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedTemplateId) {
      await alert('請選擇病歷範本');
      return;
    }

    setIsSubmitting(true);
    try {
      await createMutation.mutateAsync({
        patientId,
        templateId: selectedTemplateId,
      });
      onSuccess();
      onClose();
    } catch (err) {
      logger.error('Create medical record error:', err);
      const errorMessage = getErrorMessage(err);
      await alert(errorMessage || '建立病歷記錄失敗');
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeTemplates = templates?.filter((t) => t.is_active) || [];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">新增病歷記錄</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
              disabled={isSubmitting}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {templatesLoading ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner />
            </div>
          ) : activeTemplates.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-600 mb-4">尚未建立病歷範本</p>
              <p className="text-sm text-gray-500">
                請先在設定頁面建立病歷範本，才能新增病歷記錄。
              </p>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  選擇病歷範本 <span className="text-red-500">*</span>
                </label>
                <div className="space-y-2">
                  {activeTemplates.map((template) => (
                    <label
                      key={template.id}
                      className={`flex items-start p-4 border rounded-lg cursor-pointer transition-colors ${
                        selectedTemplateId === template.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="template"
                        value={template.id}
                        checked={selectedTemplateId === template.id}
                        onChange={() => setSelectedTemplateId(template.id)}
                        className="mt-1 mr-3"
                        disabled={isSubmitting}
                      />
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{template.name}</div>
                        {template.header_fields && template.header_fields.length > 0 && (
                          <div className="text-sm text-gray-500 mt-1">
                            {template.header_fields.length} 個欄位
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn btn-secondary"
                  disabled={isSubmitting}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmitting || !selectedTemplateId}
                >
                  {isSubmitting ? '建立中...' : '建立病歷'}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
};

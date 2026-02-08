import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useModal } from '../../contexts/ModalContext';
import { useMedicalRecordTemplates, useDeleteMedicalRecordTemplate } from '../../hooks/useMedicalRecordTemplates';
import { MedicalRecordTemplate, MedicalRecordTemplateType } from '../../types/medicalRecord';
import { LoadingSpinner } from '../../components/shared/LoadingSpinner';
import SettingsBackButton from '../../components/SettingsBackButton';
import PageHeader from '../../components/PageHeader';
import { MedicalRecordTemplateEditorModal } from '../../components/MedicalRecordTemplateEditorModal';
import { getErrorMessage } from '../../types/api';
import { logger } from '../../utils/logger';

const SettingsPatientFormTemplatesPage: React.FC = () => {
  const [editingTemplateId, setEditingTemplateId] = useState<number | null | undefined>(undefined);
  const { isClinicAdmin, user } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const { alert, confirm } = useModal();

  const { data: templates, isLoading } = useMedicalRecordTemplates(activeClinicId ?? null, 'patient_form' as MedicalRecordTemplateType);
  const deleteTemplateMutation = useDeleteMedicalRecordTemplate(activeClinicId ?? null);

  const handleAddTemplate = () => {
    setEditingTemplateId(null);
  };

  const handleEditTemplate = (template: MedicalRecordTemplate) => {
    setEditingTemplateId(template.id);
  };

  const handleDeleteTemplate = async (template: MedicalRecordTemplate) => {
    const confirmed = await confirm(
      `確定要刪除「${template.name}」患者表單模板嗎？此動作不可復原。`,
      '刪除患者表單'
    );
    if (!confirmed) return;

    try {
      await deleteTemplateMutation.mutateAsync(template.id);
      await alert('模板已成功刪除', '刪除成功');
    } catch (error) {
      logger.error('Failed to delete template:', error);
      await alert(getErrorMessage(error), '刪除失敗');
    }
  };

  const handleCloseModal = () => {
    setEditingTemplateId(undefined);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <SettingsBackButton />
      
      <PageHeader title="患者表單模板" />

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-900">模板列表</h3>
          {isClinicAdmin && (
            <button
              onClick={handleAddTemplate}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              + 新增表單
            </button>
          )}
        </div>

        {!templates || templates.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="text-gray-400 text-5xl mb-4">📋</div>
            <p className="text-gray-600 mb-4">尚未建立任何患者表單模板</p>
            {isClinicAdmin && (
              <button
                onClick={handleAddTemplate}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
              >
                建立第一個模板
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {templates.map((template) => (
              <div
                key={template.id}
                className="px-6 py-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="text-base font-semibold text-gray-900">
                      {template.name}
                    </h4>
                    {template.description && (
                      <p className="text-sm text-gray-600 mt-1">
                        {template.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                      <span>{template.fields.length} 個欄位</span>
                      <span>照片上限: {template.max_photos}</span>
                      <span>版本 {template.version}</span>
                      <span>
                        建立於 {new Date(template.created_at).toLocaleDateString('zh-TW')}
                      </span>
                    </div>
                  </div>
                  
                  {isClinicAdmin && (
                    <div className="flex items-center gap-2 ml-4">
                      <button
                        onClick={() => handleEditTemplate(template)}
                        className="px-3 py-1.5 text-sm text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                      >
                        編輯
                      </button>
                      <button
                        onClick={() => handleDeleteTemplate(template)}
                        className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        disabled={deleteTemplateMutation.isPending}
                      >
                        刪除
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editingTemplateId !== undefined && (
        <MedicalRecordTemplateEditorModal
          templateId={editingTemplateId}
          defaultType="patient_form"
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
};

export default SettingsPatientFormTemplatesPage;

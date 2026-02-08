import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useModal } from '../../contexts/ModalContext';
import { useMedicalRecordTemplates, useDeleteMedicalRecordTemplate } from '../../hooks/useMedicalRecordTemplates';
import { MedicalRecordTemplate, MedicalRecordTemplateType } from '../../types/medicalRecord';
import { ActionableCard, LoadingSpinner } from '../../components/shared';
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
              <ActionableCard
                key={template.id}
                title={template.name}
                description={template.description}
                actions={isClinicAdmin ? [
                  {
                    label: '編輯',
                    onClick: () => handleEditTemplate(template),
                    variant: 'secondary'
                  },
                  {
                    label: '刪除',
                    onClick: () => handleDeleteTemplate(template),
                    variant: 'danger',
                    disabled: deleteTemplateMutation.isPending
                  }
                ] : []}
                metadata={[
                  {
                    icon: (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    ),
                    label: `${template.fields.length} 個欄位`
                  },
                  {
                    icon: (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    ),
                    label: `照片上限: ${template.max_photos}`
                  },
                  {
                    icon: (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                    ),
                    label: `版本 ${template.version}`
                  },
                  {
                    icon: (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    ),
                    label: `建立於 ${new Date(template.created_at).toLocaleDateString('zh-TW')}`
                  }
                ]}
                className="!border-0 !rounded-none border-b border-gray-100 last:border-b-0 py-5"
              />
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

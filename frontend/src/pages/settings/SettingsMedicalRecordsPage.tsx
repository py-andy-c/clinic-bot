import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import PageHeader from '../../components/PageHeader';
import { LoadingSpinner, Button } from '../../components/shared';
import { MedicalRecordTemplate } from '../../types';
import MedicalRecordTemplateBuilder from '../../components/medical-record/MedicalRecordTemplateBuilder';

const SettingsMedicalRecordsPage: React.FC = () => {
    const queryClient = useQueryClient();
    const [editingTemplate, setEditingTemplate] = useState<MedicalRecordTemplate | null>(null);
    const [isCreating, setIsCreating] = useState(false);

    const { data, isLoading, error } = useQuery({
        queryKey: ['medical-record-templates'],
        queryFn: () => apiService.getMedicalRecordTemplates(false),
    });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => apiService.deleteMedicalRecordTemplate(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['medical-record-templates'] });
        },
    });

    if (editingTemplate || isCreating) {
        return (
            <MedicalRecordTemplateBuilder
                template={editingTemplate || undefined}
                onClose={() => {
                    setEditingTemplate(null);
                    setIsCreating(false);
                }}
                onSave={() => {
                    queryClient.invalidateQueries({ queryKey: ['medical-record-templates'] });
                    setEditingTemplate(null);
                    setIsCreating(false);
                }}
            />
        );
    }

    if (isLoading) return <LoadingSpinner size="xl" center />;
    if (error) return <div className="text-red-500">載入模板失敗</div>;

    return (
        <div className="space-y-6">
            <PageHeader
                title="病歷模板管理"
                action={
                    <Button
                        variant="primary"
                        onClick={() => setIsCreating(true)}
                    >
                        建立新模板
                    </Button>
                }
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {data?.templates.map((template) => (
                    <div
                        key={template.id}
                        className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-all group"
                    >
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900 group-hover:text-primary-600 transition-colors">
                                    {template.name}
                                </h3>
                                <p className="text-sm text-gray-500">
                                    {template.header_fields?.length || 0} 個欄位 | {template.workspace_config?.base_layers?.length || 0} 個底圖
                                </p>
                            </div>
                            <div className={`px-2 py-1 rounded text-xs font-medium ${template.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                {template.is_active ? '啟用中' : '已停用'}
                            </div>
                        </div>

                        <div className="flex gap-2 mt-4">
                            <Button
                                variant="outline"
                                size="sm"
                                className="flex-1"
                                onClick={() => setEditingTemplate(template)}
                            >
                                編輯
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-100 hover:border-red-200"
                                onClick={() => {
                                    if (window.confirm('確定要刪除此模板嗎？')) {
                                        deleteMutation.mutate(template.id);
                                    }
                                }}
                            >
                                刪除
                            </Button>
                        </div>
                    </div>
                ))}

                {data?.templates.length === 0 && (
                    <div className="col-span-full py-12 text-center bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                        <p className="text-gray-500">尚未建立任何模板</p>
                        <Button
                            variant="link"
                            className="mt-2 text-primary-600"
                            onClick={() => setIsCreating(true)}
                        >
                            立即建立第一個模板
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SettingsMedicalRecordsPage;

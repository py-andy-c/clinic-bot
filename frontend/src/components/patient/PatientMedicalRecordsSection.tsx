import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { LoadingSpinner, Button } from '../shared';
import { MedicalRecordListItem, MedicalRecordTemplate } from '../../types';
import moment from 'moment';

interface PatientMedicalRecordsSectionProps {
    patientId: number;
}

export const PatientMedicalRecordsSection: React.FC<PatientMedicalRecordsSectionProps> = ({
    patientId,
}) => {
    const queryClient = useQueryClient();
    const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);

    const { data: recordsData, isLoading: loadingRecords } = useQuery({
        queryKey: ['patient-medical-records', patientId],
        queryFn: () => apiService.getPatientMedicalRecords(patientId),
    });

    const { data: templatesData } = useQuery({
        queryKey: ['medical-record-templates', 'active'],
        queryFn: () => apiService.getMedicalRecordTemplates(true),
        enabled: isTemplateModalOpen,
    });

    const createMutation = useMutation({
        mutationFn: (templateId: number) =>
            apiService.createMedicalRecord({ patient_id: patientId, template_id: templateId }),
        onSuccess: (newRecord) => {
            queryClient.invalidateQueries({ queryKey: ['patient-medical-records', patientId] });
            setIsTemplateModalOpen(false);
            // Navigate to workspace (To be implemented)
            window.location.href = `/admin/clinic/medical-records/${newRecord.id}`;
        },
    });

    if (loadingRecords) return <LoadingSpinner size="md" />;

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <span className="text-xl">📋</span>
                    病歷紀錄
                </h3>
                <Button
                    size="sm"
                    variant="primary"
                    onClick={() => setIsTemplateModalOpen(true)}
                >
                    + 新增病歷
                </Button>
            </div>

            <div className="divide-y divide-gray-50">
                {recordsData?.records.map((record) => (
                    <div
                        key={record.id}
                        className="px-6 py-4 hover:bg-gray-50 transition-colors cursor-pointer group"
                        onClick={() => window.location.href = `/admin/clinic/medical-records/${record.id}`}
                    >
                        <div className="flex justify-between items-center">
                            <div>
                                <p className="font-semibold text-gray-900 group-hover:text-primary-600 transition-colors">
                                    {record.template_name}
                                </p>
                                <p className="text-xs text-gray-500">
                                    建立於 {moment(record.created_at).format('YYYY-MM-DD HH:mm')}
                                </p>
                            </div>
                            <div className="text-gray-400 group-hover:text-primary-500 transition-colors">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                            </div>
                        </div>
                    </div>
                ))}

                {recordsData?.records.length === 0 && (
                    <div className="px-6 py-12 text-center text-gray-500 italic">
                        目前尚無病歷紀錄
                    </div>
                )}
            </div>

            {/* Template Selection Modal */}
            {isTemplateModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                            <h4 className="text-lg font-bold text-gray-900">選擇病歷模板</h4>
                            <button
                                onClick={() => setIsTemplateModalOpen(false)}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="p-4 space-y-2 max-h-[400px] overflow-y-auto">
                            {templatesData?.templates.map((template) => (
                                <button
                                    key={template.id}
                                    onClick={() => createMutation.mutate(template.id)}
                                    disabled={createMutation.isPending}
                                    className="w-full text-left px-4 py-3 rounded-xl border border-gray-100 hover:border-primary-200 hover:bg-primary-50 transition-all flex justify-between items-center group"
                                >
                                    <div>
                                        <p className="font-medium text-gray-900 group-hover:text-primary-700">{template.name}</p>
                                        <p className="text-xs text-gray-500">{template.header_fields?.length || 0} 個欄位</p>
                                    </div>
                                    {createMutation.isPending ? (
                                        <LoadingSpinner size="sm" />
                                    ) : (
                                        <span className="text-primary-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                            使用 →
                                        </span>
                                    )}
                                </button>
                            ))}
                            {templatesData?.templates.length === 0 && (
                                <p className="text-center py-8 text-gray-500">尚未建立任何模板，請先至設定中建立。</p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

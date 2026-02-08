import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { ActionableCard, LoadingSpinner } from '../../components/shared';
import SettingsBackButton from '../../components/SettingsBackButton';
import PageHeader from '../../components/PageHeader';
import { useModal } from '../../contexts/ModalContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import ResourceTypeEditModal from '../../components/ResourceTypeEditModal';
import { ValidationErrorBoundary } from '../../components/shared/ValidationErrorBoundary';
import { ResourceType } from '../../types';
import { getErrorMessage } from '../../types/api';

const SettingsResourcesPage: React.FC = () => {
    const queryClient = useQueryClient();
    const { isClinicAdmin } = useAuth();
    const { alert, confirm } = useModal();
    const [editingResourceType, setEditingResourceType] = useState<number | null>(null);
    const [isAddingNew, setIsAddingNew] = useState(false);

    const { data: resourceTypesData, isLoading: typesLoading } = useQuery({
        queryKey: ['settings', 'resource-types'],
        queryFn: () => apiService.getResourceTypes(),
    });

    const resourceTypes = resourceTypesData?.resource_types || [];

    const deleteMutation = useMutation({
        mutationFn: (id: number) => apiService.deleteResourceType(id),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['settings', 'resource-types'] });
            await alert('資源類型已刪除');
        },
        onError: async (err: any) => {
            await alert(getErrorMessage(err) || '刪除失敗', '錯誤');
        },
    });

    const handleDelete = async (type: ResourceType) => {
        const confirmed = await confirm(
            `確定要刪除資源類型「${type.name}」嗎？\n\n此操作將刪除此類別下的所有具體資源，且無法復原。`,
            '確認刪除'
        );
        if (confirmed) {
            deleteMutation.mutate(type.id);
        }
    };

    if (typesLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <LoadingSpinner />
            </div>
        );
    }

    return (
        <div className="pb-24">
            <SettingsBackButton />
            <div className="flex justify-between items-center mb-6">
                <PageHeader title="設備資源設定" />
                {isClinicAdmin && (
                    <button
                        onClick={() => setIsAddingNew(true)}
                        className="btn-primary text-sm px-4 py-2"
                    >
                        + 新增類型
                    </button>
                )}
            </div>

            <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm overflow-hidden">
                <div className="divide-y divide-gray-100">
                    {resourceTypes.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            尚未設定任何設備資源
                        </div>
                    ) : (
                        resourceTypes.map((type: ResourceType) => (
                            <ActionableCard
                                key={type.id}
                                title={type.name}
                                actions={[
                                    {
                                        label: '編輯',
                                        onClick: () => setEditingResourceType(type.id),
                                        variant: 'secondary'
                                    },
                                    ...(isClinicAdmin ? [{
                                        label: '刪除',
                                        onClick: () => handleDelete(type),
                                        variant: 'danger' as const
                                    }] : [])
                                ]}
                                metadata={[
                                    {
                                        icon: (
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                            </svg>
                                        ),
                                        label: `${type.resource_count} 個資源`
                                    }
                                ]}
                                className="!border-0 !rounded-none border-b border-gray-100 last:border-b-0 py-5"
                            />
                        ))
                    )}
                </div>
            </div>

            {(editingResourceType || isAddingNew) && (
                <ValidationErrorBoundary>
                    <ResourceTypeEditModal
                        resourceTypeId={editingResourceType}
                        existingNames={resourceTypes.map(rt => rt.name)}
                        onClose={() => {
                            setEditingResourceType(null);
                            setIsAddingNew(false);
                        }}
                    />
                </ValidationErrorBoundary>
            )}
            {deleteMutation.isPending && <LoadingSpinner fullScreen />}
        </div>
    );
};

export default SettingsResourcesPage;

import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { LoadingSpinner } from '../../components/shared';
import SettingsBackButton from '../../components/SettingsBackButton';
import PageHeader from '../../components/PageHeader';
import { useModal } from '../../contexts/ModalContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import ResourceTypeEditModal from '../../components/ResourceTypeEditModal';
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
                            <div
                                key={type.id}
                                className="p-4 md:p-6 flex items-center justify-between hover:bg-gray-50 transition-colors"
                            >
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900">{type.name}</h3>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <button
                                        onClick={() => setEditingResourceType(type.id)}
                                        className="p-2 text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                                    >
                                        編輯
                                    </button>
                                    {isClinicAdmin && (
                                        <button
                                            onClick={() => handleDelete(type)}
                                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                        >
                                            刪除
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {(editingResourceType || isAddingNew) && (
                <ResourceTypeEditModal
                    resourceTypeId={editingResourceType}
                    onClose={() => {
                        setEditingResourceType(null);
                        setIsAddingNew(false);
                    }}
                />
            )}
            {deleteMutation.isPending && <LoadingSpinner fullScreen />}
        </div>
    );
};

export default SettingsResourcesPage;

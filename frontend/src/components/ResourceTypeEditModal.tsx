import React, { useEffect } from 'react';
import { useForm, useFieldArray, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BaseModal } from './shared';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { getErrorMessage } from '../types/api';
import { useModal } from '../contexts/ModalContext';
import { logger } from '../utils/logger';
import { useUnsavedChangesDetection } from '../hooks/useUnsavedChangesDetection';

const resourceBundleSchema = z.object({
    id: z.number().optional(),
    name: z.string().min(1, '請輸入資源名稱'),
    description: z.string().nullable().optional(),
});

const resourceTypeBundleSchema = z.object({
    name: z.string().min(1, '請輸入資源類型名稱'),
    resources: z.array(resourceBundleSchema),
});

type ResourceTypeBundleFormData = z.infer<typeof resourceTypeBundleSchema>;

interface ResourceTypeEditModalProps {
    resourceTypeId?: number | null; // If undefined/null, we're creating a new one
    onClose: () => void;
}

const ResourceTypeEditModal: React.FC<ResourceTypeEditModalProps> = ({
    resourceTypeId,
    onClose,
}) => {
    const queryClient = useQueryClient();
    const { alert } = useModal();
    const isEdit = !!resourceTypeId;

    const { data: bundle, isLoading } = useQuery({
        queryKey: ['settings', 'resource-type', resourceTypeId],
        queryFn: () => apiService.getResourceTypeBundle(resourceTypeId!),
        enabled: isEdit,
    });

    const methods = useForm<ResourceTypeBundleFormData>({
        resolver: zodResolver(resourceTypeBundleSchema),
        defaultValues: {
            name: '',
            resources: [],
        },
    });

    const {
        register,
        control,
        handleSubmit,
        reset,
        formState: { errors },
    } = methods;

    const { fields, append, remove } = useFieldArray({
        control,
        name: 'resources',
    });

    useUnsavedChangesDetection({
        hasUnsavedChanges: () => methods.formState.isDirty,
    });

    useEffect(() => {
        if (bundle) {
            reset({
                name: bundle.resource_type.name,
                resources: bundle.resources.map((r) => ({
                    id: r.id,
                    name: r.name,
                    description: r.description || '',
                })),
            });
        } else if (!resourceTypeId) {
            reset({
                name: '',
                resources: [],
            });
        }
    }, [bundle, resourceTypeId, reset]);

    const mutation = useMutation({
        mutationFn: (data: ResourceTypeBundleFormData) => {
            const request = {
                name: data.name,
                resources: data.resources.map(r => ({
                    ...(r.id ? { id: r.id } : {}),
                    name: r.name,
                    description: r.description || null,
                })),
            };

            if (isEdit) {
                return apiService.updateResourceTypeBundle(resourceTypeId!, request);
            } else {
                return apiService.createResourceTypeBundle(request);
            }
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['settings', 'resource-types'] });
            await queryClient.invalidateQueries({ queryKey: ['settings', 'resources'] });
            await alert(isEdit ? '資源類型已更新' : '資源類型已建立');
            onClose();
        },
        onError: async (err: any) => {
            logger.error('Error saving resource type bundle:', err);
            await alert(getErrorMessage(err) || '儲存失敗', '錯誤');
        },
    });

    const onSubmit = (data: ResourceTypeBundleFormData) => {
        mutation.mutate(data);
    };

    return (
        <BaseModal onClose={onClose} aria-label={isEdit ? '編輯資源類型' : '新增資源類型'}>
            <FormProvider {...methods}>
                <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6 max-h-[85vh] overflow-y-auto w-full max-w-2xl">
                    <div className="flex justify-between items-center border-b pb-4">
                        <h2 className="text-xl font-bold text-gray-900">
                            {isEdit ? '編輯資源類型' : '新增資源類型'}
                        </h2>
                    </div>

                    {isLoading ? (
                        <div className="flex justify-center py-12">
                            <span className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full"></span>
                        </div>
                    ) : (
                        <>
                            {/* Basic Info */}
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        資源類型名稱 <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        {...register('name')}
                                        type="text"
                                        className={`block w-full rounded-md border shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm p-2 ${errors.name ? 'border-red-300' : 'border-gray-300'
                                            }`}
                                        placeholder="例如：診間、治療床、儀器"
                                    />
                                    {errors.name && (
                                        <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>
                                    )}
                                </div>
                            </div>

                            {/* Resources List */}
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <h3 className="text-md font-semibold text-gray-800">具體資源清單</h3>
                                    <button
                                        type="button"
                                        onClick={() => append({ name: '', description: '' })}
                                        className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                                    >
                                        + 新增資源
                                    </button>
                                </div>

                                <div className="space-y-3">
                                    {fields.map((field, index) => (
                                        <div key={field.id} className="bg-gray-50 p-4 rounded-lg border border-gray-200 relative group">
                                            <button
                                                type="button"
                                                onClick={() => remove(index)}
                                                className="absolute top-2 right-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                                </svg>
                                            </button>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-500 mb-1">
                                                        資源名稱
                                                    </label>
                                                    <input
                                                        {...register(`resources.${index}.name` as const)}
                                                        type="text"
                                                        placeholder="例如：診間 1"
                                                        className="block w-full rounded-md border-gray-300 shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm p-2"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-500 mb-1">
                                                        描述 (選填)
                                                    </label>
                                                    <input
                                                        {...register(`resources.${index}.description` as const)}
                                                        type="text"
                                                        placeholder="例如：靠近窗戶"
                                                        className="block w-full rounded-md border-gray-300 shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm p-2"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ))}

                                    {fields.length === 0 && (
                                        <div className="text-center py-6 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                                            <p className="text-sm text-gray-500">尚未新增任何資源</p>
                                            <button
                                                type="button"
                                                onClick={() => append({ name: '', description: '' })}
                                                className="mt-2 text-sm text-primary-600 font-medium"
                                            >
                                                點此新增第一個資源
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex justify-end space-x-3 pt-6 border-t">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                                >
                                    取消
                                </button>
                                <button
                                    type="submit"
                                    disabled={mutation.isPending}
                                    className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50"
                                >
                                    {mutation.isPending ? '儲存中...' : '儲存'}
                                </button>
                            </div>
                        </>
                    )}
                </form>
            </FormProvider>
        </BaseModal>
    );
};

export default ResourceTypeEditModal;

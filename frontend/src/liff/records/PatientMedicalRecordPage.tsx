import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FieldValues, useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LoadingSpinner, ErrorMessage } from '../../components/shared';
import { MedicalRecordDynamicForm } from '../../components/MedicalRecordDynamicForm';
import { MedicalRecordPhotoSelector } from '../../components/MedicalRecordPhotoSelector';
import { useLiffMedicalRecord, useLiffUpdateMedicalRecord } from '../hooks/medicalRecordHooks';
import { TemplateField } from '../../types/medicalRecord';
import { createMedicalRecordDynamicSchema, isStructuredError } from '../../utils/medicalRecordUtils';
import { useModal } from '../../contexts/ModalContext';
import { logger } from '../../utils/logger';

type RecordFormData = {
    values: Record<string, any>;
} & FieldValues;

const PatientMedicalRecordPage: React.FC = () => {
    const [searchParams] = useSearchParams();
    const { alert } = useModal();
    const pathParam = searchParams.get('path') || '';

    const recordId = useMemo(() => {
        if (pathParam) {
            const id = parseInt(pathParam.split('/').pop() || '', 10);
            if (!isNaN(id)) return id;
        }

        // Fallback: Check pathname (e.g. /records/123)
        const pathSegments = window.location.pathname.split('/');
        const lastSegment = pathSegments.pop();
        if (lastSegment && !isNaN(parseInt(lastSegment, 10))) {
            return parseInt(lastSegment, 10);
        }

        return NaN;
    }, [pathParam]);

    const { data: record, isLoading: loadingRecord, error: recordError } = useLiffMedicalRecord(
        isNaN(recordId) ? null : recordId
    );

    const updateMutation = useLiffUpdateMedicalRecord();
    const [selectedPhotoIds, setSelectedPhotoIds] = useState<number[]>([]);
    const [initialPhotoIds, setInitialPhotoIds] = useState<number[]>([]); // Track initial state for dirty detection
    const [isSuccess, setIsSuccess] = useState(false);

    const dynamicSchema = useMemo(
        () => z.object({
            values: createMedicalRecordDynamicSchema(record?.template_snapshot?.fields),
        }),
        [record?.template_snapshot?.fields]
    );

    const methods = useForm<RecordFormData>({
        resolver: zodResolver(dynamicSchema),
        defaultValues: {
            values: {},
        },
    });

    useEffect(() => {
        if (record) {
            const normalizedValues = { ...(record.values || {}) };
            record.template_snapshot?.fields?.forEach((field: TemplateField) => {
                if (
                    ['text', 'textarea', 'dropdown', 'radio', 'date'].includes(field.type) &&
                    normalizedValues[field.id] === null
                ) {
                    normalizedValues[field.id] = '';
                }
            });

            methods.reset({
                values: normalizedValues,
            });

            if (record.photos) {
                const photoIds = record.photos.map(p => p.id);
                setSelectedPhotoIds(photoIds);
                setInitialPhotoIds(photoIds); // Track initial state
            }
        }
    }, [record, methods]);

    // Calculate if photos have changed (for dirty state detection)
    // Note: Photo descriptions are saved immediately by MedicalRecordPhotoSelector,
    // so we only track photo selection changes (add/remove) here
    const photosDirty = useMemo(() => {
        return JSON.stringify([...selectedPhotoIds].sort()) !== JSON.stringify([...initialPhotoIds].sort());
    }, [selectedPhotoIds, initialPhotoIds]);

    const onSubmit = async (data: RecordFormData, isSubmitted: boolean = false) => {
        if (!record) return;

        try {
            await updateMutation.mutateAsync({
                recordId: record.id,
                data: {
                    version: record.version,
                    values: data.values,
                    is_submitted: isSubmitted,
                    photo_ids: selectedPhotoIds,
                },
            });

            // Reset photo state after successful save
            setInitialPhotoIds([...selectedPhotoIds]);

            if (isSubmitted) {
                setIsSuccess(true);
            } else {
                await alert('已儲存變更', '儲存成功');
            }
        } catch (error: any) {
            logger.error('Failed to save record:', error);

            // Handle structured error responses
            const errorDetail = error.response?.data?.detail;
            const errorCode = isStructuredError(errorDetail) ? errorDetail.error_code : null;

            if (error.response?.status === 409 || errorCode === 'RECORD_MODIFIED') {
                const message = (isStructuredError(errorDetail) ? errorDetail.message : null) || '此紀錄已被其他使用者修改，請重新整理後再試';
                await alert(message, '紀錄已更新');
                window.location.reload();
            } else {
                const message = (isStructuredError(errorDetail) ? errorDetail.message : null) || '儲存失敗，請重試';
                await alert(message, '錯誤');
            }
        }
    };

    if (loadingRecord) return <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>;
    if (recordError || !record || isNaN(recordId)) {
        return (
            <div className="p-6">
                <ErrorMessage message="無法載入連結。此連結可能已失效或您沒有存取權限。" />
            </div>
        );
    }

    if (isSuccess) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
                <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                </div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">填寫完成</h1>
                <p className="text-gray-500 mb-8">感謝您的配合，表單已成功送出。</p>
                <button
                    onClick={() => window.close()}
                    className="w-full max-w-xs py-3 bg-primary-600 text-white rounded-xl font-semibold shadow-lg active:scale-95 transition-all"
                >
                    關閉
                </button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white pb-20">
            {/* Sticky header warning for unsaved changes - at the very top */}
            {(methods.formState.isDirty || photosDirty) && !updateMutation.isPending && (
                <div className="sticky top-0 z-10 bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-center gap-2">
                    <svg 
                        className="w-5 h-5 text-amber-600 flex-shrink-0" 
                        fill="currentColor" 
                        viewBox="0 0 20 20"
                    >
                        <path 
                            fillRule="evenodd" 
                            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" 
                            clipRule="evenodd" 
                        />
                    </svg>
                    <span className="text-sm font-medium text-amber-800">
                        尚未儲存，請滑至底部送出
                    </span>
                </div>
            )}

            <div className="bg-white border-b border-gray-100">
                <div className="px-4 py-4">
                    <h1 className="text-lg font-bold text-gray-900 truncate">
                        {record.template_name}
                    </h1>
                    {record.template_snapshot?.description && (
                        <p className="text-sm text-gray-500 mt-1 whitespace-pre-wrap">
                            {record.template_snapshot.description}
                        </p>
                    )}
                </div>
            </div>

            <div className="px-4 py-6">
                <FormProvider {...methods}>
                    <form className="space-y-8">
                        <MedicalRecordDynamicForm fields={record.template_snapshot.fields || []} />

                        <div className="pt-8 border-t border-gray-100">
                            <MedicalRecordPhotoSelector
                                variant="liff"
                                clinicId={null}
                                patientId={record.patient_id}
                                recordId={record.id}
                                initialPhotos={record.photos}
                                selectedPhotoIds={selectedPhotoIds}
                                onPhotoIdsChange={setSelectedPhotoIds}
                            />
                        </div>

                        <div className="pt-4">
                            <button
                                type="button"
                                onClick={methods.handleSubmit((data) => onSubmit(data, true))}
                                disabled={updateMutation.isPending}
                                className="w-full py-4 bg-primary-600 text-white rounded-xl font-bold text-lg shadow-lg active:scale-[0.98] disabled:opacity-50 transition-all"
                            >
                                {updateMutation.isPending
                                    ? '送出中...'
                                    : (record.patient_last_edited_at ? '儲存更動' : '確認送出')}
                            </button>
                            <p className="text-center text-sm text-gray-600 mt-4">
                                送出後診所將會收到您的回覆
                            </p>
                        </div>
                    </form>
                </FormProvider>
            </div>
        </div>
    );
};

export default PatientMedicalRecordPage;

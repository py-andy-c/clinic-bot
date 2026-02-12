import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FieldValues, useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LoadingSpinner, ErrorMessage } from '../../components/shared';
import { MedicalRecordDynamicForm } from '../../components/MedicalRecordDynamicForm';
import { LiffMedicalRecordPhotoSelector } from './LiffMedicalRecordPhotoSelector';
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
                setSelectedPhotoIds(record.photos.map(p => p.id));
            }
        }
    }, [record, methods]);

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
        <div className="min-h-screen bg-gray-50 pb-20">
            <div className="bg-white shadow-sm sticky top-0 z-10">
                <div className="px-5 py-4 flex items-center justify-between">
                    <h1 className="text-lg font-bold text-gray-900 truncate pr-4">
                        {record.template_name}
                    </h1>
                </div>
            </div>

            <div className="px-5 py-6">
                <FormProvider {...methods}>
                    <form className="space-y-10">
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                            <MedicalRecordDynamicForm fields={record.template_snapshot.fields || []} />
                        </div>

                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                            <LiffMedicalRecordPhotoSelector
                                patientId={record.patient_id}
                                recordId={record.id}
                                photos={record.photos}
                                onPhotosChange={setSelectedPhotoIds}
                            />
                        </div>

                        <div className="pt-4">
                            <button
                                type="button"
                                onClick={methods.handleSubmit((data) => onSubmit(data, true))}
                                disabled={updateMutation.isPending}
                                className="w-full py-4 bg-primary-600 text-white rounded-2xl font-bold text-lg shadow-xl shadow-primary-200 active:scale-[0.98] active:shadow-lg disabled:opacity-50 transition-all"
                            >
                                {updateMutation.isPending
                                    ? '送出中...'
                                    : (record.patient_last_edited_at ? '儲存修改' : '確認送出')}
                            </button>
                            <p className="text-center text-xs text-gray-400 mt-4">
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

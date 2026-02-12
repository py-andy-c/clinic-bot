import React, { useMemo, useEffect, useState, useRef, useCallback } from 'react';
import { useForm, FormProvider, useFormContext } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BaseModal } from './shared/BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from './shared/ModalParts';
import { LoadingSpinner } from './shared';
import { FormField } from './forms';
import { useSendPatientForm } from '../hooks/useMedicalRecords';
import { useMedicalRecordTemplates } from '../hooks/useMedicalRecordTemplates';
import { usePatientAppointments } from '../hooks/queries/usePatientAppointments';
import { usePatientDetail } from '../hooks/queries/usePatientDetail';
import { useAuth } from '../hooks/useAuth';
import { useModal } from '../contexts/ModalContext';
import {
    isStructuredError,
    selectDefaultAppointment
} from '../utils/medicalRecordUtils';
import { getErrorMessage } from '../types/api';
import { logger } from '../utils/logger';
import { formatDateOnly, formatAppointmentTimeRange } from '../utils/calendarUtils';
import { NO_TEMPLATE_SELECTED } from '../constants/medicalRecords';
import { SendPatientFormRequest } from '../types/medicalRecord';

/**
 * TODO: #PF-E2E - Implement E2E tests for the full patient form flow.
 * Tracked in design doc and deferred to follow-up PR.
 */

interface SendPatientFormDialogProps {
    patientId: number;
    onClose: () => void;
    onSuccess: (recordId: number) => void;
    defaultAppointmentId?: number;
}

const schema = z.object({
    template_id: z.number().min(1, '請選擇模板'),
    appointment_id: z.number().nullable().optional(),
    message_override: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

// --- Sub-components ---

const UnlinkedPatientAlert: React.FC = () => (
    <div className="text-center py-8" role="alert">
        <div className="mb-4 text-yellow-500">
            <svg className="w-16 h-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="mt-4 text-lg font-medium text-gray-900">病患尚未連結 Line 帳號</p>
            <p className="mt-2 text-sm text-gray-500">
                無法發送 Line 表單。請先協助病患掃描診所 QR Code 並完成 Line 帳號連結。
            </p>
        </div>
    </div>
);

const EmptyTemplatesAlert: React.FC<{ isAdmin: boolean; onClose: () => void }> = ({ isAdmin, onClose }) => (
    <div className="text-center py-8" role="alert">
        <div className="mb-4 text-gray-500">
            <svg className="w-12 h-12 mx-auto text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="mt-2 text-lg font-medium text-gray-900">尚無開放病患填寫的模板</p>
            <p className="mt-1 text-sm text-gray-500">請先在模板設定中開啟「開放病患填寫」選項。</p>
        </div>
        {isAdmin && (
            <Link
                to="/admin/clinic/settings/medical-record-templates"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                onClick={onClose}
            >
                前往設定頁面
            </Link>
        )}
    </div>
);

const TemplateSelector: React.FC<{ templates: any[]; firstFieldRef: React.RefObject<HTMLSelectElement> }> = ({ templates, firstFieldRef }) => {
    const { register } = useFormContext<FormData>();
    return (
        <FormField
            name="template_id"
            label={<>選擇表單模板 <span className="text-red-500" aria-hidden="true">*</span></>}
        >
            <select
                {...register('template_id', { valueAsNumber: true })}
                ref={(e) => {
                    register('template_id').ref(e);
                    if (firstFieldRef) (firstFieldRef.current as any) = e;
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                aria-required="true"
            >
                <option value={NO_TEMPLATE_SELECTED}>請選擇模板...</option>
                {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                ))}
            </select>
        </FormField>
    );
};

const AppointmentSelector: React.FC<{ appointments: any[]; setHasUserInteracted: (val: boolean) => void }> = ({ appointments, setHasUserInteracted }) => {
    const { register } = useFormContext<FormData>();
    return (
        <FormField name="appointment_id" label="關聯預約 (選填)">
            <select
                {...register('appointment_id', {
                    setValueAs: (v) => !v ? null : parseInt(v),
                    onChange: () => setHasUserInteracted(true)
                })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
                <option value="">無關聯預約</option>
                {appointments
                    ?.filter((apt) => apt.status === 'confirmed')
                    .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
                    .map((apt) => {
                        const aptId = apt.calendar_event_id || apt.id;
                        const startDate = new Date(apt.start_time);
                        const timeStr = formatAppointmentTimeRange(startDate, new Date(apt.end_time));
                        const isToday = formatDateOnly(startDate.toISOString()) === formatDateOnly(new Date().toISOString());
                        return (
                            <option key={aptId} value={aptId}>
                                {isToday ? '[今] ' : ''}{timeStr} - {apt.appointment_type_name || '預約'}
                            </option>
                        );
                    })}
            </select>
        </FormField>
    );
};

// --- Main Component ---

/**
 * Dialog for sending a medical record form to a patient via Line.
 * 
 * This component allows clinic staff to send medical record templates (marked as
 * is_patient_form=true) to patients for completion. Examples include intake forms,
 * health questionnaires, and pre-visit assessments.
 * 
 * Note: This is distinct from the PatientProfileForm component, which is used for
 * patient registration/profile creation in LIFF.
 * 
 * Filters templates to only show those marked as patient forms.
 */
export const SendPatientFormDialog: React.FC<SendPatientFormDialogProps> = ({
    patientId,
    onClose,
    onSuccess,
    defaultAppointmentId,
}) => {
    const { user, hasRole } = useAuth();
    const { alert: showAlert, confirm: showConfirm } = useModal();
    const isAdmin = hasRole?.('admin');
    const firstFieldRef = useRef<HTMLSelectElement>(null);

    const { data: templates, isLoading: loadingTemplates } = useMedicalRecordTemplates(user?.active_clinic_id ?? null);
    const { data: patient, isLoading: loadingPatient } = usePatientDetail(patientId);
    // Fetch recent appointments for selection
    const { data: appointments, isLoading: loadingAppointments } = usePatientAppointments(
        patientId,
        { enabled: true }
    );
    const sendMutation = useSendPatientForm(user?.active_clinic_id!, patientId);

    const [hasUserInteracted, setHasUserInteracted] = useState(false);
    const hasAppliedDefault = useRef(false);

    // Filter templates to only show patient forms
    const patientFormTemplates = useMemo(() => {
        return (templates ?? []).filter(t => t.is_patient_form);
    }, [templates]);

    // Calculate smart default appointment using utility
    const defaultAppointmentValue = useMemo(() => {
        return selectDefaultAppointment(appointments?.appointments, defaultAppointmentId);
    }, [defaultAppointmentId, appointments?.appointments]);

    const methods = useForm<FormData>({
        resolver: zodResolver(schema),
        defaultValues: {
            template_id: NO_TEMPLATE_SELECTED,
            appointment_id: null,
            message_override: '',
        },
    });

    const templateId = methods.watch('template_id');

    // Sync smart default appointment when data loads, unless user has interacted
    // This prevents overriding user selections if they change the field before
    // the default is applied, or if the appointments data refetches later.
    // hasAppliedDefault ensures the default is only applied automatically ONCE.
    useEffect(() => {
        if (!hasAppliedDefault.current && defaultAppointmentValue !== null && !hasUserInteracted) {
            methods.setValue('appointment_id', defaultAppointmentValue);
            hasAppliedDefault.current = true;
        }
    }, [defaultAppointmentValue, hasUserInteracted, methods]);

    // Initial focus
    useEffect(() => {
        if (!loadingTemplates && !loadingPatient && firstFieldRef.current) {
            firstFieldRef.current.focus();
        }
    }, [loadingTemplates, loadingPatient]);

    const handleClose = useCallback(() => {
        methods.reset();
        setHasUserInteracted(false);
        onClose();
    }, [methods, onClose]);

    const onSubmit = async (data: FormData) => {
        // Defensive check - should never happen due to Zod validation and button disable
        if (!data.template_id || data.template_id === NO_TEMPLATE_SELECTED) {
            await showAlert('請選擇表單模板', '驗證錯誤');
            return;
        }

        const confirmed = await showConfirm('確定要發送此表單連結給病患嗎？', '確認發送');
        if (!confirmed) return;

        try {
            const sendData: SendPatientFormRequest = {
                template_id: data.template_id,
                ...(data.appointment_id ? { appointment_id: data.appointment_id } : {}),
                ...(data.message_override ? { message_override: data.message_override } : {}),
            };

            const newRecord = await sendMutation.mutateAsync(sendData);
            await showAlert('表單已成功發送至病患 Line', '發送成功');
            onSuccess(newRecord.id);
            onClose();
        } catch (error: any) {
            logger.error('Failed to send patient form:', error);
            const errorData = error?.response?.data;
            const detail = errorData?.detail;

            if (isStructuredError(detail)) {
                const errorCode = detail.error_code;
                if (errorCode === 'PATIENT_NOT_LINKED') {
                    await showAlert('此病患尚未連結 Line 帳號，請先協助病患完成 Line 綁定。', '發送失敗');
                } else if (errorCode === 'LIFF_NOT_CONFIGURED') {
                    await showAlert('診所尚未完成 LIFF 設定，請聯繫系統管理員。', '系統錯誤');
                } else if (errorCode === 'LINE_SEND_FAILED') {
                    await showAlert('Line 訊息發送失敗，請稍後再試。', '發送失敗');
                } else if (errorCode === 'TEMPLATE_NOT_PATIENT_FORM') {
                    await showAlert('所選模板不符合病患填寫規範。', '發送失敗');
                } else if (errorCode === 'PATIENT_NOT_FOUND') {
                    await showAlert('找不到此病患資料。', '發送失敗');
                } else if (errorCode === 'TEMPLATE_NOT_FOUND') {
                    await showAlert('找不到此表單模板。', '發送失敗');
                } else if (errorCode === 'CLINIC_NOT_FOUND') {
                    await showAlert('診所資料異常，請聯繫系統管理員。', '系統錯誤');
                } else if (errorCode === 'LINE_USER_NOT_FOUND') {
                    await showAlert('Line 用戶資料異常，請重新綁定。', '發送失敗');
                } else {
                    await showAlert(detail.message || getErrorMessage(error), '發送失敗');
                }
            } else {
                await showAlert(getErrorMessage(error), '發送失敗');
            }
        }
    };

    const isSaving = sendMutation.isPending;
    const isLoading = loadingTemplates || loadingPatient || loadingAppointments;

    return (
        <BaseModal
            onClose={handleClose}
            aria-labelledby="dialog-title"
        >
            <FormProvider {...methods}>
                <form
                    onSubmit={methods.handleSubmit(onSubmit)}
                    className="flex flex-col flex-1 min-h-0"
                    aria-describedby="dialog-description"
                    noValidate
                >
                    <ModalHeader title={<span id="dialog-title">發送病患表單</span>} onClose={handleClose} showClose />

                    <ModalBody>
                        <div role="status" aria-live="polite" className="sr-only">
                            {isLoading && '正在載入表單資料...'}
                            {!isLoading && patientFormTemplates.length > 0 && '表單模板已載入'}
                            {loadingAppointments && '正在載入預約資料...'}
                            {!loadingAppointments && appointments && '預約資料已載入'}
                            {isSaving && '正在發送表單，請稍候...'}
                            {sendMutation.isError && '發送表單失敗，請查看錯誤訊息'}
                            {sendMutation.isSuccess && '表單已成功發送'}
                        </div>

                        <div id="dialog-description" className="sr-only">
                            選擇要發送給病患的表單模板。系統將會建立一筆空的病歷記錄，並透過 Line 發送填寫連結給病患。
                        </div>

                        {isLoading ? (
                            <div className="flex justify-center items-center py-12" aria-busy="true" aria-label="載入中">
                                <LoadingSpinner size="lg" />
                            </div>
                        ) : !patient?.line_user_id ? (
                            <UnlinkedPatientAlert />
                        ) : !patientFormTemplates || patientFormTemplates.length === 0 ? (
                            <EmptyTemplatesAlert isAdmin={isAdmin ?? false} onClose={handleClose} />
                        ) : (
                            <div className="space-y-6">
                                <p className="text-sm text-gray-500">
                                    選擇要發送給病患的表單模板。系統將會建立一筆空的病歷記錄，並透過 Line 發送填寫連結給病患。
                                </p>

                                <TemplateSelector templates={patientFormTemplates} firstFieldRef={firstFieldRef} />

                                <AppointmentSelector
                                    appointments={appointments?.appointments || []}
                                    setHasUserInteracted={setHasUserInteracted}
                                />

                                <FormField name="message_override" label="自訂訊息 (選填)">
                                    <textarea
                                        {...methods.register('message_override')}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                        placeholder="輸入要併同表單連結發送的額外說明訊息..."
                                        rows={3}
                                    />
                                </FormField>
                            </div>
                        )}
                    </ModalBody>

                    <ModalFooter>
                        <button
                            type="button"
                            onClick={handleClose}
                            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                            disabled={isSaving}
                        >
                            取消
                        </button>
                        {patient?.line_user_id && patientFormTemplates && patientFormTemplates.length > 0 && (
                            <button
                                type="submit"
                                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                disabled={isSaving || templateId === NO_TEMPLATE_SELECTED}
                                aria-busy={isSaving}
                            >
                                {isSaving && <LoadingSpinner size="sm" aria-label="發送中" />}
                                {isSaving ? '發送中...' : '確認發送'}
                            </button>
                        )}
                    </ModalFooter>
                </form>
            </FormProvider>
        </BaseModal>
    );
};

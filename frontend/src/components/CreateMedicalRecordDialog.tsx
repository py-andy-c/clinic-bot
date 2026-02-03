import React, { useMemo, useEffect } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BaseModal } from './shared/BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from './shared/ModalParts';
import { LoadingSpinner } from './shared';
import { FormField } from './forms';
import { useCreateMedicalRecord } from '../hooks/useMedicalRecords';
import { useMedicalRecordTemplates } from '../hooks/useMedicalRecordTemplates';
import { usePatientAppointments } from '../hooks/queries/usePatientAppointments';
import { useAuth } from '../hooks/useAuth';
import { useModal } from '../contexts/ModalContext';
import { getErrorMessage } from '../types/api';
import { logger } from '../utils/logger';
import { formatDateOnly, formatAppointmentTimeRange } from '../utils/calendarUtils';

interface CreateMedicalRecordDialogProps {
  patientId: number;
  onClose: () => void;
  onSuccess: (recordId: number) => void;
  defaultAppointmentId?: number;
}

const schema = z.object({
  template_id: z.number().min(1, '請選擇模板'),
  appointment_id: z.number().nullable().optional(),
});

type FormData = z.infer<typeof schema>;

/**
 * Small initialization dialog for creating a new medical record.
 * Only collects template and optional appointment - no field values.
 * After creation, navigates to the full-page editor.
 */
export const CreateMedicalRecordDialog: React.FC<CreateMedicalRecordDialogProps> = ({
  patientId,
  onClose,
  onSuccess,
  defaultAppointmentId,
}) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const { alert } = useModal();

  const { data: templates, isLoading: loadingTemplates } = useMedicalRecordTemplates(activeClinicId ?? null);
  const { data: appointments } = usePatientAppointments(patientId);
  const createMutation = useCreateMedicalRecord(activeClinicId ?? null, patientId);

  // Calculate smart default appointment
  const defaultAppointmentValue = useMemo(() => {
    if (defaultAppointmentId) return defaultAppointmentId;

    if (!appointments?.appointments) return null;

    const confirmedApps = appointments.appointments.filter(a => a.status === 'confirmed');
    if (confirmedApps.length === 0) return null;

    // Sort chronologically (Past -> Future)
    const sortedApps = [...confirmedApps].sort((a, b) =>
      new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

    const now = new Date();
    const todayStr = formatDateOnly(now.toISOString());

    // Priority 1: Appointment on TODAY
    const todayApp = sortedApps.find(a => formatDateOnly(a.start_time) === todayStr);
    if (todayApp) return todayApp.calendar_event_id || todayApp.id;

    // Priority 2: Most recent PAST appointment
    const pastApps = sortedApps.filter(a => new Date(a.start_time) < now);
    if (pastApps.length > 0) {
      const lastPast = pastApps[pastApps.length - 1];
      if (lastPast) {
        return lastPast.calendar_event_id || lastPast.id;
      }
    }

    // Fallback: No selection
    return null;
  }, [defaultAppointmentId, appointments?.appointments]);

  const methods = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      template_id: 0,
      appointment_id: null,
    },
  });

  // Sync smart default appointment when data loads
  useEffect(() => {
    if (defaultAppointmentValue !== null && !methods.formState.isDirty) {
      methods.setValue('appointment_id', defaultAppointmentValue);
    }
  }, [defaultAppointmentValue, methods]);

  const onSubmit = async (data: FormData) => {
    try {
      const createData: {
        template_id: number;
        values: Record<string, any>;
        appointment_id?: number;
      } = {
        template_id: data.template_id,
        values: {}, // Empty values - will be filled in the editor
      };

      if (data.appointment_id) {
        createData.appointment_id = data.appointment_id;
      }

      const newRecord = await createMutation.mutateAsync(createData);
      onSuccess(newRecord.id);
    } catch (error) {
      logger.error('Failed to create medical record:', error);
      await alert(getErrorMessage(error), '建立失敗');
    }
  };

  const isSaving = createMutation.isPending;

  return (
    <BaseModal onClose={onClose}>
      <FormProvider {...methods}>
        <form onSubmit={methods.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
          <ModalHeader title="新增病歷記錄" onClose={onClose} />

          <ModalBody>
            {loadingTemplates ? (
              <div className="flex justify-center items-center py-12">
                <LoadingSpinner size="lg" />
              </div>
            ) : (
              <div className="space-y-6">
                {/* Template Selector */}
                <FormField name="template_id" label="病歷模板 *">
                  <select
                    {...methods.register('template_id', { valueAsNumber: true })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value={0}>請選擇模板...</option>
                    {templates?.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </FormField>

                {/* Appointment Selector (Optional) */}
                <FormField name="appointment_id" label="關聯預約 (選填)">
                  <select
                    {...methods.register('appointment_id', {
                      setValueAs: (v) => v === '' ? null : parseInt(v)
                    })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="">無關聯預約</option>
                    {appointments?.appointments
                      ?.filter((apt) => apt.status === 'confirmed')
                      .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
                      .map((apt) => {
                        const aptId = apt.calendar_event_id || apt.id;
                        const startDate = new Date(apt.start_time);
                        const endDate = new Date(apt.end_time);
                        const timeStr = formatAppointmentTimeRange(startDate, endDate);
                        const serviceName = apt.appointment_type_name || '預約';

                        const now = new Date();
                        const isToday = formatDateOnly(startDate) === formatDateOnly(now);
                        const prefix = isToday ? '[今] ' : '';

                        return (
                          <option key={aptId} value={aptId}>
                            {prefix}{timeStr} - {serviceName}
                          </option>
                        );
                      })}
                  </select>
                </FormField>
              </div>
            )}
          </ModalBody>

          <ModalFooter>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              disabled={isSaving}
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isSaving || methods.watch('template_id') === 0}
            >
              {isSaving ? '建立中...' : '建立'}
            </button>
          </ModalFooter>
        </form>
      </FormProvider>
    </BaseModal>
  );
};

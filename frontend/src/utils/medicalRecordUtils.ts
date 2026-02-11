import { MedicalRecord, TemplateField } from '../types/medicalRecord';
import { formatDateOnly } from './calendarUtils';
import { z } from 'zod';

/**
 * Checks if a medical record is empty (no values or all values are empty)
 * 
 * @param record - The medical record to check
 * @returns true if the record has no values or all values are empty
 */
export const isMedicalRecordEmpty = (record: MedicalRecord): boolean => {
    if (!record.values || Object.keys(record.values).length === 0) {
        return true;
    }
    return Object.values(record.values).every(
        (v) => v === '' || v === null || v === undefined
    );
};

export type MedicalRecordStatusColor = 'green' | 'yellow' | 'gray' | 'blue';

export interface MedicalRecordStatus {
    label: string;
    color: MedicalRecordStatusColor;
    className: string;
    ariaLabel: string;
}

export interface AppointmentSelectionItem {
    id: number;
    calendar_event_id?: number;
    status: string;
    start_time: string;
    end_time: string;
    appointment_type_name?: string;
}

export interface StructuredError {
    error_code: string;
    message: string;
}

/**
 * Type guard for backend structured error responses.
 * @param detail - The error detail to check
 * @returns true if detail is a StructuredError
 */
export function isStructuredError(detail: any): detail is StructuredError {
    return detail && typeof detail === 'object' && 'error_code' in detail;
}

/**
 * Gets the status label and color for a medical record badge.
 * 
 * Priority (Highest to Lowest):
 * 1. Submitted (is_submitted=true) - Patient completed the form
 * 2. Patient editing (patient_last_edited_at exists) - Patient started filling
 * 3. Empty (no values) - Record created but not filled
 * 4. Clinic created (default) - Created by clinic staff
 * 
 * @param record - The medical record to get status for
 * @returns An object containing the label, color type, and CSS classes
 */
export const getMedicalRecordStatus = (record: MedicalRecord): MedicalRecordStatus => {
    const statuses: Record<'submitted' | 'editing' | 'empty' | 'clinic', MedicalRecordStatus> = {
        submitted: {
            label: '病患已提交',
            color: 'green',
            className: 'bg-green-100 text-green-600',
            ariaLabel: '病歷狀態: 病患已提交'
        },
        editing: {
            label: '病患填寫中',
            color: 'yellow',
            className: 'bg-yellow-100 text-yellow-600',
            ariaLabel: '病歷狀態: 病患填寫中'
        },
        empty: {
            label: '空',
            color: 'gray',
            className: 'bg-gray-100 text-gray-500',
            ariaLabel: '病歷狀態: 空'
        },
        clinic: {
            label: '診所建立',
            color: 'blue',
            className: 'bg-blue-50 text-blue-600',
            ariaLabel: '病歷狀態: 診所建立'
        }
    };

    if (record.is_submitted) {
        return statuses.submitted;
    }

    if (record.patient_last_edited_at) {
        return statuses.editing;
    }

    if (isMedicalRecordEmpty(record)) {
        return statuses.empty;
    }

    return statuses.clinic;
};

/**
 * Selects a default appointment from a list based on priority.
 * 
 * Priority:
 * 1. Explicitly provided defaultAppointmentId
 * 2. An appointment occurring TODAY
 * 3. The most recent PAST appointment
 * 4. The closest FUTURE appointment
 * 
 * @param appointments - List of appointments to search from
 * @param defaultAppointmentId - Optional explicit ID to prefer
 * @returns The ID of the selected appointment, or null if none found
 */
export const selectDefaultAppointment = (
    appointments: AppointmentSelectionItem[] | undefined,
    defaultAppointmentId?: number
): number | null => {
    if (defaultAppointmentId) return defaultAppointmentId;
    if (!appointments || appointments.length === 0) return null;

    const confirmedApps = appointments.filter(a => a.status === 'confirmed');
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
        if (lastPast) return lastPast.calendar_event_id || lastPast.id;
    }

    // Priority 3: Closest FUTURE appointment
    const futureApps = sortedApps.filter(a => new Date(a.start_time) >= now);
    if (futureApps.length > 0) {
        const nextFuture = futureApps[0];
        if (nextFuture) return nextFuture.calendar_event_id || nextFuture.id;
    }

    return null;
};

/**
 * Generate dynamic Zod schema based on template fields.
 * Validates medical record values based on their field types.
 * 
 * @param fields - The template fields to generate schema for
 * @returns A Zod schema for the values object
 */
export const createMedicalRecordDynamicSchema = (
    fields: TemplateField[] | undefined
): z.ZodObject<any> | z.ZodRecord<z.ZodString, z.ZodAny> => {
    if (!fields || fields.length === 0) {
        return z.record(z.any());
    }

    const valuesShape: Record<string, z.ZodTypeAny> = {};
    fields.forEach((field) => {
        const fieldId = field.id;
        let fieldSchema: z.ZodTypeAny;

        switch (field.type) {
            case 'text':
            case 'textarea':
            case 'dropdown':
            case 'radio':
            case 'date':
                fieldSchema = z.string()
                    .transform(val => (val === '' ? null : val))
                    .nullable()
                    .optional();
                break;
            case 'number':
                fieldSchema = z.union([
                    z.number(),
                    z.string().transform(val => val === '' ? undefined : Number(val)),
                    z.null()
                ]).optional();
                break;
            case 'checkbox':
                fieldSchema = z.preprocess(
                    (val) => {
                        if (Array.isArray(val)) return val;
                        if (val === null || val === undefined) return [];
                        if (typeof val === 'boolean') return [];
                        return [String(val)];
                    },
                    z.array(z.string())
                ).optional();
                break;
            default:
                fieldSchema = z.any().optional();
        }
        valuesShape[fieldId] = fieldSchema;
    });

    return z.object(valuesShape);
};

import { describe, it, expect, vi } from 'vitest';
import {
    isMedicalRecordEmpty,
    getMedicalRecordStatus,
    selectDefaultAppointment
} from '../medicalRecordUtils';
import { MedicalRecord } from '../../types/medicalRecord';

describe('medicalRecordUtils', () => {
    describe('isMedicalRecordEmpty', () => {
        it('should return true for null or missing values', () => {
            const record = { values: {} } as MedicalRecord;
            expect(isMedicalRecordEmpty(record)).toBe(true);

            const recordNoValues = {} as MedicalRecord;
            expect(isMedicalRecordEmpty(recordNoValues)).toBe(true);
        });

        it('should return true for empty strings and nulls', () => {
            const record = {
                values: { field1: '', field2: null, field3: undefined }
            } as any;
            expect(isMedicalRecordEmpty(record)).toBe(true);
        });

        it('should return false if any field is filled', () => {
            const record = {
                values: { field1: '', field2: 'some value' }
            } as any;
            expect(isMedicalRecordEmpty(record)).toBe(false);

            const recordZero = { values: { field1: 0 } } as any;
            expect(isMedicalRecordEmpty(recordZero)).toBe(false);
        });
    });

    describe('getMedicalRecordStatus', () => {
        it('should return "submitted" status if is_submitted is true', () => {
            const record = { is_submitted: true } as MedicalRecord;
            const status = getMedicalRecordStatus(record);
            expect(status.label).toBe('病患已提交');
            expect(status.color).toBe('green');
        });

        it('should return "editing" status if patient_last_edited_at exists', () => {
            const record = {
                is_submitted: false,
                patient_last_edited_at: '2026-01-01T00:00:00Z'
            } as MedicalRecord;
            const status = getMedicalRecordStatus(record);
            expect(status.label).toBe('病患填寫中');
            expect(status.color).toBe('yellow');
        });

        it('should return "empty" status if record is empty', () => {
            const record = {
                is_submitted: false,
                patient_last_edited_at: null,
                values: {}
            } as MedicalRecord;
            const status = getMedicalRecordStatus(record);
            expect(status.label).toBe('空');
            expect(status.color).toBe('gray');
        });

        it('should return "clinic" status as default', () => {
            const record = {
                is_submitted: false,
                patient_last_edited_at: null,
                values: { field: 'value' }
            } as MedicalRecord;
            const status = getMedicalRecordStatus(record);
            expect(status.label).toBe('診所建立');
            expect(status.color).toBe('blue');
        });

        it('should respect priority order', () => {
            // Submitted > Editing
            const record1 = {
                is_submitted: true,
                patient_last_edited_at: '2026-01-01T00:00:00Z'
            } as MedicalRecord;
            expect(getMedicalRecordStatus(record1).label).toBe('病患已提交');

            // Editing > Empty
            const record2 = {
                is_submitted: false,
                patient_last_edited_at: '2026-01-01T00:00:00Z',
                values: {}
            } as MedicalRecord;
            expect(getMedicalRecordStatus(record2).label).toBe('病患填寫中');
        });
    });

    describe('selectDefaultAppointment', () => {
        const mockAppointments = [
            { id: 1, status: 'confirmed', start_time: '2026-02-10T10:00:00Z', end_time: '2026-02-10T11:00:00Z' },
            { id: 2, status: 'confirmed', start_time: '2026-02-10T14:00:00Z', end_time: '2026-02-10T15:00:00Z' },
            { id: 3, status: 'confirmed', start_time: '2026-02-09T10:00:00Z', end_time: '2026-02-09T11:00:00Z' },
            { id: 4, status: 'confirmed', start_time: '2026-02-11T10:00:00Z', end_time: '2026-02-11T11:00:00Z' },
            { id: 5, status: 'cancelled', start_time: '2026-02-10T12:00:00Z', end_time: '2026-02-10T13:00:00Z' },
        ];

        beforeEach(() => {
            vi.useFakeTimers();
            // Set "now" to 2026-02-10 12:00:00
            vi.setSystemTime(new Date('2026-02-10T12:00:00Z'));
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should return explicit defaultAppointmentId if provided', () => {
            // Even if ID 99 is not in the list, the current implementation returns it.
            // This is "correct" based on the function contract (it trusts the caller).
            expect(selectDefaultAppointment(mockAppointments, 99)).toBe(99);
        });

        it('should return null if no confirmed appointments', () => {
            expect(selectDefaultAppointment([], undefined)).toBe(null);
            expect(selectDefaultAppointment([{ status: 'pending' }] as any, undefined)).toBe(null);
        });

        it('should prioritize TODAY appointment (earliest today)', () => {
            // Should pick id 1 or 2. id 1 is earlier today (10:00) vs id 2 (14:00).
            const selected = selectDefaultAppointment(mockAppointments);
            expect(selected).toBe(1);
        });

        it('should handle multiple appointments on the same day correctly', () => {
            // If we have two appointments today, it picks the first one found in the sorted list.
            // The list is sorted by start_time.
            const sameDayApps = [
                { id: 101, status: 'confirmed', start_time: '2026-02-10T09:00:00Z', end_time: '2026-02-10T09:30:00Z' },
                { id: 102, status: 'confirmed', start_time: '2026-02-10T10:00:00Z', end_time: '2026-02-10T10:30:00Z' }
            ];
            expect(selectDefaultAppointment(sameDayApps)).toBe(101);
        });

        it('should handle appointment exactly at midnight', () => {
            // Midnight today is still today.
            const midnightApp = [
                { id: 200, status: 'confirmed', start_time: '2026-02-10T00:00:00Z', end_time: '2026-02-10T01:00:00Z' }
            ];
            expect(selectDefaultAppointment(midnightApp)).toBe(200);
        });

        it('should pick most recent PAST appointment if no TODAY appointment', () => {
            const onlyPast = [
                { id: 10, status: 'confirmed', start_time: '2026-02-01T10:00:00Z', end_time: '2026-02-01T11:00:00Z' },
                { id: 11, status: 'confirmed', start_time: '2026-02-05T10:00:00Z', end_time: '2026-02-05T11:00:00Z' }
            ];
            expect(selectDefaultAppointment(onlyPast)).toBe(11);
        });

        it('should pick closest FUTURE appointment if no PAST/TODAY appointments', () => {
            const onlyFuture = [
                { id: 20, status: 'confirmed', start_time: '2026-02-11T10:00:00Z', end_time: '2026-02-11T11:00:00Z' },
                { id: 21, status: 'confirmed', start_time: '2026-02-20T10:00:00Z', end_time: '2026-02-20T11:00:00Z' }
            ];
            expect(selectDefaultAppointment(onlyFuture)).toBe(20);
        });
    });
});

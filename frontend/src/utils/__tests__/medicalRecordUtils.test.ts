import { describe, it, expect, vi } from 'vitest';
import {
    isMedicalRecordEmpty,
    getMedicalRecordStatus,
    selectDefaultAppointment,
    createMedicalRecordDynamicSchema
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
        it('should return "待填寫" for new patient forms', () => {
            const record = {
                template_snapshot: {},
                is_patient_form: true,
                patient_last_edited_at: null
            } as any;
            const status = getMedicalRecordStatus(record);
            expect(status.label).toBe('待填寫');
            expect(status.color).toBe('yellow');
        });

        it('should return "病患已填寫" for edited patient forms', () => {
            const record = {
                template_snapshot: {},
                is_patient_form: true,
                patient_last_edited_at: '2026-01-01T00:00:00Z'
            } as any;
            const status = getMedicalRecordStatus(record);
            expect(status!.label).toBe('病患已填寫');
            expect(status!.color).toBe('green');
        });

        it('should return "空" status if internal record is empty', () => {
            const record = {
                template_snapshot: {},
                is_patient_form: false,
                patient_last_edited_at: null,
                values: {}
            } as any;
            const status = getMedicalRecordStatus(record);
            expect(status.label).toBe('空');
            expect(status.color).toBe('gray');
        });

        it('should return null as default for internal records', () => {
            const record = {
                template_snapshot: {},
                is_patient_form: false,
                patient_last_edited_at: null,
                values: { field: 'value' }
            } as any;
            const status = getMedicalRecordStatus(record);
            expect(status).toBe(null);
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
        describe('createMedicalRecordDynamicSchema', () => {
            it('should return a record schema when no fields provided', () => {
                const schema = createMedicalRecordDynamicSchema(undefined);
                const result = schema.safeParse({ q1: 'test' });
                expect(result.success).toBe(true);
            });

            it('should validate text fields', () => {
                const fields = [{ id: 'q1', type: 'text', label: 'Q1' }] as any;
                const schema = createMedicalRecordDynamicSchema(fields);

                expect(schema.safeParse({ q1: 'hello' }).success).toBe(true);
                expect(schema.safeParse({ q1: null }).success).toBe(true);
                expect(schema.safeParse({ q1: '' }).data.q1).toBe(null);
            });

            it('should validate number fields', () => {
                const fields = [{ id: 'q1', type: 'number', label: 'Q1' }] as any;
                const schema = createMedicalRecordDynamicSchema(fields);

                expect(schema.safeParse({ q1: 123 }).success).toBe(true);
                expect(schema.safeParse({ q1: '123' }).data.q1).toBe(123);
                expect(schema.safeParse({ q1: '' }).data.q1).toBe(undefined);
            });

            it('should validate checkbox fields', () => {
                const fields = [{ id: 'q1', type: 'checkbox', label: 'Q1' }] as any;
                const schema = createMedicalRecordDynamicSchema(fields);

                expect(schema.safeParse({ q1: ['a', 'b'] }).success).toBe(true);
                expect(schema.safeParse({ q1: 'a' }).data.q1).toEqual(['a']);
                expect(schema.safeParse({ q1: null }).data.q1).toEqual([]);
            });

            describe('with enforceRequired=true', () => {
                it('should enforce required text fields', () => {
                    const fields = [{ id: 'q1', type: 'text', label: 'Question 1', required: true }] as any;
                    const schema = createMedicalRecordDynamicSchema(fields, true);

                    expect(schema.safeParse({ q1: 'hello' }).success).toBe(true);
                    const emptyResult = schema.safeParse({ q1: '' });
                    expect(emptyResult.success).toBe(false);
                    if (!emptyResult.success) {
                        expect(emptyResult.error.issues[0].message).toBe('此為必填欄位');
                    }
                });

                it('should enforce required number fields', () => {
                    const fields = [{ id: 'q1', type: 'number', label: 'Question 1', required: true }] as any;
                    const schema = createMedicalRecordDynamicSchema(fields, true);

                    expect(schema.safeParse({ q1: 123 }).success).toBe(true);
                    expect(schema.safeParse({ q1: '123' }).success).toBe(true);
                    expect(schema.safeParse({ q1: '' }).success).toBe(false);
                    expect(schema.safeParse({ q1: null }).success).toBe(false);
                    expect(schema.safeParse({ q1: undefined }).success).toBe(false);
                });

                it('should handle number field with zero value', () => {
                    const fields = [{ id: 'q1', type: 'number', label: 'Question 1', required: true }] as any;
                    const schema = createMedicalRecordDynamicSchema(fields, true);

                    // Zero is a valid number
                    expect(schema.safeParse({ q1: 0 }).success).toBe(true);
                    expect(schema.safeParse({ q1: '0' }).success).toBe(true);
                });

                it('should enforce required checkbox fields', () => {
                    const fields = [{ id: 'q1', type: 'checkbox', label: 'Question 1', required: true }] as any;
                    const schema = createMedicalRecordDynamicSchema(fields, true);

                    expect(schema.safeParse({ q1: ['a'] }).success).toBe(true);
                    const emptyResult = schema.safeParse({ q1: [] });
                    expect(emptyResult.success).toBe(false);
                    if (!emptyResult.success) {
                        expect(emptyResult.error.issues[0].message).toBe('此為必填欄位');
                    }
                });

                it('should enforce required dropdown fields', () => {
                    const fields = [{ id: 'q1', type: 'dropdown', label: 'Question 1', required: true }] as any;
                    const schema = createMedicalRecordDynamicSchema(fields, true);

                    expect(schema.safeParse({ q1: 'option1' }).success).toBe(true);
                    expect(schema.safeParse({ q1: '' }).success).toBe(false);
                });

                it('should enforce required radio fields', () => {
                    const fields = [{ id: 'q1', type: 'radio', label: 'Question 1', required: true }] as any;
                    const schema = createMedicalRecordDynamicSchema(fields, true);

                    expect(schema.safeParse({ q1: 'option1' }).success).toBe(true);
                    expect(schema.safeParse({ q1: '' }).success).toBe(false);
                });

                it('should enforce required date fields', () => {
                    const fields = [{ id: 'q1', type: 'date', label: 'Question 1', required: true }] as any;
                    const schema = createMedicalRecordDynamicSchema(fields, true);

                    expect(schema.safeParse({ q1: '2024-01-01' }).success).toBe(true);
                    expect(schema.safeParse({ q1: '' }).success).toBe(false);
                });

                it('should not enforce non-required fields', () => {
                    const fields = [{ id: 'q1', type: 'text', label: 'Question 1', required: false }] as any;
                    const schema = createMedicalRecordDynamicSchema(fields, true);

                    expect(schema.safeParse({ q1: '' }).success).toBe(true);
                    expect(schema.safeParse({ q1: null }).success).toBe(true);
                });

                it('should handle mixed required and optional fields', () => {
                    const fields = [
                        { id: 'q1', type: 'text', label: 'Question 1', required: true },
                        { id: 'q2', type: 'text', label: 'Question 2', required: false },
                        { id: 'q3', type: 'number', label: 'Question 3', required: true }
                    ] as any;
                    const schema = createMedicalRecordDynamicSchema(fields, true);

                    // All required fields filled, optional empty - should pass
                    expect(schema.safeParse({ q1: 'answer', q2: '', q3: 42 }).success).toBe(true);
                    
                    // Missing required field - should fail
                    expect(schema.safeParse({ q1: '', q2: 'answer', q3: 42 }).success).toBe(false);
                    expect(schema.safeParse({ q1: 'answer', q2: '', q3: '' }).success).toBe(false);
                });
            });
        });
    });
});

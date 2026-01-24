import { renderHook } from '@testing-library/react';
import { useAppointmentForm, AppointmentFormMode } from '../useAppointmentForm';
import { describe, it, expect, vi } from 'vitest';
import moment from 'moment-timezone';

// Mock dependencies
vi.mock('../services/api', () => ({
    apiService: {
        getPractitioners: vi.fn(),
        getAvailableSlots: vi.fn(),
        checkPractitionerConflicts: vi.fn(),
    },
}));

const mockEvent = {
    id: 1,
    title: 'Test Event',
    start: new Date('2024-01-27T10:00:00.000+08:00'), // 10:00 AM Taipei time
    end: new Date('2024-01-27T11:00:00.000+08:00'),
    resource: {
        patient_id: 1,
        practitioner_id: 1,
        appointment_type_id: 1,
        clinic_notes: 'Notes',
        resource_ids: [],
    },
};

const defaultProps = {
    mode: 'create' as AppointmentFormMode,
    appointmentTypes: [],
    practitioners: [],
};

describe('useAppointmentForm state initialization', () => {
    it('should initialize time from preSelectedTime when provided (Scenario 1 & 3)', () => {
        const { result } = renderHook(() =>
            useAppointmentForm({
                ...defaultProps,
                preSelectedTime: '09:00',
                event: undefined,
            })
        );

        expect(result.current.selectedTime).toBe('09:00');
    });

    it('should initialize time from event when preSelectedTime is missing (Scenario 2: Edit)', () => {
        const { result } = renderHook(() =>
            useAppointmentForm({
                ...defaultProps,
                mode: 'edit',
                event: mockEvent as any,
                preSelectedTime: undefined,
            })
        );

        // Should default to event start time (10:00)
        expect(result.current.selectedTime).toBe('10:00');
    });

    it('should prioritize preSelectedTime over event time (Scenario 3: Duplicate with override)', () => {
        const { result } = renderHook(() =>
            useAppointmentForm({
                ...defaultProps,
                mode: 'duplicate',
                event: mockEvent as any,
                preSelectedTime: '14:00', // Explicit override
            })
        );

        expect(result.current.selectedTime).toBe('14:00');
    });

    it('should fall back to event time if preSelectedTime is missing in Duplicate mode (Scenario 3: Duplicate without override)', () => {
        // This confirms the "Unified Logic" also covers duplicate fallback
        const { result } = renderHook(() =>
            useAppointmentForm({
                ...defaultProps,
                mode: 'duplicate',
                event: mockEvent as any,
                preSelectedTime: undefined,
            })
        );

        expect(result.current.selectedTime).toBe('10:00');
    });

    it('should initialize empty time when neither is provided', () => {
        const { result } = renderHook(() =>
            useAppointmentForm({
                ...defaultProps,
                mode: 'create',
                event: undefined,
                preSelectedTime: undefined,
            })
        );

        expect(result.current.selectedTime).toBe('');
    });
});

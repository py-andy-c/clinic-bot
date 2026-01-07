/**
 * MSW Integration Tests
 *
 * These tests verify that MSW is properly configured and can intercept HTTP calls,
 * providing the foundation for integration testing.
 */

import { describe, it, expect } from 'vitest';

describe('MSW Integration Foundation', () => {
  it('MSW intercepts patients API with proper data structure', async () => {
    const response = await fetch('/api/patients');

    expect(response.ok).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty('data');
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.length).toBeGreaterThan(0);

    // Verify patient data structure matches frontend expectations
    const patient = data.data[0];
    expect(patient).toHaveProperty('id');
    expect(patient).toHaveProperty('full_name');
    expect(patient).toHaveProperty('email');
    expect(patient).toHaveProperty('phone');
    expect(patient).toHaveProperty('date_of_birth');
    expect(patient).toHaveProperty('gender');
  });

  it('MSW intercepts appointment creation with validation', async () => {
    const appointmentData = {
      patient_id: 1,
      appointment_type_id: 1,
      practitioner_id: 1,
      start_time: '2024-01-15T10:00:00Z',
      end_time: '2024-01-15T11:00:00Z',
      notes: 'Integration test appointment',
      clinic_notes: 'Created via MSW test'
    };

    const response = await fetch('/api/appointments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(appointmentData),
    });

    expect(response.ok).toBe(true);

    const data = await response.json();

    // Verify the response matches expected appointment structure
    expect(data).toHaveProperty('id');
    expect(data).toHaveProperty('patient_id', 1);
    expect(data).toHaveProperty('appointment_type_id', 1);
    expect(data).toHaveProperty('practitioner_id', 1);
    expect(data).toHaveProperty('status', 'confirmed');
    expect(data).toHaveProperty('notes', 'Integration test appointment');
    expect(data).toHaveProperty('clinic_notes', 'Created via MSW test');
    expect(data).toHaveProperty('created_at');
    expect(data).toHaveProperty('updated_at');
  });

  it('MSW handles appointment conflict checking', async () => {
    const conflictData = {
      start_time: '2024-01-15T10:00:00Z',
      end_time: '2024-01-15T11:00:00Z',
      practitioner_id: 1,
      appointment_type_id: 1
    };

    const response = await fetch('/api/appointments/check-conflicts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(conflictData),
    });

    expect(response.ok).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty('conflicts');
    expect(data).toHaveProperty('can_schedule');
    expect(data).toHaveProperty('message');
    expect(Array.isArray(data.conflicts)).toBe(true);
  });

  it('MSW validates required fields in appointment creation', async () => {
    // Test that MSW handlers properly validate input
    const invalidAppointmentData = {
      // Missing required fields
      notes: 'Missing required fields test'
    };

    const response = await fetch('/api/appointments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(invalidAppointmentData),
    });

    // MSW handler should return 400 for missing required fields
    expect(response.status).toBe(400);

    const errorData = await response.json();
    expect(errorData).toHaveProperty('error');
    expect(errorData).toHaveProperty('message');
  });

  it('MSW provides consistent mock data across test runs', async () => {
    // Test that the same endpoint returns consistent data
    const response1 = await fetch('/api/patients');
    const response2 = await fetch('/api/patients');

    expect(response1.ok).toBe(true);
    expect(response2.ok).toBe(true);

    const data1 = await response1.json();
    const data2 = await response2.json();

    // Data should be consistent across calls
    expect(data1.data.length).toBe(data2.data.length);
    expect(data1.data[0].id).toBe(data2.data[0].id);
    expect(data1.data[0].full_name).toBe(data2.data[0].full_name);
  });
});

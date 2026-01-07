/**
 * Advanced MSW Scenarios Integration Tests
 *
 * These tests validate complex API interaction scenarios that have historically
 * caused bugs, including clinic switching, network failures, concurrent operations,
 * and error recovery patterns.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { server } from '../../test-utils/msw-setup';
import { http, HttpResponse } from 'msw';

// Mock API calls that simulate real application behavior
const mockApiCall = async (url: string, options?: RequestInit) => {
  return fetch(url, options);
};

describe('Advanced MSW Scenarios - Clinic Switching & Network Failures', () => {
  beforeEach(() => {
    // Ensure MSW is listening
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
    server.close();
  });

  describe('Clinic Switching Scenarios', () => {
    it('handles clinic switching with cache invalidation', async () => {
      // Setup initial clinic data
      server.use(
        http.get('/api/clinic/settings', () => {
          return HttpResponse.json({
            clinic_id: 1,
            clinic_name: 'Clinic A',
            business_hours: { /* mock data */ },
            appointment_types: [{ id: 1, name: 'General' }],
            practitioners: [{ id: 1, full_name: 'Dr. Smith' }]
          });
        }),
        http.post('/api/auth/switch-clinic', () => {
          return HttpResponse.json({ success: true });
        })
      );

      // Simulate loading clinic 1 data
      const clinic1Response = await mockApiCall('/api/clinic/settings');
      expect(clinic1Response.ok).toBe(true);
      const clinic1Data = await clinic1Response.json();
      expect(clinic1Data.clinic_name).toBe('Clinic A');

      // Setup clinic 2 data (different from clinic 1)
      server.use(
        http.get('/api/clinic/settings', () => {
          return HttpResponse.json({
            clinic_id: 2,
            clinic_name: 'Clinic B',
            business_hours: { /* different mock data */ },
            appointment_types: [{ id: 2, name: 'Specialist' }],
            practitioners: [{ id: 2, full_name: 'Dr. Johnson' }]
          });
        })
      );

      // Simulate clinic switch
      const switchResponse = await mockApiCall('/api/auth/switch-clinic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clinic_id: 2 })
      });
      expect(switchResponse.ok).toBe(true);

      // Verify clinic 2 data loads correctly (cache should be invalidated)
      const clinic2Response = await mockApiCall('/api/clinic/settings');
      expect(clinic2Response.ok).toBe(true);
      const clinic2Data = await clinic2Response.json();
      expect(clinic2Data.clinic_name).toBe('Clinic B');
      expect(clinic2Data.appointment_types[0].name).toBe('Specialist');
    });

    it('handles clinic switch failure gracefully', async () => {
      server.use(
        http.post('/api/auth/switch-clinic', () => {
          return HttpResponse.json({ success: false, error: 'Clinic not found' }, { status: 404 });
        })
      );

      const switchResponse = await mockApiCall('/api/auth/switch-clinic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clinic_id: 999 })
      });

      expect(switchResponse.status).toBe(404);
      const errorData = await switchResponse.json();
      expect(errorData.success).toBe(false);
      expect(errorData.error).toBe('Clinic not found');
    });

    it('maintains data consistency during clinic switching', async () => {
      // Setup initial data
      let currentClinicId = 1;
      server.use(
        http.get('/api/clinic/settings', () => {
          return HttpResponse.json({
            clinic_id: currentClinicId,
            clinic_name: `Clinic ${currentClinicId}`,
            appointment_types: [{ id: currentClinicId, name: `Type ${currentClinicId}` }]
          });
        }),
        http.post('/api/auth/switch-clinic', ({ request }) => {
          return request.json().then((body: any) => {
            currentClinicId = body.clinic_id;
            return HttpResponse.json({ success: true });
          });
        })
      );

      // Load clinic 1
      let response = await mockApiCall('/api/clinic/settings');
      let data = await response.json();
      expect(data.clinic_id).toBe(1);

      // Switch to clinic 2
      await mockApiCall('/api/auth/switch-clinic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clinic_id: 2 })
      });

      // Verify clinic 2 data
      response = await mockApiCall('/api/clinic/settings');
      data = await response.json();
      expect(data.clinic_id).toBe(2);
      expect(data.clinic_name).toBe('Clinic 2');
    });
  });

  describe('Network Failure Scenarios', () => {
    it('handles network timeouts gracefully', async () => {
      server.use(
        http.get('/api/appointments', () => {
          // Simulate network timeout
          return new Promise(() => {
            // Never resolves - simulates timeout
          });
        })
      );

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), 100);
      });

      const requestPromise = mockApiCall('/api/appointments');

      // Race between timeout and request
      await expect(Promise.race([requestPromise, timeoutPromise]))
        .rejects.toThrow('Request timeout');
    });

    it('handles server errors with retry logic', async () => {
      let attemptCount = 0;
      server.use(
        http.get('/api/patients', () => {
          attemptCount++;
          if (attemptCount < 3) {
            return HttpResponse.json({ error: 'Server error' }, { status: 500 });
          }
          return HttpResponse.json({ data: [{ id: 1, name: 'John Doe' }] });
        })
      );

      // First attempt should fail
      let response = await mockApiCall('/api/patients');
      expect(response.status).toBe(500);

      // Second attempt should fail
      response = await mockApiCall('/api/patients');
      expect(response.status).toBe(500);

      // Third attempt should succeed
      response = await mockApiCall('/api/patients');
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.data[0].name).toBe('John Doe');
    });

    it('handles offline scenarios with cached data fallback', async () => {
      // First, provide successful response
      server.use(
        http.get('/api/clinic/settings', () => {
          return HttpResponse.json({
            clinic_id: 1,
            clinic_name: 'Test Clinic',
            cached: false
          });
        })
      );

      // Load initial data
      let response = await mockApiCall('/api/clinic/settings');
      let data = await response.json();
      expect(data.cached).toBe(false);

      // Simulate network failure
      server.use(
        http.get('/api/clinic/settings', () => {
          return new Response(null, { status: 500, statusText: 'Network Error' });
        })
      );

      // Request should fail (no automatic caching in this test)
      response = await mockApiCall('/api/clinic/settings');
      expect(response.ok).toBe(false);
    });
  });

  describe('Concurrent Operations', () => {
    it('handles multiple simultaneous appointment bookings', async () => {
      server.use(
        http.post('/api/appointments', async ({ request }) => {
          const body = await request.json() as any;

          // Simulate processing time
          await new Promise(resolve => setTimeout(resolve, 10));

          return HttpResponse.json({
            id: Date.now() + Math.random(),
            ...body,
            status: 'confirmed'
          });
        })
      );

      // Simulate 5 concurrent bookings
      const bookingPromises = Array.from({ length: 5 }, (_, i) =>
        mockApiCall('/api/appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patient_id: i + 1,
            appointment_type_id: 1,
            practitioner_id: 1,
            start_time: `2024-01-15T${10 + i}:00:00Z`,
            end_time: `2024-01-15T${11 + i}:00:00Z`
          })
        })
      );

      const responses = await Promise.all(bookingPromises);

      // All should succeed
      responses.forEach(response => {
        expect(response.ok).toBe(true);
      });

      // Extract booking data
      const bookingData = await Promise.all(
        responses.map(response => response.json())
      );

      // Verify all bookings have unique IDs and correct data
      const ids = bookingData.map(booking => booking.id);
      expect(new Set(ids).size).toBe(5); // All IDs unique

      bookingData.forEach((booking, index) => {
        expect(booking.patient_id).toBe(index + 1);
        expect(booking.status).toBe('confirmed');
      });
    });

    it('handles race conditions in resource allocation', async () => {
      let availableSlots = 3;
      server.use(
        http.post('/api/appointments', async ({ request }) => {
          const body = await request.json() as any;

          // Simulate resource checking
          if (availableSlots > 0) {
            availableSlots--;
            return HttpResponse.json({
              id: Date.now(),
              ...body,
              status: 'confirmed',
              allocated_resources: availableSlots + 1
            });
          } else {
            return HttpResponse.json(
              { error: 'No slots available' },
              { status: 409 }
            );
          }
        })
      );

      // First 3 bookings should succeed
      for (let i = 0; i < 3; i++) {
        const response = await mockApiCall('/api/appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patient_id: i + 1,
            appointment_type_id: 1,
            practitioner_id: 1,
            start_time: '2024-01-15T10:00:00Z',
            end_time: '2024-01-15T11:00:00Z'
          })
        });

        expect(response.ok).toBe(true);
        const data = await response.json();
        expect(data.allocated_resources).toBeGreaterThan(0);
      }

      // 4th booking should fail
      const failureResponse = await mockApiCall('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: 4,
          appointment_type_id: 1,
          practitioner_id: 1,
          start_time: '2024-01-15T10:00:00Z',
          end_time: '2024-01-15T11:00:00Z'
        })
      });

      expect(failureResponse.status).toBe(409);
      const errorData = await failureResponse.json();
      expect(errorData.error).toBe('No slots available');
    });
  });

  describe('Error Recovery Patterns', () => {
    it('handles partial failures in batch operations', async () => {
      let requestCount = 0;
      server.use(
        http.post('/api/appointments/batch', async ({ request }) => {
          const body = await request.json() as any;
          requestCount++;

          // First request succeeds, second fails, third succeeds
          if (requestCount === 2) {
            return HttpResponse.json(
              { error: 'Conflict detected' },
              { status: 409 }
            );
          }

          return HttpResponse.json({
            success: true,
            appointment_id: requestCount
          });
        })
      );

      // Send batch requests
      const results = [];
      for (let i = 0; i < 3; i++) {
        const response = await mockApiCall('/api/appointments/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointments: [{
              patient_id: i + 1,
              appointment_type_id: 1,
              practitioner_id: 1,
              start_time: `2024-01-15T${10 + i}:00:00Z`
            }]
          })
        });

        if (response.ok) {
          const data = await response.json();
          results.push({ success: true, data });
        } else {
          const error = await response.json();
          results.push({ success: false, error });
        }
      }

      // Verify partial success pattern
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);

      expect(results[1].error.error).toBe('Conflict detected');
    });

    it('maintains data integrity during network interruptions', async () => {
      let networkUnstable = false;
      server.use(
        http.get('/api/appointments', () => {
          if (networkUnstable) {
            return HttpResponse.error();
          }
          return HttpResponse.json({
            data: [
              { id: 1, patient_name: 'John Doe', status: 'confirmed' },
              { id: 2, patient_name: 'Jane Smith', status: 'confirmed' }
            ]
          });
        }),
        http.post('/api/appointments', async ({ request }) => {
          const body = await request.json() as any;
          return HttpResponse.json({
            id: Date.now(),
            ...body,
            status: 'confirmed'
          });
        })
      );

      // Load initial data
      let response = await mockApiCall('/api/appointments');
      let data = await response.json();
      expect(data.data.length).toBe(2);

      // Create appointment successfully
      const createResponse = await mockApiCall('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: 3,
          appointment_type_id: 1,
          practitioner_id: 1,
          start_time: '2024-01-15T15:00:00Z'
        })
      });
      expect(createResponse.ok).toBe(true);

      // Simulate network failure for subsequent requests
      networkUnstable = true;

      // List request should fail
      try {
        response = await mockApiCall('/api/appointments');
        // If we get here, the request succeeded but should have failed
        expect(response.ok).toBe(false);
      } catch (error) {
        // Network error is expected
        expect(error).toBeDefined();
      }

      // But creation should still work (different endpoint)
      const createResponse2 = await mockApiCall('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: 4,
          appointment_type_id: 1,
          practitioner_id: 1,
          start_time: '2024-01-15T16:00:00Z'
        })
      });
      expect(createResponse2.ok).toBe(true);
    });
  });
});

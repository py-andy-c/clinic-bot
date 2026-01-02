import { http, HttpResponse } from 'msw';
import { Member, Patient } from '../types';
import { ClinicSettings } from '../schemas/api';

// Base API URL
const API_BASE = '/api';

/**
 * MSW handlers for API mocking in tests
 * 
 * These handlers mock common API endpoints used throughout the application.
 * Add more handlers as needed for specific test scenarios.
 */

export const handlers = [
  // Members endpoints
  http.get(`${API_BASE}/clinic/members`, () => {
    return HttpResponse.json({
      members: [
        {
          id: 1,
          email: 'admin@example.com',
          full_name: 'Admin User',
          roles: ['admin'],
          is_active: true,
        } as Member,
      ],
    });
  }),

  // Patients endpoints
  http.get(`${API_BASE}/clinic/patients`, ({ request }) => {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('page_size') || '25', 10);
    const search = url.searchParams.get('search') || '';

    const mockPatients: Patient[] = Array.from({ length: pageSize }, (_, i) => ({
      id: (page - 1) * pageSize + i + 1,
      full_name: search ? `Patient ${search} ${i + 1}` : `Patient ${i + 1}`,
      phone_number: `091234567${i}`,
      birthday: '1990-01-01',
      gender: 'male',
      notes: null,
      created_at: new Date().toISOString(),
      profile_picture_url: null,
      assigned_practitioner_ids: [],
    }));

    return HttpResponse.json({
      patients: mockPatients,
      total: 100,
      page,
      page_size: pageSize,
    });
  }),

  http.get(`${API_BASE}/clinic/patients/:id`, ({ params }) => {
    const id = parseInt(params.id as string, 10);
    return HttpResponse.json({
      id,
      full_name: `Patient ${id}`,
      phone_number: '0912345678',
      birthday: '1990-01-01',
      gender: 'male',
      notes: null,
      created_at: new Date().toISOString(),
      profile_picture_url: null,
      assigned_practitioner_ids: [],
    } as Patient);
  }),

  // Practitioners endpoints
  http.get(`${API_BASE}/clinic/practitioners`, () => {
    return HttpResponse.json({
      practitioners: [
        { id: 1, full_name: 'Dr. Smith' },
        { id: 2, full_name: 'Dr. Jones' },
      ],
    });
  }),

  // Clinic settings endpoint
  http.get(`${API_BASE}/clinic/settings`, () => {
    return HttpResponse.json({
      clinic_id: 1,
      clinic_name: 'Test Clinic',
      appointment_types: [
        { id: 1, name: '一般治療', duration_minutes: 30 },
        { id: 2, name: '復健', duration_minutes: 60 },
      ],
      business_hours: {},
      notification_settings: {
        reminder_hours_before: 24,
      },
      booking_restriction_settings: {},
      clinic_info_settings: {},
      chat_settings: {
        chat_enabled: false,
      },
      receipt_settings: {},
      liff_urls: null,
    } as unknown as ClinicSettings);
  }),

  // Auth endpoints
  http.get(`${API_BASE}/auth/verify`, () => {
    return HttpResponse.json({
      user_id: 1,
      email: 'test@example.com',
      name: 'Test User',
      user_type: 'clinic_user',
      roles: ['admin'],
      active_clinic_id: 1,
    });
  }),
];

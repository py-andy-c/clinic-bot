import { http, HttpResponse } from 'msw';

export const handlers = [
  // Members API
  http.get('/api/members', () => {
    return HttpResponse.json([
      {
        id: 1,
        full_name: 'Dr. Smith',
        email: 'smith@example.com',
        roles: ['practitioner'],
        is_active: true,
        patient_booking_allowed: true,
      },
      {
        id: 2,
        full_name: 'Dr. Johnson',
        email: 'johnson@example.com',
        roles: ['admin', 'practitioner'],
        is_active: true,
        patient_booking_allowed: true,
      },
    ]);
  }),

  // Appointment Types API
  http.get('/api/appointment-types/:clinicId', () => {
    return HttpResponse.json({
      appointment_types: [
        {
          id: 1,
          name: 'General Treatment',
          duration_minutes: 60,
          receipt_name: 'General',
          allow_patient_booking: true,
          description: 'General dental treatment',
        },
        {
          id: 2,
          name: 'Cleaning',
          duration_minutes: 30,
          receipt_name: 'Cleaning',
          allow_patient_booking: true,
        },
      ],
      appointment_type_instructions: 'Please select your service',
    });
  }),

  // Clinic Settings API
  http.get('/api/clinic-settings', () => {
    return HttpResponse.json({
      clinic_name: 'Test Clinic',
      timezone: 'Asia/Taipei',
      appointment_types: [
        { id: 1, name: 'General Treatment', duration_minutes: 60 },
        { id: 2, name: 'Cleaning', duration_minutes: 30 },
      ],
      business_hours: {
        monday: { open: '09:00', close: '17:00' },
        tuesday: { open: '09:00', close: '17:00' },
        wednesday: { open: '09:00', close: '17:00' },
        thursday: { open: '09:00', close: '17:00' },
        friday: { open: '09:00', close: '17:00' },
      },
    });
  }),

  // Revenue Distribution API
  http.get('/api/analytics/revenue-distribution', () => {
    return HttpResponse.json({
      data: [
        {
          practitioner_name: 'Dr. Smith',
          total_revenue: 15000,
          appointment_count: 25,
        },
        {
          practitioner_name: 'Dr. Johnson',
          total_revenue: 12000,
          appointment_count: 20,
        },
      ],
      total_count: 45,
      summary: {
        total_revenue: 27000,
        total_appointments: 45,
      },
    });
  }),

  // Business Insights API
  http.get('/api/analytics/business-insights', () => {
    return HttpResponse.json({
      revenue_by_service: [
        { service_name: 'General Treatment', revenue: 15000, count: 25 },
        { service_name: 'Cleaning', revenue: 5000, count: 20 },
      ],
      revenue_by_practitioner: [
        { practitioner_name: 'Dr. Smith', revenue: 15000, appointments: 25 },
        { practitioner_name: 'Dr. Johnson', revenue: 12000, appointments: 20 },
      ],
      total_revenue: 27000,
      total_appointments: 45,
      average_revenue_per_appointment: 600,
    });
  }),

  // Dashboard Metrics API
  http.get('/api/dashboard/metrics', () => {
    return HttpResponse.json({
      total_users: 150,
      active_users: 120,
      messages_sent: 2500,
      appointments_booked: 45,
      conversion_rate: 0.18,
      paid_messages: {
        by_recipient_type: {
          patient: { count: 2000, cost: 1200 },
          system: { count: 500, cost: 300 },
        },
        by_event_type: {
          booking: { count: 1500, cost: 900 },
          reminder: { count: 1000, cost: 600 },
        },
      },
    });
  }),

  // Practitioners API
  http.get('/api/practitioners', () => {
    return HttpResponse.json([
      {
        id: 1,
        full_name: 'Dr. Smith',
        email: 'smith@example.com',
        is_active: true,
      },
      {
        id: 2,
        full_name: 'Dr. Johnson',
        email: 'johnson@example.com',
        is_active: true,
      },
    ]);
  }),

  // Patients API
  http.get('/api/patients', () => {
    return HttpResponse.json({
      data: [
        {
          id: 1,
          full_name: 'John Doe',
          email: 'john@example.com',
          phone: '+1234567890',
        },
      ],
      total_count: 1,
    });
  }),

  // Auto Assigned Appointments API
  http.get('/api/appointments/auto-assigned', () => {
    return HttpResponse.json([
      {
        id: 1,
        patient_name: 'John Doe',
        appointment_type_name: 'General Treatment',
        scheduled_at: '2024-01-15T10:00:00Z',
        practitioner_name: 'Dr. Smith',
      },
    ]);
  }),

  // Individual Patient API
  http.get('/api/clinic/patients/:id', () => {
    return HttpResponse.json({
      id: 1,
      full_name: 'John Doe',
      email: 'john@example.com',
      phone: '+1234567890',
      date_of_birth: '1990-01-01',
      gender: 'male',
      address: '123 Main St',
      emergency_contact_name: 'Jane Doe',
      emergency_contact_phone: '+0987654321',
      medical_history: 'No known allergies',
      notes: 'Regular patient',
    });
  }),

  // Patient Appointments API
  http.get('/api/clinic/patients/:id/appointments', () => {
    return HttpResponse.json({
      appointments: [
        {
          id: 1,
          calendar_event_id: 1,
          patient_id: 1,
          patient_name: 'John Doe',
          practitioner_id: 1,
          practitioner_name: 'Dr. Smith',
          appointment_type_id: 1,
          appointment_type_name: 'General Treatment',
          start_time: '2024-01-15T10:00:00Z',
          end_time: '2024-01-15T11:00:00Z',
          status: 'confirmed',
          notes: 'Regular checkup',
          clinic_notes: 'Patient arrived on time',
          created_at: '2024-01-10T09:00:00Z',
          updated_at: '2024-01-14T15:00:00Z',
        },
      ],
    });
  }),

  // Line Users API
  http.get('/api/line-users', () => {
    return HttpResponse.json({
      line_users: [
        {
          id: 1,
          line_user_id: 'line123',
          display_name: 'John Line',
          picture_url: 'https://example.com/picture.jpg',
          status: 'active',
          created_at: '2024-01-01T00:00:00Z',
          linked_at: '2024-01-01T00:00:00Z',
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
    });
  }),

  // System Clinics API
  http.get('/api/clinics', () => {
    return HttpResponse.json([
      {
        id: 1,
        name: 'Main Clinic',
        address: '123 Main St',
        phone: '+1234567890',
        email: 'clinic@example.com',
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
      },
    ]);
  }),

  // User Profile API
  http.get('/api/profile', () => {
    return HttpResponse.json({
      id: 1,
      email: 'user@example.com',
      full_name: 'Dr. Smith',
      roles: ['practitioner'],
      active_clinic_id: 1,
      settings: {},
    });
  }),

  // Practitioner Status API
  http.get('/api/practitioners/:id/status', () => {
    return HttpResponse.json({
      availability_status: 'available',
      next_appointment: '2024-01-15T14:00:00Z',
      working_hours_today: {
        start: '09:00',
        end: '17:00',
      },
    });
  }),

  // Batch Practitioner Status API
  http.post('/api/practitioners/batch-status', () => {
    return HttpResponse.json({
      results: [
        {
          practitioner_id: 1,
          availability_status: 'available',
          next_appointment: '2024-01-15T14:00:00Z',
        },
      ],
    });
  }),
];
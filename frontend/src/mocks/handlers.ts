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
];
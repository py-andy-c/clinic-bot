import { http, HttpResponse } from 'msw';

// Mock settings data
let mockClinicSettings = {
  clinic_id: 1,
  clinic_name: 'Test Clinic',
  business_hours: {
    monday: { start: '09:00', end: '17:00', enabled: true },
    tuesday: { start: '09:00', end: '17:00', enabled: true },
    wednesday: { start: '09:00', end: '17:00', enabled: true },
    thursday: { start: '09:00', end: '17:00', enabled: true },
    friday: { start: '09:00', end: '17:00', enabled: true },
    saturday: { start: '09:00', end: '12:00', enabled: false },
    sunday: { start: '09:00', end: '12:00', enabled: false },
  },
  appointment_types: [
    {
      id: 1,
      clinic_id: 1,
      name: 'General Treatment',
      duration_minutes: 60,
      receipt_name: 'General',
      allow_patient_booking: true,
      description: 'General dental treatment',
      require_notes: true,
      notes_instructions: 'Please describe your symptoms',
      send_patient_confirmation: true,
      send_clinic_confirmation: true,
      send_reminder: true,
      patient_confirmation_message: 'Your appointment has been confirmed',
      clinic_confirmation_message: 'Patient appointment confirmed',
      reminder_message: 'Reminder: You have an appointment tomorrow',
    },
    {
      id: 2,
      clinic_id: 1,
      name: 'Cleaning',
      duration_minutes: 30,
      receipt_name: 'Cleaning',
      allow_patient_booking: true,
      description: 'Professional teeth cleaning',
      require_notes: false,
      notes_instructions: null,
      send_patient_confirmation: true,
      send_clinic_confirmation: true,
      send_reminder: true,
      patient_confirmation_message: 'Your cleaning appointment has been confirmed',
      clinic_confirmation_message: 'Patient cleaning confirmed',
      reminder_message: 'Reminder: You have a cleaning appointment tomorrow',
    },
  ],
  notification_settings: {
    reminder_hours_before: 24,
  },
  booking_restriction_settings: {
    booking_restriction_type: 'minimum_hours_required',
    minimum_booking_hours_ahead: 1,
    deadline_time_day_before: '17:00',
    deadline_on_same_day: false,
    step_size_minutes: 30,
    max_future_appointments: 10,
    max_booking_window_days: 90,
    minimum_cancellation_hours_before: 24,
    allow_patient_deletion: true,
  },
  clinic_info_settings: {
    display_name: 'Test Clinic',
    address: '123 Main Street',
    phone_number: '+1234567890',
    appointment_type_instructions: 'Please select your service type',
    appointment_notes_instructions: 'Please provide any additional notes',
    require_birthday: true,
    require_gender: false,
    restrict_to_assigned_practitioners: false,
    query_page_instructions: 'Welcome to our clinic booking system',
    settings_page_instructions: 'Configure your clinic settings',
    notifications_page_instructions: 'Manage notification preferences',
  },
  chat_settings: {
    chat_enabled: true,
    clinic_description: 'A modern dental clinic providing comprehensive care',
    therapist_info: 'Our experienced team provides gentle, professional care',
    treatment_details: 'We offer a full range of dental services',
    service_item_selection_guide: 'Select the service that best fits your needs',
    operating_hours: 'Monday-Friday 9AM-5PM',
    location_details: 'Located in downtown area with easy parking',
    booking_policy: 'Please arrive 15 minutes early for your appointment',
    payment_methods: 'We accept cash, credit cards, and insurance',
    equipment_facilities: 'State-of-the-art equipment in a modern facility',
    common_questions: 'Frequently asked questions about our services',
    other_info: 'Additional information about our clinic',
    ai_guidance: 'Our AI assistant can help answer your questions',
  },
  receipt_settings: {
    custom_notes: 'Thank you for choosing our clinic',
    show_stamp: true,
  },
  liff_urls: {
    home: 'https://liff.line.me/mock-home',
    booking: 'https://liff.line.me/mock-booking',
  },
};

// Settings management handlers
export const settingsHandlers = [
  // Get clinic settings
  http.get('/api/clinic/settings', () => {
    return HttpResponse.json(mockClinicSettings);
  }),

  // Update clinic settings
  http.put('/api/clinic/settings', async ({ request }) => {
    const body = await request.json() as Record<string, any>;

    // Merge updates with existing settings
    mockClinicSettings = {
      ...mockClinicSettings,
      ...body,
    };

    return HttpResponse.json(mockClinicSettings);
  }),

  // Generate reminder preview
  http.post('/api/clinic/reminders/preview', async ({ request }) => {
    const body = await request.json() as Record<string, any>;

    return HttpResponse.json({
      hours_before: body.hours_before || 24,
      preview_message: `Reminder: You have an appointment in ${body.hours_before || 24} hours`,
      message_type: 'reminder',
    });
  }),

  // Generate cancellation preview
  http.post('/api/appointments/cancellation/preview', async ({ request }) => {
    const body = await request.json() as Record<string, any>;

    return HttpResponse.json({
      appointment_id: body.appointment_id,
      patient_name: 'Test Patient',
      appointment_type: 'General Treatment',
      scheduled_time: new Date().toISOString(),
      cancellation_policy: 'Free cancellation up to 24 hours before',
      cancellation_fee: 0,
      refund_amount: 0,
      can_cancel: true,
      message: 'Appointment can be cancelled without penalty',
    });
  }),

  // Test chatbot
  http.post('/api/clinic/chatbot/test', async ({ request }) => {
    const body = await request.json() as Record<string, any>;

    return HttpResponse.json({
      response: `Test response for: ${body.message || 'empty message'}`,
      confidence: 0.95,
      suggested_actions: ['book_appointment', 'ask_question'],
    });
  }),

  // Validate appointment type deletion
  http.post('/api/clinic/appointment-types/validate-deletion', () => {
    // Mock validation - assume no conflicts for testing
    return HttpResponse.json({
      can_delete: true,
      conflicts: [],
      message: 'Appointment types can be safely deleted',
    });
  }),

  // Bulk update appointment type order
  http.put('/api/clinic/appointment-types/bulk-order', () => {
    // Mock successful reordering
    return HttpResponse.json({
      success: true,
      message: 'Appointment type order updated successfully',
      updated_types: [],
    });
  }),

  // Bulk update service type group order
  http.put('/api/clinic/service-type-groups/bulk-order', () => {
    // Mock successful reordering
    return HttpResponse.json({
      success: true,
      message: 'Service type group order updated successfully',
      updated_groups: [],
    });
  }),
];

import { http, HttpResponse } from 'msw';

// Appointment booking flow handlers
export const appointmentHandlers = [
  // Create appointment
  http.post('/api/appointments', async ({ request }) => {
    const body = await request.json() as Record<string, any>;

    // Simulate basic validation
    if (!body.patient_id || !body.appointment_type_id) {
      return HttpResponse.json(
        { error: 'Missing required fields', message: 'patient_id and appointment_type_id are required' },
        { status: 400 }
      );
    }

    // Mock successful appointment creation
    const mockAppointment = {
      id: Date.now(), // Use timestamp for unique ID
      calendar_event_id: Date.now() + 1,
      patient_id: body.patient_id,
      patient_name: 'Test Patient',
      practitioner_id: body.practitioner_id || 1,
      practitioner_name: 'Dr. Smith',
      appointment_type_id: body.appointment_type_id,
      appointment_type_name: 'General Treatment',
      start_time: body.start_time || new Date().toISOString(),
      end_time: body.end_time || new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour later
      status: 'confirmed',
      notes: body.notes || '',
      clinic_notes: body.clinic_notes || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return HttpResponse.json(mockAppointment);
  }),

  // Check appointment conflicts
  http.post('/api/appointments/check-conflicts', async ({ request }) => {
    const body = await request.json() as Record<string, any>;

    // Mock conflict checking - randomly return conflicts for testing
    const hasConflict = Math.random() < 0.2; // 20% chance of conflict

    if (hasConflict) {
      return HttpResponse.json({
        conflicts: [
          {
            appointment_id: 123,
            patient_name: 'Existing Patient',
            start_time: body.start_time,
            end_time: body.end_time,
          }
        ],
        can_schedule: false,
        message: 'Time slot conflicts with existing appointment'
      });
    }

    return HttpResponse.json({
      conflicts: [],
      can_schedule: true,
      message: 'Time slot is available'
    });
  }),

  // Get appointment details
  http.get('/api/appointments/:id', ({ params }) => {
    const { id } = params;

    const mockAppointment = {
      id: parseInt(id as string),
      calendar_event_id: parseInt(id as string) + 1,
      patient_id: 1,
      patient_name: 'Test Patient',
      practitioner_id: 1,
      practitioner_name: 'Dr. Smith',
      appointment_type_id: 1,
      appointment_type_name: 'General Treatment',
      start_time: new Date().toISOString(),
      end_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      status: 'confirmed',
      notes: 'Test appointment notes',
      clinic_notes: 'Clinic notes',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return HttpResponse.json(mockAppointment);
  }),

  // Edit appointment
  http.put('/api/appointments/:id', async ({ request, params }) => {
    const { id } = params;
    const body = await request.json() as Record<string, any>;

    // Mock successful update
    const updatedAppointment = {
      id: parseInt(id as string),
      calendar_event_id: parseInt(id as string) + 1,
      patient_id: body.patient_id || 1,
      patient_name: 'Test Patient',
      practitioner_id: body.practitioner_id || 1,
      practitioner_name: 'Dr. Smith',
      appointment_type_id: body.appointment_type_id || 1,
      appointment_type_name: 'General Treatment',
      start_time: body.start_time || new Date().toISOString(),
      end_time: body.end_time || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      status: body.status || 'confirmed',
      notes: body.notes || 'Updated notes',
      clinic_notes: body.clinic_notes || 'Updated clinic notes',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return HttpResponse.json(updatedAppointment);
  }),

  // Appointment cancellation preview
  http.post('/api/appointments/cancellation/preview', async ({ request }) => {
    const body = await request.json() as Record<string, any>;

    return HttpResponse.json({
      appointment_id: body.appointment_id,
      patient_name: 'Test Patient',
      appointment_type: 'General Treatment',
      scheduled_time: new Date().toISOString(),
      cancellation_fee: 0,
      refund_amount: 0,
      can_cancel: true,
      message: 'Appointment can be cancelled without penalty'
    });
  }),

  // Preview edit notification
  http.post('/api/appointments/:id/preview-edit-notification', async ({ request, params }) => {
    const { id } = params;
    const body = await request.json() as Record<string, any>;

    return HttpResponse.json({
      appointment_id: parseInt(id as string),
      patient_name: 'Test Patient',
      original_time: body.original_start_time,
      new_time: body.new_start_time,
      notification_required: true,
      message: 'Patient will be notified of appointment changes'
    });
  }),

  // Preview appointment message
  http.post('/api/appointments/preview-message', async ({ request }) => {
    const body = await request.json() as Record<string, any>;

    return HttpResponse.json({
      message: `Appointment confirmed for ${body.patient_name} with Dr. Smith on ${new Date(body.start_time).toLocaleDateString()}`,
      preview: true
    });
  }),

  // Create recurring appointments
  http.post('/api/appointments/recurring', async ({ request }) => {
    const body = await request.json() as Record<string, any>;

    const appointments = [];
    const baseDate = new Date(body.start_time);

    for (let i = 0; i < (body.recurring_count || 1); i++) {
      const appointmentDate = new Date(baseDate);
      appointmentDate.setDate(baseDate.getDate() + (i * 7)); // Weekly recurrence

      appointments.push({
        id: Date.now() + i,
        patient_id: body.patient_id,
        patient_name: 'Test Patient',
        practitioner_id: body.practitioner_id,
        practitioner_name: 'Dr. Smith',
        appointment_type_id: body.appointment_type_id,
        appointment_type_name: 'General Treatment',
        start_time: appointmentDate.toISOString(),
        end_time: new Date(appointmentDate.getTime() + 60 * 60 * 1000).toISOString(),
        status: 'confirmed',
        notes: body.notes,
        clinic_notes: body.clinic_notes,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    return HttpResponse.json({
      appointments,
      total_created: appointments.length,
      message: `Successfully created ${appointments.length} recurring appointments`
    });
  }),
];

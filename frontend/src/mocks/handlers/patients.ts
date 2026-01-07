import { http, HttpResponse } from 'msw';

// Mock patient data store
let mockPatients = [
  {
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
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 2,
    full_name: 'Jane Smith',
    email: 'jane@example.com',
    phone: '+1234567891',
    date_of_birth: '1985-05-15',
    gender: 'female',
    address: '456 Oak Ave',
    emergency_contact_name: 'Bob Smith',
    emergency_contact_phone: '+0987654322',
    medical_history: 'Mild allergies to penicillin',
    notes: 'New patient',
    created_at: '2024-01-15T00:00:00Z',
    updated_at: '2024-01-15T00:00:00Z',
  },
];

// Patient management handlers
export const patientHandlers = [
  // Get patients (paginated)
  http.get('/api/patients', ({ request }) => {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '25');
    const search = url.searchParams.get('search') || '';

    let filteredPatients = mockPatients;

    // Apply search filter
    if (search) {
      filteredPatients = mockPatients.filter(patient =>
        patient.full_name.toLowerCase().includes(search.toLowerCase()) ||
        patient.email.toLowerCase().includes(search.toLowerCase()) ||
        patient.phone.includes(search)
      );
    }

    // Apply pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedPatients = filteredPatients.slice(startIndex, endIndex);

    return HttpResponse.json({
      data: paginatedPatients,
      total_count: filteredPatients.length,
      page,
      page_size: limit,
      total_pages: Math.ceil(filteredPatients.length / limit),
    });
  }),

  // Create patient
  http.post('/api/patients', async ({ request }) => {
    const body = await request.json() as Record<string, any>;

    // Validate required fields
    if (!body.full_name) {
      return HttpResponse.json(
        { error: 'Missing required fields', message: 'full_name is required' },
        { status: 400 }
      );
    }

    const newPatient = {
      id: Date.now(), // Use timestamp for unique ID
      full_name: body.full_name,
      email: body.email || '',
      phone: body.phone || '',
      date_of_birth: body.date_of_birth || null,
      gender: body.gender || null,
      address: body.address || '',
      emergency_contact_name: body.emergency_contact_name || '',
      emergency_contact_phone: body.emergency_contact_phone || '',
      medical_history: body.medical_history || '',
      notes: body.notes || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    mockPatients.push(newPatient);

    return HttpResponse.json(newPatient);
  }),

  // Get individual patient
  http.get('/api/clinic/patients/:id', ({ params }) => {
    const { id } = params;
    const patient = mockPatients.find(p => p.id === parseInt(id as string));

    if (!patient) {
      return HttpResponse.json(
        { error: 'Patient not found', message: 'No patient found with the specified ID' },
        { status: 404 }
      );
    }

    return HttpResponse.json(patient);
  }),

  // Update patient
  http.put('/api/clinic/patients/:id', async ({ request, params }) => {
    const { id } = params;
    const body = await request.json() as Record<string, any>;
    const patientIndex = mockPatients.findIndex(p => p.id === parseInt(id as string));

    if (patientIndex === -1) {
      return HttpResponse.json(
        { error: 'Patient not found', message: 'No patient found with the specified ID' },
        { status: 404 }
      );
    }

    // Update patient data
    const existingPatient = mockPatients[patientIndex];
    if (!existingPatient) {
      return HttpResponse.json(
        { error: 'Patient not found', message: 'Patient data is corrupted' },
        { status: 500 }
      );
    }

    mockPatients[patientIndex] = {
      id: existingPatient.id,
      full_name: body.full_name ?? existingPatient.full_name,
      email: body.email ?? existingPatient.email,
      phone: body.phone ?? existingPatient.phone,
      date_of_birth: body.date_of_birth ?? existingPatient.date_of_birth,
      gender: body.gender ?? existingPatient.gender,
      address: body.address ?? existingPatient.address,
      emergency_contact_name: body.emergency_contact_name ?? existingPatient.emergency_contact_name,
      emergency_contact_phone: body.emergency_contact_phone ?? existingPatient.emergency_contact_phone,
      medical_history: body.medical_history ?? existingPatient.medical_history,
      notes: body.notes ?? existingPatient.notes,
      created_at: existingPatient.created_at,
      updated_at: new Date().toISOString(),
    };

    return HttpResponse.json(mockPatients[patientIndex]);
  }),

  // Get patient appointments
  http.get('/api/clinic/patients/:id/appointments', ({ params }) => {
    const { id } = params;

    // Mock appointments for the patient
    const mockAppointments = [
      {
        id: 1,
        calendar_event_id: 1,
        patient_id: parseInt(id as string),
        patient_name: mockPatients.find(p => p.id === parseInt(id as string))?.full_name || 'Patient',
        practitioner_id: 1,
        practitioner_name: 'Dr. Smith',
        appointment_type_id: 1,
        appointment_type_name: 'General Treatment',
        start_time: new Date().toISOString(),
        end_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        status: 'confirmed',
        notes: 'Regular checkup',
        clinic_notes: 'Patient arrived on time',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    return HttpResponse.json({
      appointments: mockAppointments,
    });
  }),

  // Assign practitioner to patient
  http.post('/api/clinic/patients/:patientId/practitioners', async ({ request, params }) => {
    const { patientId } = params;
    const body = await request.json() as Record<string, any>;

    const patient = mockPatients.find(p => p.id === parseInt(patientId as string));
    if (!patient) {
      return HttpResponse.json(
        { error: 'Patient not found' },
        { status: 404 }
      );
    }

    // Mock successful assignment
    return HttpResponse.json({
      patient_id: parseInt(patientId as string),
      practitioner_id: body.practitioner_id,
      assigned_at: new Date().toISOString(),
      message: 'Practitioner assigned successfully',
    });
  }),

  // Remove practitioner assignment
  http.delete('/api/clinic/patients/:patientId/practitioners/:practitionerId', ({ params }) => {
    const { patientId, practitionerId } = params;

    // Mock successful removal
    return HttpResponse.json({
      patient_id: parseInt(patientId as string),
      practitioner_id: parseInt(practitionerId as string),
      removed_at: new Date().toISOString(),
      message: 'Practitioner assignment removed successfully',
    });
  }),

  // Check duplicate patient name
  http.get('/api/patients/check-duplicate', ({ request }) => {
    const url = new URL(request.url);
    const name = url.searchParams.get('name') || '';

    const duplicate = mockPatients.find(p =>
      p.full_name.toLowerCase() === name.toLowerCase()
    );

    return HttpResponse.json({
      count: duplicate ? 1 : 0,
      exists: !!duplicate,
    });
  }),
];

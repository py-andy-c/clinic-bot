import axios, { AxiosInstance } from 'axios';

// LIFF-specific types
export interface LiffLoginRequest {
  line_user_id: string;
  display_name: string;
  liff_access_token?: string;
  clinic_id: number;
}

export interface LiffLoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  is_first_time: boolean;
  display_name: string;
  clinic_id: number;
}

export interface PatientCreateRequest {
  full_name: string;
  phone_number: string;
}

export interface PatientResponse {
  patient_id: number;
  full_name: string;
  phone_number: string;
  created_at: string;
}

export interface PatientSummary {
  id: number;
  full_name: string;
  created_at: string;
}

export interface PatientsResponse {
  patients: PatientSummary[];
}

export interface Practitioner {
  id: number;
  full_name: string;
  picture_url?: string;
  offered_types: number[];
}

export interface PractitionersResponse {
  practitioners: Practitioner[];
}

export interface AvailabilitySlot {
  start_time: string;
  end_time: string;
  practitioner_id: number;
  practitioner_name: string;
}

export interface AvailabilityResponse {
  date: string;
  slots: AvailabilitySlot[];
}

export interface AppointmentCreateRequest {
  clinic_id: number;
  patient_id: number;
  appointment_type_id: number;
  practitioner_id?: number; // null for "不指定"
  start_time: string;
  notes?: string;
}

export interface AppointmentResponse {
  appointment_id: number;
  calendar_event_id: number;
  patient_name: string;
  practitioner_name: string;
  appointment_type_name: string;
  start_time: string;
  end_time: string;
  notes?: string;
}

export interface AppointmentSummary {
  id: number;
  patient_id: number;
  patient_name: string;
  practitioner_name: string;
  appointment_type_name: string;
  start_time: string;
  end_time: string;
  status: 'confirmed' | 'canceled_by_patient' | 'canceled_by_clinic';
  notes?: string;
}

export interface AppointmentsResponse {
  appointments: AppointmentSummary[];
}

class LiffApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: (import.meta as any).env?.VITE_API_BASE_URL || '/api',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor to include LIFF JWT token
    this.client.interceptors.request.use((config) => {
      const token = localStorage.getItem('liff_jwt_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          // LIFF token expired, clear it and redirect to login
          localStorage.removeItem('liff_jwt_token');
          // For LIFF, we might need to re-initialize or show error
          console.error('LIFF authentication failed');
        }
        return Promise.reject(error);
      }
    );
  }

  // Authentication
  async liffLogin(request: LiffLoginRequest): Promise<LiffLoginResponse> {
    const response = await this.client.post('/auth/liff-login', request);
    const data = response.data;

    // Store the JWT token
    if (data.access_token) {
      localStorage.setItem('liff_jwt_token', data.access_token);
    }

    return data;
  }

  // Patient Management
  async createPrimaryPatient(request: PatientCreateRequest): Promise<PatientResponse> {
    const response = await this.client.post('/patients/primary', request);
    return response.data;
  }

  async getPatients(): Promise<PatientsResponse> {
    const response = await this.client.get('/patients');
    return response.data;
  }

  async createPatient(request: { clinic_id: number; full_name: string }): Promise<{ patient_id: number; full_name: string }> {
    const response = await this.client.post('/patients', request);
    return response.data;
  }

  async deletePatient(patientId: number): Promise<{ success: boolean; message: string }> {
    const response = await this.client.delete(`/patients/${patientId}`);
    return response.data;
  }

  // Appointment Types
  async getAppointmentTypes(clinicId: number): Promise<{ appointment_types: Array<{ id: number; name: string; duration_minutes: number }> }> {
    const response = await this.client.get(`/clinics/${clinicId}/appointment-types`);
    return response.data;
  }

  // Practitioners
  async getPractitioners(clinicId: number, appointmentTypeId?: number): Promise<PractitionersResponse> {
    const params = appointmentTypeId ? { appointment_type_id: appointmentTypeId } : {};
    const response = await this.client.get(`/clinics/${clinicId}/practitioners`, { params });
    return response.data;
  }

  // Availability
  async getAvailability(params: {
    clinic_id: number;
    date: string;
    appointment_type_id: number;
    practitioner_id?: number;
  }): Promise<AvailabilityResponse> {
    const response = await this.client.get('/availability', { params });
    return response.data;
  }

  // Appointments
  async createAppointment(request: AppointmentCreateRequest): Promise<AppointmentResponse> {
    const response = await this.client.post('/appointments', request);
    return response.data;
  }

  async getAppointments(upcomingOnly: boolean = true): Promise<AppointmentsResponse> {
    const params = { upcoming_only: upcomingOnly };
    const response = await this.client.get('/appointments', { params });
    return response.data;
  }

  async cancelAppointment(appointmentId: number): Promise<{ success: boolean; message: string }> {
    const response = await this.client.delete(`/appointments/${appointmentId}`);
    return response.data;
  }

  // ICS Download
  async getAppointmentICS(appointmentId: number): Promise<Blob> {
    const response = await this.client.get(`/appointments/${appointmentId}/ics`, {
      responseType: 'blob',
      headers: {
        'Accept': 'text/calendar',
      },
    });
    return response.data;
  }
}

export const liffApiService = new LiffApiService();

import axios, { AxiosInstance } from 'axios';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { Practitioner } from '../types';

// LIFF-specific types
export interface LiffLoginRequest {
  line_user_id: string;
  display_name: string;
  liff_access_token: string;
  clinic_id: number;
}

export interface LiffLoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  is_first_time: boolean;
  display_name: string;
  clinic_id: number;
  preferred_language?: string; // Optional for backward compatibility
}

export interface PatientCreateRequest {
  full_name: string;
  phone_number: string;
  birthday?: string; // YYYY-MM-DD format
}

export interface PatientResponse {
  patient_id: number;
  full_name: string;
  phone_number: string;
  birthday?: string; // YYYY-MM-DD format
  created_at: string;
}

export interface PatientSummary {
  id: number;
  full_name: string;
  phone_number: string;
  birthday?: string; // YYYY-MM-DD format
  created_at: string;
  future_appointments_count?: number;
  max_future_appointments?: number;
}

export interface PatientsResponse {
  patients: PatientSummary[];
}

export interface PractitionersResponse {
  practitioners: Practitioner[];
}

export interface AvailabilitySlot {
  start_time: string;
  end_time: string;
  practitioner_id: number;
  practitioner_name: string;
  is_recommended?: boolean; // True if slot is recommended for compact scheduling
}

export interface AvailabilityResponse {
  date: string;
  slots: AvailabilitySlot[];
}

export interface AppointmentCreateRequest {
  patient_id: number;
  appointment_type_id: number;
  practitioner_id: number | undefined; // undefined for "不指定"
  start_time: string;
  notes: string | undefined;
}

export interface AppointmentResponse {
  appointment_id: number;
  calendar_event_id: number;
  patient_name: string;
  practitioner_name: string;
  practitioner_id: number;
  appointment_type_name: string;
  start_time: string;
  end_time: string;
  status: string;
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

export interface ClinicInfoResponse {
  clinic_id: number;
  clinic_name: string;
  display_name: string;
  address: string | null;
  phone_number: string | null;
  require_birthday?: boolean;
  minimum_cancellation_hours_before?: number;
}

class LiffApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.apiBaseUrl,
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
          logger.error('LIFF authentication failed');
        }
        return Promise.reject(error);
      }
    );
  }

  // Authentication
  async liffLogin(request: LiffLoginRequest): Promise<LiffLoginResponse> {
    const response = await this.client.post('/liff/auth/liff-login', request);
    const data = response.data;

    // Store the JWT token
    if (data.access_token) {
      localStorage.setItem('liff_jwt_token', data.access_token);
    }

    return data;
  }

  // Patient Management
  async getPatients(): Promise<PatientsResponse> {
    const response = await this.client.get('/liff/patients');
    return response.data;
  }

  async createPatient(request: { full_name: string; phone_number: string; birthday?: string }): Promise<{ patient_id: number; full_name: string }> {
    const response = await this.client.post('/liff/patients', request);
    return response.data;
  }

  async updatePatient(patientId: number, request: { full_name?: string; phone_number?: string; birthday?: string }): Promise<{ patient_id: number; full_name: string; phone_number: string }> {
    const response = await this.client.put(`/liff/patients/${patientId}`, request);
    return response.data;
  }

  async deletePatient(patientId: number): Promise<{ success: boolean; message: string }> {
    const response = await this.client.delete(`/liff/patients/${patientId}`);
    return response.data;
  }

  // Appointment Types
  async getAppointmentTypes(_clinicId: number): Promise<{ 
    appointment_types: Array<{ id: number; name: string; duration_minutes: number }>; 
    appointment_type_instructions?: string 
  }> {
    // Clinic ID is already in the JWT token, don't need it in URL
    const response = await this.client.get('/liff/appointment-types');
    return response.data;
  }

  // Practitioners
  async getPractitioners(_clinicId: number, appointmentTypeId?: number): Promise<PractitionersResponse> {
    // Clinic ID is already in the JWT token, don't need it in URL
    const params = appointmentTypeId ? { appointment_type_id: appointmentTypeId } : {};
    const response = await this.client.get('/liff/practitioners', { params });
    return response.data;
  }

  // Availability
  async getAvailability(params: {
    date: string;
    appointment_type_id: number;
    practitioner_id: number | undefined;
    exclude_calendar_event_id?: number;
  }): Promise<AvailabilityResponse> {
    // Clinic ID is already in the JWT token, don't need it in params
    const response = await this.client.get('/liff/availability', { params });
    return response.data;
  }

  // Batch Availability
  async getAvailabilityBatch(params: {
    dates: string[];
    appointment_type_id: number;
    practitioner_id: number | undefined;
    exclude_calendar_event_id?: number;
  }): Promise<{
    results: AvailabilityResponse[];
  }> {
    const response = await this.client.post('/liff/availability/batch', {
      dates: params.dates,
      appointment_type_id: params.appointment_type_id,
      practitioner_id: params.practitioner_id ?? null,
      exclude_calendar_event_id: params.exclude_calendar_event_id ?? null,
    });
    return response.data;
  }

  // Appointments
  async createAppointment(request: AppointmentCreateRequest): Promise<AppointmentResponse> {
    const response = await this.client.post('/liff/appointments', request);
    return response.data;
  }

  async getAppointments(upcomingOnly: boolean = true): Promise<AppointmentsResponse> {
    const params = { upcoming_only: upcomingOnly };
    const response = await this.client.get('/liff/appointments', { params });
    return response.data;
  }

  async cancelAppointment(appointmentId: number): Promise<{ success: boolean; message: string }> {
    const response = await this.client.delete(`/liff/appointments/${appointmentId}`);
    return response.data;
  }

  async getAppointmentDetails(appointmentId: number): Promise<{
    id: number;
    patient_id: number;
    patient_name: string;
    practitioner_id: number;
    practitioner_name: string;
    appointment_type_id: number;
    appointment_type_name: string;
    start_time: string;
    end_time: string;
    status: string;
    notes?: string;
    is_auto_assigned?: boolean;
  }> {
    const response = await this.client.get(`/liff/appointments/${appointmentId}/details`);
    return response.data;
  }

  async rescheduleAppointment(appointmentId: number, request: {
    new_practitioner_id?: number | null; // number = specific, -1 = auto-assign, null/undefined = keep current
    new_start_time: string; // ISO datetime string
    new_notes?: string | null;
  }): Promise<{ success: boolean; appointment_id: number; message: string }> {
    const response = await this.client.post(`/liff/appointments/${appointmentId}/reschedule`, request);
    return response.data;
  }

  // Clinic Info
  async getClinicInfo(): Promise<ClinicInfoResponse> {
    const response = await this.client.get('/liff/clinic-info');
    return response.data;
  }

  // Availability Notifications
  async createAvailabilityNotification(request: {
    appointment_type_id: number;
    practitioner_id?: number | null;
    time_windows: Array<{ date: string; time_window: 'morning' | 'afternoon' | 'evening' }>;
  }): Promise<{
    id: number;
    appointment_type_id: number;
    appointment_type_name: string;
    practitioner_id: number | null;
    practitioner_name: string | null;
    time_windows: Array<{ date: string; time_window: string }>;
    created_at: string;
    min_date: string;
    max_date: string;
  }> {
    const response = await this.client.post('/liff/availability-notifications', request);
    return response.data;
  }

  async getAvailabilityNotifications(params?: {
    page?: number;
    page_size?: number;
  }): Promise<{
    notifications: Array<{
      id: number;
      appointment_type_id: number;
      appointment_type_name: string;
      practitioner_id: number | null;
      practitioner_name: string | null;
      time_windows: Array<{ date: string; time_window: string }>;
      created_at: string;
      min_date: string;
      max_date: string;
    }>;
    total: number;
    page: number;
    page_size: number;
  }> {
    const response = await this.client.get('/liff/availability-notifications', { params });
    return response.data;
  }

  async deleteAvailabilityNotification(notificationId: number): Promise<{ success: boolean }> {
    const response = await this.client.delete(`/liff/availability-notifications/${notificationId}`);
    return response.data;
  }

  // Language Preference
  async updateLanguagePreference(language: string): Promise<{ preferred_language: string }> {
    const response = await this.client.put('/liff/language-preference', { language });
    return response.data;
  }
}

export const liffApiService = new LiffApiService();

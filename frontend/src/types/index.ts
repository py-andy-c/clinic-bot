// API Response types
export interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  message?: string;
}

// Clinic types
export interface Clinic {
  id: number;
  name: string;
  line_channel_id: string;
  subscription_status: 'trial' | 'active' | 'past_due' | 'canceled';
  trial_ends_at?: string;
}

// Therapist types
export interface Therapist {
  id: number;
  clinic_id: number;
  name: string;
  email: string;
  gcal_sync_enabled: boolean;
  gcal_credentials?: any;
  created_at: string;
}

// Patient types
export interface Patient {
  id: number;
  clinic_id: number;
  full_name: string;
  phone_number: string;
  created_at: string;
  line_user_id?: string;
}

// Appointment types
export interface AppointmentType {
  id: number;
  clinic_id: number;
  name: string;
  duration_minutes: number;
}

// Appointment types
export interface Appointment {
  id: number;
  patient_id: number;
  therapist_id: number;
  appointment_type_id: number;
  start_time: string;
  end_time: string;
  status: 'confirmed' | 'canceled_by_patient' | 'canceled_by_clinic';
  gcal_event_id?: string;
  created_at: string;
  updated_at: string;

  // Relations
  patient?: Patient;
  therapist?: Therapist;
  appointment_type?: AppointmentType;
}

// Auth types
export interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

// Dashboard types
export interface DashboardStats {
  total_appointments: number;
  upcoming_appointments: number;
  new_patients: number;
  cancellation_rate: number;
}

// API Response types
export interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  message?: string;
}

// User roles and types
export type UserRole = 'admin' | 'practitioner';
export type UserType = 'system_admin' | 'clinic_user';

// Clinic types
export interface Clinic {
  id: number;
  name: string;
  line_channel_id: string;
  line_channel_secret: string;
  line_channel_access_token: string;
  subscription_status: 'trial' | 'active' | 'past_due' | 'canceled';
  trial_ends_at?: string;
  stripe_customer_id?: string;
  created_at: string;
  updated_at: string;
  last_webhook_received_at?: string;
  webhook_count_24h: number;
  last_health_check_at?: string;
  health_check_errors?: string;
}

// User types (unified model)
export interface User {
  id: number;
  email: string;
  full_name: string;
  roles: UserRole[];
  clinic_id?: number;
  user_type: UserType;
  is_active: boolean;
  gcal_sync_enabled?: boolean;
  gcal_credentials?: any;
  gcal_watch_resource_id?: string;
  created_at: string;
  updated_at: string;
  last_login_at?: string;
}

// Member type (alias for User in clinic context)
export type Member = User;

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
  user_id: number; // Changed from therapist_id to user_id
  appointment_type_id: number;
  start_time: string;
  end_time: string;
  status: 'confirmed' | 'canceled_by_patient' | 'canceled_by_clinic';
  gcal_event_id?: string;
  created_at: string;
  updated_at: string;

  // Relations
  patient?: Patient;
  user?: User; // Changed from therapist to user
  appointment_type?: AppointmentType;
}

// Auth types
export interface AuthUser {
  user_id: number;
  email: string;
  full_name: string;
  roles: UserRole[];
  clinic_id?: number;
  user_type: UserType;
}

export interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

// Dashboard types
export interface ClinicDashboardStats {
  total_appointments: number;
  upcoming_appointments: number;
  new_patients: number;
  cancellation_rate: number;
  total_members: number;
  active_members: number;
}

export interface SystemDashboardStats {
  total_clinics: number;
  active_clinics: number;
  total_users: number;
  system_health: 'healthy' | 'warning' | 'error';
}

// System admin types
export interface ClinicCreateData {
  name: string;
  line_channel_id: string;
  line_channel_secret: string;
  line_channel_access_token: string;
  subscription_status?: 'trial' | 'active' | 'past_due' | 'canceled';
  trial_ends_at?: string;
}

export interface ClinicUpdateData {
  name?: string;
  line_channel_id?: string;
  line_channel_secret?: string;
  line_channel_access_token?: string;
  subscription_status?: 'trial' | 'active' | 'past_due' | 'canceled';
  trial_ends_at?: string;
}

export interface ClinicHealth {
  clinic_id: number;
  line_integration_status: 'healthy' | 'warning' | 'error';
  webhook_status: 'active' | 'inactive';
  webhook_count_24h: number;
  signature_verification_capable: boolean;
  api_connectivity: string;
  error_messages: string[];
  health_check_performed_at: string;
}

// Signup types
export interface SignupTokenInfo {
  token: string;
  clinic_name?: string;
  default_roles?: UserRole[];
  expires_at: string;
  is_expired: boolean;
  is_used: boolean;
}

export interface MemberInviteData {
  default_roles: UserRole[];
}

// OAuth types
export interface OAuthResponse {
  auth_url: string;
}

export interface SignupResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: AuthUser;
}

// Settings types
export interface AppointmentType {
  id: number;
  clinic_id: number;
  name: string;
  duration_minutes: number;
}

export interface ClinicSettings {
  clinic_id: number;
  clinic_name: string;
  business_hours: Record<string, { start: string; end: string; enabled: boolean }>;
  appointment_types: AppointmentType[];
  notification_settings: {
    email_reminders: boolean;
    sms_reminders: boolean;
    reminder_hours_before: number;
  };
  clinic_hours_start?: string;
  clinic_hours_end?: string;
}

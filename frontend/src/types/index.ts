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
  line_user_display_name?: string;
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

// Calendar and Availability types
export interface TimeInterval {
  start_time: string;
  end_time: string;
}

export interface DefaultScheduleRequest {
  monday: TimeInterval[];
  tuesday: TimeInterval[];
  wednesday: TimeInterval[];
  thursday: TimeInterval[];
  friday: TimeInterval[];
  saturday: TimeInterval[];
  sunday: TimeInterval[];
}

export interface DefaultScheduleResponse {
  monday: TimeInterval[];
  tuesday: TimeInterval[];
  wednesday: TimeInterval[];
  thursday: TimeInterval[];
  friday: TimeInterval[];
  saturday: TimeInterval[];
  sunday: TimeInterval[];
}

export interface CalendarEvent {
  id: number;
  user_id: number;
  event_type: 'appointment' | 'availability_exception';
  date: string;
  start_time?: string;
  end_time?: string;
  created_at: string;
  updated_at: string;
}

export interface AppointmentEvent extends CalendarEvent {
  event_type: 'appointment';
  calendar_event_id: number;
  patient_id: number;
  appointment_type_id: number;
  status: 'confirmed' | 'canceled_by_patient' | 'canceled_by_clinic';
  title: string;
  patient?: Patient;
  appointment_type?: AppointmentType;
}

export interface AvailabilityExceptionEvent extends CalendarEvent {
  event_type: 'availability_exception';
  calendar_event_id: number;
  exception_id: number;
  title: string;
}

// API Response types (what the backend actually returns)
export interface ApiCalendarEvent {
  calendar_event_id: number;
  type: 'appointment' | 'availability_exception';
  start_time?: string;
  end_time?: string;
  title: string;
  patient_id?: number;
  appointment_type_id?: number;
  status?: string;
  exception_id?: number;
  appointment_id?: number; // For appointment cancellation
  notes?: string;
  patient_phone?: string;
  line_display_name?: string;
  patient_name?: string;
  practitioner_name?: string;
  appointment_type_name?: string;
}

export interface ApiDailyCalendarData {
  date: string;
  default_schedule: TimeInterval[];
  events: ApiCalendarEvent[];
}

export type CalendarEventItem = AppointmentEvent | AvailabilityExceptionEvent;

export interface MonthlyCalendarData {
  month: string;
  total_days: number;
  page: number;
  limit: number;
  days: {
    date: string;
    appointment_count: number;
  }[];
}

export interface DailyCalendarData {
  date: string;
  default_schedule: TimeInterval[];
  events: CalendarEventItem[];
}

export interface AvailableSlotsResponse {
  available_slots: TimeInterval[];
}

export interface AvailabilityExceptionRequest {
  date: string;
  start_time: string;
  end_time: string;
}

export interface AvailabilityExceptionResponse {
  calendar_event_id: number;
  exception_id: number;
  date: string;
  start_time: string;
  end_time: string;
  created_at: string;
}

// Error and warning response types
export interface ErrorResponse {
  error: string;
  message: string;
  details?: any;
}

export interface WarningResponse {
  warning: string;
  message: string;
  details?: any;
}

// Updated availability types (without is_available field)
export interface PractitionerAvailability {
  id: number;
  user_id: number;
  day_of_week: number;
  day_name: string;
  day_name_zh: string;
  start_time: string;
  end_time: string;
  created_at?: string;
  updated_at?: string;
}

export interface AvailabilityFormData {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface ClinicSettings {
  clinic_id: number;
  clinic_name: string;
  business_hours: Record<string, { start: string; end: string; enabled: boolean }>;
  appointment_types: AppointmentType[];
  notification_settings: {
    reminder_hours_before: string | number;
  };
}

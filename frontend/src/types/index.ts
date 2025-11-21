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
  liff_url?: string;  // LIFF URL for the clinic
  settings?: {
    notification_settings?: {
      reminder_hours_before?: number;
    };
    booking_restriction_settings?: {
      booking_restriction_type?: string;
      minimum_booking_hours_ahead?: number;
      step_size_minutes?: number;
      max_future_appointments?: number;
      max_booking_window_days?: number;
      minimum_cancellation_hours_before?: number;
    };
    clinic_info_settings?: {
      display_name?: string | null;
      address?: string | null;
      phone_number?: string | null;
      appointment_type_instructions?: string | null;
      require_birthday?: boolean;
    };
    chat_settings?: {
      chat_enabled?: boolean;
      clinic_description?: string | null;
      therapist_info?: string | null;
      treatment_details?: string | null;
      service_item_selection_guide?: string | null;
      operating_hours?: string | null;
      location_details?: string | null;
      booking_policy?: string | null;
      payment_methods?: string | null;
      equipment_facilities?: string | null;
      common_questions?: string | null;
      other_info?: string | null;
      ai_guidance?: string | null;
    };
  };
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

// Practitioner types
export interface Practitioner {
  id: number;
  full_name: string;
  picture_url?: string;
  offered_types: number[];
}

// Practitioner details for system admin view
export interface PractitionerAppointmentType {
  id: number;
  name: string;
  duration_minutes: number;
}

export interface PractitionerScheduleInterval {
  start_time: string;
  end_time: string;
}

export interface PractitionerWithDetails {
  id: number;
  email: string;
  full_name: string;
  roles: string[];
  appointment_types: PractitionerAppointmentType[];
  default_schedule: Record<string, PractitionerScheduleInterval[]>;
}

// Patient types
export interface Patient {
  id: number;
  clinic_id: number;
  full_name: string;
  phone_number: string;
  birthday?: string; // YYYY-MM-DD format
  created_at: string;
  line_user_id?: string;
  line_user_display_name?: string;
}

// LINE User types
export interface LineUserWithStatus {
  line_user_id: string;
  display_name: string | null;
  patient_count: number;
  patient_names: string[];
  ai_disabled: boolean;
  disabled_at?: string;
}

// Note: PaginatedResponse type is not currently used as responses use field-specific names
// (e.g., patients, line_users) rather than a generic "items" field.
// Keeping this type for potential future use or refactoring.
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

// Appointment types
export interface AppointmentType {
  id: number;
  clinic_id: number;
  name: string;
  duration_minutes: number;
  is_deleted?: boolean;
}

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
export interface ClinicInfo {
  id: number;
  name: string;
  display_name: string;
  roles: UserRole[];
  is_active: boolean;
  last_accessed_at: string | null;
}

export interface AuthUser {
  user_id: number;
  email: string;
  full_name: string;
  roles: UserRole[]; // Roles at active_clinic_id
  active_clinic_id: number | null; // Currently selected clinic (null for system admins)
  available_clinics?: ClinicInfo[]; // List of clinics user can access
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

export interface ClinicHealth {
  clinic_id: number;
  line_integration_status: 'healthy' | 'warning' | 'error';
  webhook_status: 'very_active' | 'active' | 'moderate' | 'inactive' | 'stale';
  last_webhook_received_at?: string | null;
  last_webhook_age_hours?: number | null;
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

// Clinic switching types
export interface ClinicsListResponse {
  clinics: ClinicInfo[];
  active_clinic_id: number | null;
}

export interface SwitchClinicResponse {
  access_token: string | null; // None when idempotent (use current token)
  refresh_token: string | null; // None when idempotent (use current token)
  active_clinic_id: number;
  roles: string[];
  name: string;
  clinic: {
    id: number;
    name: string;
    display_name: string;
  };
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
  patient_birthday?: string; // YYYY-MM-DD format
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
  date?: string; // Date in YYYY-MM-DD format (included in batch responses)
  available_slots: TimeInterval[];
}

export interface BatchAvailableSlotsResponse {
  results: AvailableSlotsResponse[];
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

export * from './api';

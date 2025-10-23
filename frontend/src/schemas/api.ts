import { z } from 'zod';

// Base API response schema
export const ApiResponseSchema = z.object({
  data: z.any().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});

// Clinic Settings schemas
export const NotificationSettingsSchema = z.object({
  email_reminders: z.boolean(),
  sms_reminders: z.boolean(),
  reminder_hours_before: z.number(),
});

export const BusinessHoursSchema = z.record(z.string(), z.object({
  start: z.string(),
  end: z.string(),
  enabled: z.boolean(),
}));

export const AppointmentTypeSchema = z.object({
  id: z.number(),
  clinic_id: z.number(),
  name: z.string(),
  duration_minutes: z.number(),
});

export const ClinicSettingsSchema = z.object({
  clinic_id: z.number(),
  clinic_name: z.string(),
  business_hours: BusinessHoursSchema,
  appointment_types: z.array(AppointmentTypeSchema),
  notification_settings: NotificationSettingsSchema,
  clinic_hours_start: z.string().optional(),
  clinic_hours_end: z.string().optional(),
});

// Clinic Dashboard Stats schema
export const ClinicDashboardStatsSchema = z.object({
  total_appointments: z.number(),
  upcoming_appointments: z.number(),
  new_patients: z.number(),
  cancellation_rate: z.number(),
  total_members: z.number(),
  active_members: z.number(),
});

// User/Member schemas
export const UserRoleSchema = z.enum(['admin', 'practitioner']);
export const UserTypeSchema = z.enum(['system_admin', 'clinic_user']);

export const UserSchema = z.object({
  id: z.number(),
  email: z.string(),
  full_name: z.string(),
  roles: z.array(UserRoleSchema),
  clinic_id: z.number().optional(),
  user_type: UserTypeSchema,
  gcal_sync_enabled: z.boolean().optional(),
  gcal_credentials: z.any().optional(),
  gcal_watch_resource_id: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  last_login_at: z.string().optional(),
});

// Auth schemas
export const AuthUserSchema = z.object({
  user_id: z.number(),
  email: z.string(),
  full_name: z.string(),
  roles: z.array(UserRoleSchema),
  clinic_id: z.number().optional(),
  user_type: UserTypeSchema,
});

export const SignupResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  user: AuthUserSchema,
});

// Type inference helpers
export type ClinicSettings = z.infer<typeof ClinicSettingsSchema>;
export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;
export type ClinicDashboardStats = z.infer<typeof ClinicDashboardStatsSchema>;
export type User = z.infer<typeof UserSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
export type SignupResponse = z.infer<typeof SignupResponseSchema>;
export type ApiResponse<T> = z.infer<typeof ApiResponseSchema> & { data?: T };

// Validation helper functions
export function validateClinicSettings(data: unknown): ClinicSettings {
  return ClinicSettingsSchema.parse(data);
}

export function validateClinicDashboardStats(data: unknown): ClinicDashboardStats {
  return ClinicDashboardStatsSchema.parse(data);
}

export function validateSignupResponse(data: unknown): SignupResponse {
  return SignupResponseSchema.parse(data);
}

export function safeParseClinicSettings(data: unknown) {
  return ClinicSettingsSchema.safeParse(data);
}

export function safeParseClinicDashboardStats(data: unknown) {
  return ClinicDashboardStatsSchema.safeParse(data);
}

export function safeParseSignupResponse(data: unknown) {
  return SignupResponseSchema.safeParse(data);
}

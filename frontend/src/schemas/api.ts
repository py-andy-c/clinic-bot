import { z } from 'zod';

// Base API response schema
export const ApiResponseSchema = z.object({
  data: z.any().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});

// Clinic Settings schemas
export const NotificationSettingsSchema = z.object({
  reminder_hours_before: z.union([z.number(), z.string()]),
});

export const BookingRestrictionSettingsSchema = z.object({
  booking_restriction_type: z.string(),
  minimum_booking_hours_ahead: z.union([z.number(), z.string()]),
  deadline_time_day_before: z.string().optional(),
  deadline_on_same_day: z.boolean().optional(),
  step_size_minutes: z.union([z.number(), z.string()]).optional(),
  max_future_appointments: z.union([z.number(), z.string()]).optional(),
  max_booking_window_days: z.union([z.number(), z.string()]).optional(),
  minimum_cancellation_hours_before: z.union([z.number(), z.string()]).optional(),
  allow_patient_deletion: z.boolean().optional(),
});

export const ClinicInfoSettingsSchema = z.object({
  display_name: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  phone_number: z.string().nullable().optional(),
  appointment_type_instructions: z.string().nullable().optional(),
  appointment_notes_instructions: z.string().nullable().optional(),
  require_birthday: z.boolean().optional(),
});

// Strict schemas for forms
export const ClinicInfoFormSchema = z.object({
  display_name: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  phone_number: z.string().nullable().optional(),
  appointment_type_instructions: z.string().nullable().optional(),
  appointment_notes_instructions: z.string().nullable().optional(),
  require_birthday: z.boolean().optional(),
});

export const BookingRestrictionFormSchema = z.object({
  booking_restriction_type: z.string(),
  minimum_booking_hours_ahead: z.coerce.number().min(1, '至少提前 1 小時').max(168, '最多提前 168 小時'),
  deadline_time_day_before: z.string().optional(),
  deadline_on_same_day: z.boolean().optional(),
  step_size_minutes: z.coerce.number().min(5, '至少 5 分鐘').max(60, '最多 60 分鐘'),
  max_future_appointments: z.coerce.number().min(1, '至少 1 次').max(100, '最多 100 次'),
  max_booking_window_days: z.coerce.number().min(1, '至少 1 天').max(365, '最多 365 天'),
  minimum_cancellation_hours_before: z.coerce.number().min(1, '至少 1 小時').max(168, '最多 168 小時'),
  allow_patient_deletion: z.boolean().optional(),
});

export const NotificationFormSchema = z.object({
  reminder_hours_before: z.coerce.number().min(1, '至少 1 小時').max(72, '最多 72 小時'),
});

export const RemindersSettingsFormSchema = z.object({
  notification_settings: NotificationFormSchema,
});

export const ReceiptsSettingsFormSchema = z.object({
  receipt_settings: z.object({
    custom_notes: z.string().nullable().optional(),
    show_stamp: z.boolean().optional(),
  }),
});

export const ChatSettingsFormSchema = z.object({
  chat_settings: z.object({
    chat_enabled: z.boolean(),
    clinic_description: z.string().nullable().optional(),
    therapist_info: z.string().nullable().optional(),
    treatment_details: z.string().nullable().optional(),
    service_item_selection_guide: z.string().nullable().optional(),
    operating_hours: z.string().nullable().optional(),
    location_details: z.string().nullable().optional(),
    booking_policy: z.string().nullable().optional(),
    payment_methods: z.string().nullable().optional(),
    equipment_facilities: z.string().nullable().optional(),
    common_questions: z.string().nullable().optional(),
    other_info: z.string().nullable().optional(),
    ai_guidance: z.string().nullable().optional(),
  }),
});

export const AppointmentsSettingsFormSchema = z.object({
  clinic_info_settings: z.object({
    appointment_type_instructions: z.string().nullable().optional(),
    appointment_notes_instructions: z.string().nullable().optional(),
    require_birthday: z.boolean().optional(),
  }),
  booking_restriction_settings: BookingRestrictionFormSchema,
  practitioners: z.array(z.object({
    id: z.number(),
    full_name: z.string(),
    patient_booking_allowed: z.boolean(),
  })),
});

export const ChatSettingsSchema = z.object({
  chat_enabled: z.boolean(),
  clinic_description: z.string().nullable().optional(),
  therapist_info: z.string().nullable().optional(),
  treatment_details: z.string().nullable().optional(),
  service_item_selection_guide: z.string().nullable().optional(),
  operating_hours: z.string().nullable().optional(),
  location_details: z.string().nullable().optional(),
  booking_policy: z.string().nullable().optional(),
  payment_methods: z.string().nullable().optional(),
  equipment_facilities: z.string().nullable().optional(),
  common_questions: z.string().nullable().optional(),
  other_info: z.string().nullable().optional(),
  ai_guidance: z.string().nullable().optional(),
});

export const ReceiptSettingsSchema = z.object({
  custom_notes: z.string().nullable().optional(),
  show_stamp: z.boolean().optional(),
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
  receipt_name: z.string().nullable().optional(),
  allow_patient_booking: z.boolean().optional(),
  allow_patient_practitioner_selection: z.boolean().optional(),
  description: z.string().nullable().optional(),
  scheduling_buffer_minutes: z.number().optional(),
  service_type_group_id: z.number().nullable().optional(),
  display_order: z.number().optional(),
});

export const ClinicSettingsSchema = z.object({
  clinic_id: z.number(),
  clinic_name: z.string(),
  business_hours: BusinessHoursSchema,
  appointment_types: z.array(AppointmentTypeSchema),
  notification_settings: NotificationSettingsSchema,
  booking_restriction_settings: BookingRestrictionSettingsSchema,
  clinic_info_settings: ClinicInfoSettingsSchema,
  chat_settings: ChatSettingsSchema,
  receipt_settings: ReceiptSettingsSchema.optional(),
  liff_urls: z.record(z.string(), z.string()).optional(), // Dictionary of mode -> URL (excluding 'home')
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

// Resource schemas
export const ResourceTypeSchema = z.object({
  id: z.number(),
  clinic_id: z.number(),
  name: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const ResourceSchema = z.object({
  id: z.number(),
  resource_type_id: z.number(),
  clinic_id: z.number(),
  name: z.string(),
  description: z.string().nullable().optional(),
  is_deleted: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

// Strict Resource Form schemas
export const ResourceTypeFormSchema = z.object({
  name: z.string().min(1, '資源類型名稱不能為空'),
});

export const ResourceFormSchema = z.object({
  name: z.string().min(1, '資源名稱不能為空'),
  description: z.string().nullable().optional(),
});

export const ResourceTypeWithResourcesFormSchema = z.object({
  id: z.number(),
  name: z.string().min(1, '資源類型名稱不能為空'),
  resources: z.array(z.object({
    id: z.number(),
    name: z.string().min(1, '資源名稱不能為空'),
    description: z.string().nullable().optional(),
  })),
});

export const ResourcesSettingsFormSchema = z.object({
  resourceTypes: z.array(ResourceTypeWithResourcesFormSchema),
});
export type ClinicSettings = z.infer<typeof ClinicSettingsSchema>;
export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;
export type BookingRestrictionSettings = z.infer<typeof BookingRestrictionSettingsSchema>;
export type ClinicInfoSettings = z.infer<typeof ClinicInfoSettingsSchema>;
export type ChatSettings = z.infer<typeof ChatSettingsSchema>;
export type ReceiptSettings = z.infer<typeof ReceiptSettingsSchema>;
export type User = z.infer<typeof UserSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
export type SignupResponse = z.infer<typeof SignupResponseSchema>;
export type ApiResponse<T> = z.infer<typeof ApiResponseSchema> & { data?: T };

// Validation helper functions
export function validateClinicSettings(data: unknown): ClinicSettings {
  return ClinicSettingsSchema.parse(data);
}


export function validateSignupResponse(data: unknown): SignupResponse {
  return SignupResponseSchema.parse(data);
}

export function safeParseClinicSettings(data: unknown) {
  return ClinicSettingsSchema.safeParse(data);
}


export function safeParseSignupResponse(data: unknown) {
  return SignupResponseSchema.safeParse(data);
}

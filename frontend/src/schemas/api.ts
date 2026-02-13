import { z } from 'zod';
import { createValidatedSchema } from '../utils/schema-validation';
import { logger } from '../utils/logger';

// Base API response schema
export const ApiResponseSchema = createValidatedSchema(
  z.object({
    data: z.any().optional(),
    error: z.string().optional(),
    message: z.string().optional(),
  }),
  'ApiResponseSchema'
);

// Clinic Settings schemas
export const NotificationSettingsSchema = createValidatedSchema(
  z.object({
    reminder_hours_before: z.union([z.number(), z.string()]),
    reminder_timing_mode: z.enum(['hours_before', 'previous_day']).optional().default('hours_before'),
    reminder_previous_day_time: z.string().optional().default('21:00'),
  }),
  'NotificationSettingsSchema'
);

export const BookingRestrictionSettingsSchema = createValidatedSchema(
  z.object({
    booking_restriction_type: z.string(),
    minimum_booking_hours_ahead: z.union([z.number(), z.string()]),
    deadline_time_day_before: z.string().optional(),
    deadline_on_same_day: z.boolean().optional(),
    step_size_minutes: z.union([z.number(), z.string()]).optional(),
    max_future_appointments: z.union([z.number(), z.string()]).optional(),
    max_booking_window_days: z.union([z.number(), z.string()]).optional(),
    minimum_cancellation_hours_before: z.union([z.number(), z.string()]).optional(),
    allow_patient_deletion: z.boolean().optional(),
  }),
  'BookingRestrictionSettingsSchema'
);

export const ClinicInfoSettingsSchema = createValidatedSchema(
  z.object({
    display_name: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    phone_number: z.string().nullable().optional(),
    appointment_type_instructions: z.string().nullable().optional(),
    appointment_notes_instructions: z.string().nullable().optional(),
    require_birthday: z.boolean().optional(),
    require_gender: z.boolean().optional(),
    restrict_to_assigned_practitioners: z.boolean().optional(),
    query_page_instructions: z.string().nullable().optional(),
    settings_page_instructions: z.string().nullable().optional(),
    notifications_page_instructions: z.string().nullable().optional(),
  }),
  'ClinicInfoSettingsSchema'
);

// Strict schemas for forms
export const ClinicInfoFormSchema = z.object({
  display_name: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  phone_number: z.string().nullable().optional(),
  appointment_type_instructions: z.string().nullable().optional(),
  appointment_notes_instructions: z.string().nullable().optional(),
  require_birthday: z.boolean().optional(),
  require_gender: z.boolean().optional(),
  restrict_to_assigned_practitioners: z.boolean().optional(),
  query_page_instructions: z.string().nullable().optional(),
  settings_page_instructions: z.string().nullable().optional(),
  notifications_page_instructions: z.string().nullable().optional(),
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
  reminder_timing_mode: z.enum(['hours_before', 'previous_day'], {
    errorMap: () => ({ message: '請選擇提醒時間模式' })
  }),
  reminder_previous_day_time: z.string().optional(),
}).superRefine((data, ctx) => {
  // Validate time format if provided
  if (data.reminder_previous_day_time) {
    if (!/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/.test(data.reminder_previous_day_time)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '時間格式必須為 HH:MM',
        path: ['reminder_previous_day_time'],
      });
    }
  }

  // Conditional requirements based on timing mode
  if (data.reminder_timing_mode === 'previous_day') {
    if (!data.reminder_previous_day_time) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '請選擇前一天的提醒時間',
        path: ['reminder_previous_day_time'],
      });
    }
  } else if (data.reminder_timing_mode === 'hours_before') {
    if (!data.reminder_hours_before) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '請輸入提醒的小時數',
        path: ['reminder_hours_before'],
      });
    }
  }
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

const validateAISchedule = (data: { ai_reply_schedule_enabled?: boolean, ai_reply_schedule?: any }, ctx: z.RefinementCtx) => {
  if (data.ai_reply_schedule_enabled && data.ai_reply_schedule) {
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
    days.forEach(day => {
      const periods: any[] = data.ai_reply_schedule![day];
      if (!periods) return;

      // 1. Validate start < end
      periods.forEach((period, index) => {
        if (period.start_time >= period.end_time) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: '開始時間必須早於結束時間',
            path: ['ai_reply_schedule', day, index, 'start_time'],
          });
        }
      });

      // 2. Validate no overlaps
      const sorted = [...periods].sort((a, b) => a.start_time.localeCompare(b.start_time));
      for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i].end_time > sorted[i + 1].start_time) {
          // Find original index for better error mapping
          const originalIndex = periods.findIndex(p => p === sorted[i]);
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: '時段不可重疊',
            path: ['ai_reply_schedule', day, originalIndex, 'end_time'],
          });
        }
      }
    });
  }
};

export const ChatSettingsFormSchema = z.object({
  chat_settings: z.object({
    chat_enabled: z.boolean(),
    label_ai_replies: z.boolean().optional().default(true),
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
    ai_reply_schedule_enabled: z.boolean().optional().default(false),
    ai_reply_schedule: z.object({
      mon: z.array(z.object({ start_time: z.string(), end_time: z.string() })).default([]),
      tue: z.array(z.object({ start_time: z.string(), end_time: z.string() })).default([]),
      wed: z.array(z.object({ start_time: z.string(), end_time: z.string() })).default([]),
      thu: z.array(z.object({ start_time: z.string(), end_time: z.string() })).default([]),
      fri: z.array(z.object({ start_time: z.string(), end_time: z.string() })).default([]),
      sat: z.array(z.object({ start_time: z.string(), end_time: z.string() })).default([]),
      sun: z.array(z.object({ start_time: z.string(), end_time: z.string() })).default([]),
    }).nullable().optional(),
  }).superRefine(validateAISchedule),
});

export const AppointmentsSettingsFormSchema = z.object({
  clinic_info_settings: z.object({
    appointment_type_instructions: z.string().nullable().optional(),
    appointment_notes_instructions: z.string().nullable().optional(),
    require_birthday: z.boolean().optional(),
    require_gender: z.boolean().optional(),
    restrict_to_assigned_practitioners: z.boolean().optional(),
    query_page_instructions: z.string().nullable().optional(),
    settings_page_instructions: z.string().nullable().optional(),
    notifications_page_instructions: z.string().nullable().optional(),
  }).passthrough(),
  booking_restriction_settings: BookingRestrictionFormSchema,
  practitioners: z.array(z.object({
    id: z.number(),
    full_name: z.string(),
    patient_booking_allowed: z.boolean(),
  })),
});

export const ChatSettingsSchema = createValidatedSchema(
  z.object({
    chat_enabled: z.boolean(),
    label_ai_replies: z.boolean().optional().default(true),
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
    ai_reply_schedule_enabled: z.boolean().optional().default(false),
    ai_reply_schedule: z.object({
      mon: z.array(z.object({ start_time: z.string(), end_time: z.string() })).default([]),
      tue: z.array(z.object({ start_time: z.string(), end_time: z.string() })).default([]),
      wed: z.array(z.object({ start_time: z.string(), end_time: z.string() })).default([]),
      thu: z.array(z.object({ start_time: z.string(), end_time: z.string() })).default([]),
      fri: z.array(z.object({ start_time: z.string(), end_time: z.string() })).default([]),
      sat: z.array(z.object({ start_time: z.string(), end_time: z.string() })).default([]),
      sun: z.array(z.object({ start_time: z.string(), end_time: z.string() })).default([]),
    }).nullable().optional(),
  }).superRefine(validateAISchedule),
  'ChatSettingsSchema'
);

export const ReceiptSettingsSchema = createValidatedSchema(
  z.object({
    custom_notes: z.string().nullable().optional(),
    show_stamp: z.boolean().optional(),
  }),
  'ReceiptSettingsSchema'
);

export const BusinessHoursSchema = z.record(z.string(), z.object({
  start: z.string(),
  end: z.string(),
  enabled: z.boolean(),
}));

export const AppointmentTypeSchema = createValidatedSchema(
  z.object({
    id: z.number(),
    clinic_id: z.number(),
    name: z.string().min(1, '請輸入名稱').max(255, '名稱最長 255 字元'),
    duration_minutes: z.number().min(1, '服務時長必須大於 0'),
    receipt_name: z.string().max(255, '收據名稱最長 255 字元').nullable().optional(),
    allow_patient_booking: z.boolean().optional(),
    allow_patient_practitioner_selection: z.boolean().optional(),
    description: z.string().max(1000, '說明最長 1000 字元').nullable().optional(),
    scheduling_buffer_minutes: z.number().min(0).optional(),
    service_type_group_id: z.number().nullable().optional(),
    display_order: z.number().optional(),
    // Message customization fields
    send_patient_confirmation: z.boolean().optional(),
    send_clinic_confirmation: z.boolean().optional(),
    send_reminder: z.boolean().optional(),
    patient_confirmation_message: z.string().max(3500, '訊息最長 3500 字元').optional(),
    clinic_confirmation_message: z.string().max(3500, '訊息最長 3500 字元').optional(),
    reminder_message: z.string().max(3500, '訊息最長 3500 字元').optional(),
    send_recurrent_clinic_confirmation: z.boolean().optional(),
    recurrent_clinic_confirmation_message: z.string().max(3500, '訊息最長 3500 字元').optional(),
    // Notes customization fields
    require_notes: z.boolean().optional(),
    notes_instructions: z.string().max(1000, '備註指引最長 1000 字元').nullable().optional(),
    // Note: follow_up_messages and resource_requirements are intentionally excluded
    // as they are loaded separately via dedicated API endpoints
  }).passthrough(), // Preserve unknown fields to prevent silent data loss.
  'AppointmentTypeSchema'
);
// WARNING: .passthrough() allows unknown fields through without validation.
// This prevents data loss but is less strict - unknown fields won't be type-checked.
// All known fields should be explicitly defined in the schema above.

export const ClinicSettingsSchema = createValidatedSchema(
  z.object({
    clinic_id: z.number(),
    clinic_name: z.string(),
    business_hours: BusinessHoursSchema,
    appointment_types: z.array(AppointmentTypeSchema),
    notification_settings: NotificationSettingsSchema,
    booking_restriction_settings: BookingRestrictionSettingsSchema,
    clinic_info_settings: ClinicInfoSettingsSchema,
    chat_settings: ChatSettingsSchema,
    receipt_settings: ReceiptSettingsSchema.optional(),
    liff_urls: z.record(z.string(), z.string()).nullish(), // Dictionary of mode -> URL
  }),
  'ClinicSettingsSchema'
);


// User/Member schemas
export const UserRoleSchema = z.enum(['admin', 'practitioner']);
export const UserTypeSchema = z.enum(['system_admin', 'clinic_user']);

export const UserSchema = createValidatedSchema(
  z.object({
    id: z.number(),
    email: z.string(),
    full_name: z.string(),
    roles: z.array(UserRoleSchema),
    clinic_id: z.number().optional(),
    user_type: UserTypeSchema,
    created_at: z.string(),
    updated_at: z.string(),
    last_login_at: z.string().optional(),
  }),
  'UserSchema'
);

// Auth schemas
export const AuthUserSchema = createValidatedSchema(
  z.object({
    user_id: z.number(),
    email: z.string(),
    full_name: z.string(),
    roles: z.array(UserRoleSchema),
    clinic_id: z.number().optional(),
    user_type: UserTypeSchema,
  }),
  'AuthUserSchema'
);

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
  name: z.string().min(1, '資源類型名稱不能為空').max(255, '名稱最長 255 字元'),
});

export const ResourceFormSchema = z.object({
  name: z.string().min(1, '資源名稱不能為空').max(255, '名稱最長 255 字元'),
  description: z.string().max(500, '內容最長 500 字元').nullable().optional(),
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
// Bundle schemas
export const BillingScenarioBundleSchema = z.object({
  id: z.number().optional(),
  practitioner_id: z.number(),
  name: z.string().min(1, '請輸入方案名稱').max(255, '名稱最長 255 字元'),
  amount: z.coerce.number().min(0, '金額不能為負數'),
  revenue_share: z.coerce.number().min(0, '分潤不能為負數'),
  is_default: z.boolean(),
}).refine(data => data.amount >= data.revenue_share, {
  message: '金額必須大於或等於分潤',
  path: ['revenue_share'],
});

export const ResourceRequirementBundleSchema = z.object({
  resource_type_id: z.number(),
  resource_type_name: z.string().optional(),
  quantity: z.number().min(1),
});

export const FollowUpMessageBundleSchema = z.object({
  id: z.number().optional(),
  timing_mode: z.enum(['hours_after', 'specific_time']),
  hours_after: z.coerce.number().min(0, '小時數不能為負數').nullable().optional(),
  days_after: z.coerce.number().min(0, '天數不能為負數').nullable().optional(),
  time_of_day: z.string().nullable().optional(), // Regex validation logic moved to refine/superRefine for better error mapping
  message_template: z.string().min(1, '請輸入訊息內容').max(3500, '訊息最長 3500 字元'),
  is_enabled: z.boolean().optional(),
  display_order: z.number().optional(),
}).superRefine((data, ctx) => {
  if (data.timing_mode === 'hours_after') {
    if (data.hours_after === null || data.hours_after === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '小時數為必填',
        path: ['hours_after'],
      });
    }
  } else if (data.timing_mode === 'specific_time') {
    if (data.days_after === null || data.days_after === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '天數為必填',
        path: ['days_after'],
      });
    }
    if (!data.time_of_day || !/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/.test(data.time_of_day)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '時間格式必須為 HH:MM',
        path: ['time_of_day'],
      });
    }
  }
});

export const ServiceItemBundleSchema = z.object({
  name: z.string().min(1, '請輸入項目名稱').max(255, '名稱最長 255 字元'),
  duration_minutes: z.coerce.number().min(1, '服務時長必須大於 0'),
  service_type_group_id: z.number().nullable().optional(),
  allow_new_patient_booking: z.boolean().optional(),
  allow_existing_patient_booking: z.boolean().optional(),
  allow_patient_practitioner_selection: z.boolean().optional(),
  allow_multiple_time_slot_selection: z.boolean().optional(),
  scheduling_buffer_minutes: z.coerce.number().min(0, '緩衝時間不能為負數').optional(),
  receipt_name: z.string().max(255, '收據名稱最長 255 字元').optional(),
  description: z.string().max(1000, '內容最長 1000 字元').optional(),
  require_notes: z.boolean().optional(),
  notes_instructions: z.string().max(1000, '備註填寫指引最長 1000 字元').optional(),

  // Message customization
  send_patient_confirmation: z.boolean().optional(),
  send_clinic_confirmation: z.boolean().optional(),
  send_reminder: z.boolean().optional(),
  patient_confirmation_message: z.string().max(3500, '訊息最長 3500 字元').optional(),
  clinic_confirmation_message: z.string().max(3500, '訊息最長 3500 字元').optional(),
  reminder_message: z.string().max(3500, '訊息最長 3500 字元').optional(),
  send_recurrent_clinic_confirmation: z.boolean().optional(),
  recurrent_clinic_confirmation_message: z.string().max(3500, '訊息最長 3500 字元').optional(),

  // Staged associations (for validation only, not part of AppointmentType strictly)
  follow_up_messages: z.array(FollowUpMessageBundleSchema).optional(),
  practitioner_ids: z.array(z.number()).optional(),
  billing_scenarios: z.array(BillingScenarioBundleSchema).optional(),
  resource_requirements: z.array(ResourceRequirementBundleSchema).optional(),
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
export type ServiceItemBundleFormData = z.infer<typeof ServiceItemBundleSchema>;

// Validation helper functions
export function validateClinicSettings(data: unknown): ClinicSettings {
  const result = ClinicSettingsSchema.safeParse(data);

  if (!result.success) {
    // Log validation errors in development
    if (import.meta.env.DEV) {
      logger.error('ClinicSettings validation failed:', result.error);
      logger.error('Invalid data:', data);
    }
    throw new Error(`Invalid clinic settings: ${result.error.message}`);
  }

  // In development, check for unknown fields that might be silently dropped
  if (import.meta.env.DEV && typeof data === 'object' && data !== null) {
    const validatedKeys = new Set(Object.keys(result.data));
    const inputKeys = new Set(Object.keys(data as Record<string, unknown>));
    const unknownKeys = Array.from(inputKeys).filter(key => !validatedKeys.has(key));

    if (unknownKeys.length > 0) {
      logger.warn(
        'ClinicSettings: Unknown fields detected (may be dropped):',
        unknownKeys,
        '\nThis might indicate a schema mismatch. Check if these fields should be added to the schema.'
      );
    }
  }

  return result.data;
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

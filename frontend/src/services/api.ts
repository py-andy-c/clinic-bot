import axios, { AxiosInstance, AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { tokenRefreshService } from './tokenRefresh';
import { authStorage } from '../utils/storage';
import {
  Clinic,
  Member,
  Patient,
  ClinicCreateData,
  ClinicHealth,
  MemberInviteData,
  OAuthResponse,
  UserRole,
  ClinicsListResponse,
  SwitchClinicResponse,
  PractitionerWithDetails,
  LineUserWithStatus,
  ServiceTypeGroup
} from '../types';
import {
  validateClinicSettings,
  ClinicSettings
} from '../schemas/api';
import {
  DefaultScheduleResponse,
  MonthlyCalendarData,
  DailyCalendarData,
  AvailableSlotsResponse,
  BatchAvailableSlotsResponse,
  AvailabilityExceptionRequest,
  AvailabilityExceptionResponse,
  SchedulingConflictResponse,
  ResourceType,
  Resource,
  ResourceRequirement,
  ResourceAvailabilityResponse
} from '../types';

/**
 * Redirect to login page utility.
 * 
 * Uses requestAnimationFrame to ensure React has finished rendering before redirecting,
 * preventing "useAuth must be used within an AuthProvider" errors.
 */
const redirectToLogin = (): void => {
  if (window.location.pathname === '/admin/login') {
    return;
  }
  
  requestAnimationFrame(() => {
    try {
      window.location.replace('/admin/login');
    } catch (error) {
      logger.error('Failed to redirect to login:', error);
    }
  });
};

export class ApiService {
  private client: AxiosInstance;

  constructor() {

    this.client = axios.create({
      baseURL: config.apiBaseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
    });

    // Configure axios-retry for network errors (not 401 auth errors)
    // 401 errors are handled manually in the response interceptor after token refresh
    axiosRetry(this.client, {
      retries: 2,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error: AxiosError) => {
        // Only retry on network errors, not 401 (handled by interceptor)
        // Don't retry refresh token requests to avoid infinite loops
        const requestUrl = error.config?.url || '';
        const isRefreshRequest = requestUrl.includes('/auth/refresh');
        const isNetworkError = !error.response; // Network error (no response)
        return isNetworkError && !isRefreshRequest;
      },
    });

    // Request interceptor: Inject auth token
    this.client.interceptors.request.use((config) => {
      const token = authStorage.getAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Response interceptor: Handle 401 errors and refresh tokens
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        // Only handle 401 errors (unauthorized)
        if (error.response?.status !== 401) {
          return Promise.reject(error);
        }

        const requestUrl = error.config?.url || '';
        const isRefreshRequest = requestUrl.includes('/auth/refresh');
        
        // Don't handle refresh token requests (avoid infinite loops)
        if (isRefreshRequest) {
          return Promise.reject(error);
        }

        // Check if we have a refresh token
        const refreshToken = authStorage.getRefreshToken();
        if (!refreshToken) {
          logger.warn('ApiService: No refresh token available, logging out');
          authStorage.clearAuth();
          redirectToLogin();
          return Promise.reject(new Error('會話已過期，正在重新導向至登入頁面...'));
        }

        try {
          // Refresh token using centralized service
          // TokenRefreshService handles concurrent refresh requests automatically
          await tokenRefreshService.refreshToken();
          
          // Update request with new token and retry manually
          const newToken = authStorage.getAccessToken();
          if (newToken && error.config) {
            error.config.headers.Authorization = `Bearer ${newToken}`;
            // Manually retry the request with the new token
            return this.client.request(error.config);
          } else {
            throw new Error('重新整理後找不到存取權杖');
          }
        } catch (refreshError) {
          logger.error('ApiService: Token refresh failed:', refreshError);
          
          // Refresh failed - clear auth and redirect to login
          authStorage.clearAuth();
          redirectToLogin();
          return Promise.reject(new Error('會話已過期，正在重新導向至登入頁面...'));
        }
      }
    );
  }

  // Authentication methods
  async initiateGoogleAuth(userType?: 'system_admin' | 'clinic_user'): Promise<OAuthResponse> {
    const params = userType ? { user_type: userType } : {};
    return this.client.get('/auth/google/login', { params }).then(res => res.data);
  }



  async logout(): Promise<void> {
    const refreshToken = authStorage.getRefreshToken();
    if (refreshToken) {
      await this.client.post('/auth/logout', { refresh_token: refreshToken });
    }
    authStorage.clearAuth();
  }

  // Clinic switching methods
  async listAvailableClinics(includeInactive: boolean = false): Promise<ClinicsListResponse> {
    const response = await this.client.get('/auth/clinics', {
      params: { include_inactive: includeInactive }
    });
    return response.data;
  }

  async switchClinic(clinicId: number): Promise<SwitchClinicResponse> {
    const response = await this.client.post('/auth/switch-clinic', {
      clinic_id: clinicId
    });
    return response.data;
  }

  // System Admin APIs

  async getClinics(signal?: AbortSignal): Promise<Clinic[]> {
    const config = signal ? { signal } : {};
    const response = await this.client.get('/system/clinics', config);
    return response.data;
  }

  async createClinic(clinicData: ClinicCreateData): Promise<Clinic> {
    const response = await this.client.post('/system/clinics', clinicData);
    return response.data;
  }

  async getClinicDetails(clinicId: number): Promise<Clinic> {
    const response = await this.client.get(`/system/clinics/${clinicId}`);
    return response.data;
  }

  async updateClinic(clinicId: number, clinicData: Partial<ClinicCreateData>): Promise<Clinic> {
    const response = await this.client.put(`/system/clinics/${clinicId}`, clinicData);
    return response.data;
  }

  async getClinicHealth(clinicId: number): Promise<ClinicHealth> {
    const response = await this.client.get(`/system/clinics/${clinicId}/health`);
    return response.data;
  }

  async generateClinicSignupLink(clinicId: number): Promise<{ signup_url: string }> {
    const response = await this.client.post(`/system/clinics/${clinicId}/signup-link`);
    return response.data;
  }

  async getClinicPractitioners(clinicId: number): Promise<{ practitioners: PractitionerWithDetails[] }> {
    const response = await this.client.get(`/system/clinics/${clinicId}/practitioners`);
    return response.data;
  }

  // Clinic APIs

  async getMembers(signal?: AbortSignal): Promise<Member[]> {
    const config = signal ? { signal } : {};
    const response = await this.client.get('/clinic/members', config);
    return response.data.members;
  }

  async getPractitioners(appointmentTypeId?: number, signal?: AbortSignal): Promise<{ id: number; full_name: string }[]> {
    const config = signal ? { signal } : {};
    const params = appointmentTypeId ? { appointment_type_id: appointmentTypeId } : {};

    try {
      const response = await this.client.get('/clinic/practitioners', { ...config, params });
      return response.data.practitioners;
    } catch (error) {
      const err = error as any;
      logger.error('Failed to fetch practitioners', {
        message: err?.message,
        status: err?.response?.status,
        url: err?.config?.url,
        appointmentTypeId
      });
      throw error;
    }
  }

  async inviteMember(inviteData: MemberInviteData): Promise<{ signup_url: string; expires_at: string }> {
    const response = await this.client.post('/clinic/members/invite', inviteData);
    return response.data;
  }

  async updateMemberRoles(userId: number, roles: UserRole[]): Promise<void> {
    await this.client.put(`/clinic/members/${userId}/roles`, { roles });
  }

  async removeMember(userId: number): Promise<void> {
    await this.client.delete(`/clinic/members/${userId}`);
  }

  async reactivateMember(userId: number): Promise<void> {
    await this.client.post(`/clinic/members/${userId}/reactivate`);
  }


  async getPatients(
    page?: number,
    pageSize?: number,
    signal?: AbortSignal,
    search?: string,
    practitionerId?: number
  ): Promise<{ patients: Patient[]; total: number; page: number; page_size: number }> {
    const config = signal ? { signal } : {};
    const params: Record<string, string> = {};
    if (page !== undefined) params.page = page.toString();
    if (pageSize !== undefined) params.page_size = pageSize.toString();
    if (search !== undefined && search.trim()) params.search = search.trim();
    if (practitionerId !== undefined) params.practitioner_id = practitionerId.toString();
    const response = await this.client.get('/clinic/patients', { ...config, params });
    return response.data;
  }

  async getPatient(patientId: number): Promise<Patient> {
    const response = await this.client.get(`/clinic/patients/${patientId}`);
    return response.data;
  }

  async updatePatient(patientId: number, data: {
    full_name?: string;
    phone_number?: string | null;
    birthday?: string;
    gender?: string;
    notes?: string | null;
    assigned_practitioner_ids?: number[];
  }): Promise<Patient> {
    const response = await this.client.put(`/clinic/patients/${patientId}`, data);
    return response.data;
  }

  async assignPractitionerToPatient(patientId: number, practitionerId: number): Promise<Patient> {
    const response = await this.client.post(`/clinic/patients/${patientId}/assign-practitioner`, {
      user_id: practitionerId,
    });
    return response.data;
  }

  async removePractitionerAssignment(patientId: number, practitionerId: number): Promise<Patient> {
    const response = await this.client.delete(`/clinic/patients/${patientId}/assign-practitioner/${practitionerId}`);
    return response.data;
  }

  async getPatientAppointments(
    patientId: number,
    status?: 'confirmed' | 'canceled_by_patient' | 'canceled_by_clinic',
    upcomingOnly?: boolean
  ): Promise<{
    appointments: Array<{
      id: number;  // calendar_event_id (kept for backward compatibility)
      calendar_event_id: number;
      patient_id: number;
      patient_name: string;
      practitioner_id: number;
      practitioner_name: string;
      appointment_type_id: number;
      appointment_type_name: string;
      event_name: string;  // Effective calendar event name (custom_event_name or default format)
      start_time: string;
      end_time: string;
      status: string;
      notes?: string | null;
      line_display_name?: string | null;
      originally_auto_assigned?: boolean;
      has_active_receipt?: boolean;
      has_any_receipt?: boolean;
      receipt_id?: number | null;
      receipt_ids?: number[];
    }>;
  }> {
    const params: Record<string, string> = {};
    if (status) params.status = status;
    if (upcomingOnly !== undefined) params.upcoming_only = upcomingOnly.toString();
    const response = await this.client.get(`/clinic/patients/${patientId}/appointments`, { params });
    return response.data;
  }

  async createPatient(data: {
    full_name: string;
    phone_number?: string | null;
    birthday?: string;
    gender?: string;
  }): Promise<{
    patient_id: number;
    full_name: string;
    phone_number: string | null;
    birthday?: string | null;
    gender?: string | null;
    created_at: string;
  }> {
    const response = await this.client.post('/clinic/patients', {
      full_name: data.full_name.trim(),
      phone_number: data.phone_number?.trim() || null,
      birthday: data.birthday || undefined,
      gender: data.gender || undefined,
    });
    return response.data;
  }

  async checkDuplicatePatientName(name: string): Promise<{ count: number }> {
    const response = await this.client.get('/clinic/patients/check-duplicate', {
      params: { name: name.trim() },
    });
    return response.data;
  }

  async getAutoAssignedAppointments(): Promise<{
    appointments: Array<{
      appointment_id: number;
      calendar_event_id: number;
      patient_name: string;
      patient_id: number;
      practitioner_id: number;
      practitioner_name: string;
      appointment_type_id: number;
      appointment_type_name: string;
      start_time: string;
      end_time: string;
      notes?: string | null;
      originally_auto_assigned: boolean;
      resource_names: string[];
      resource_ids: number[];
    }>;
  }> {
    const response = await this.client.get('/clinic/pending-review-appointments');
    return response.data;
  }

  async getLineUsers(
    page?: number,
    pageSize?: number,
    signal?: AbortSignal,
    search?: string
  ): Promise<{ line_users: LineUserWithStatus[]; total: number; page: number; page_size: number }> {
    const config = signal ? { signal } : {};
    const params: Record<string, string> = {};
    if (page !== undefined) params.page = page.toString();
    if (pageSize !== undefined) params.page_size = pageSize.toString();
    if (search !== undefined && search.trim()) params.search = search.trim();
    const response = await this.client.get('/clinic/line-users', { ...config, params });
    return response.data;
  }

  async disableAiForLineUser(lineUserId: string, reason?: string): Promise<void> {
    await this.client.post(`/clinic/line-users/${lineUserId}/disable-ai`, { reason });
  }

  async enableAiForLineUser(lineUserId: string): Promise<void> {
    await this.client.post(`/clinic/line-users/${lineUserId}/enable-ai`);
  }

  async updateLineUserDisplayName(lineUserId: string, clinicDisplayName: string | null): Promise<LineUserWithStatus> {
    const response = await this.client.put(`/clinic/line-users/${lineUserId}/display-name`, {
      clinic_display_name: clinicDisplayName
    });
    return response.data;
  }

  async updateCalendarEventName(calendarEventId: number, eventName: string | null): Promise<{ success: boolean; message: string; calendar_event_id: number; event_name: string | null }> {
    const response = await this.client.put(`/clinic/calendar-events/${calendarEventId}/event-name`, {
      event_name: eventName
    });
    return response.data;
  }

  async getClinicSettings(): Promise<ClinicSettings> {
    const response = await this.client.get('/clinic/settings');
    return validateClinicSettings(response.data);
  }

  async updateClinicSettings(settings: ClinicSettings): Promise<ClinicSettings> {
    const response = await this.client.put('/clinic/settings', settings);
    // Note: We don't validate the response here since it's just a success message
    return response.data;
  }

  async generateReminderPreview(data: {
    appointment_type: string;
    appointment_time: string;
    therapist_name: string;
  }): Promise<{ preview_message: string }> {
    const response = await this.client.post('/clinic/reminder-preview', data);
    return response.data;
  }

  async generateCancellationPreview(data: {
    appointment_type: string;
    appointment_time: string;
    therapist_name: string;
    patient_name: string;
    note?: string;
  }): Promise<{ preview_message: string }> {
    const response = await this.client.post('/clinic/cancellation-preview', data);
    return response.data;
  }

  async testChatbot(data: {
    message: string;
    session_id?: string | null;
    chat_settings: any;
  }): Promise<{ response: string; session_id: string }> {
    // Use longer timeout for AI responses (60 seconds)
    const response = await this.client.post('/clinic/chat/test', data, {
      timeout: 60000,
    });
    return response.data;
  }


  async validateAppointmentTypeDeletion(appointmentTypeIds: number[]): Promise<{ can_delete: boolean; error?: any; message?: string }> {
    const response = await this.client.post('/clinic/appointment-types/validate-deletion', {
      appointment_type_ids: appointmentTypeIds
    });
    return response.data;
  }

  // Billing scenario endpoints (admin-only)
  async getBillingScenarios(serviceItemId: number, practitionerId: number): Promise<{ billing_scenarios: any[] }> {
    const response = await this.client.get(
      `/clinic/service-items/${serviceItemId}/practitioners/${practitionerId}/billing-scenarios`
    );
    return response.data;
  }

  async createBillingScenario(
    serviceItemId: number,
    practitionerId: number,
    scenario: { name: string; amount: number; revenue_share: number; is_default: boolean }
  ): Promise<any> {
    const response = await this.client.post(
      `/clinic/service-items/${serviceItemId}/practitioners/${practitionerId}/billing-scenarios`,
      scenario
    );
    return response.data;
  }

  async updateBillingScenario(
    serviceItemId: number,
    practitionerId: number,
    scenarioId: number,
    scenario: { name?: string; amount?: number; revenue_share?: number; is_default?: boolean }
  ): Promise<any> {
    const response = await this.client.put(
      `/clinic/service-items/${serviceItemId}/practitioners/${practitionerId}/billing-scenarios/${scenarioId}`,
      scenario
    );
    return response.data;
  }

  async deleteBillingScenario(serviceItemId: number, practitionerId: number, scenarioId: number): Promise<void> {
    await this.client.delete(
      `/clinic/service-items/${serviceItemId}/practitioners/${practitionerId}/billing-scenarios/${scenarioId}`
    );
  }

  // Receipt/Checkout endpoints (admin-only)
  async checkoutAppointment(
    appointmentId: number,
    items: Array<{
      item_type: 'service_item' | 'other';
      service_item_id?: number;
      practitioner_id?: number;
      billing_scenario_id?: number;
      item_name?: string;
      amount: number;
      revenue_share: number;
      display_order: number;
      quantity: number;
    }>,
    payment_method: string
  ): Promise<any> {
    const response = await this.client.post(`/appointments/${appointmentId}/checkout`, {
      items,
      payment_method,
    });
    return response.data;
  }

  async getReceiptForAppointment(appointmentId: number): Promise<any> {
    const response = await this.client.get(`/appointments/${appointmentId}/receipt`);
    return response.data;
  }

  async getReceiptById(receiptId: number): Promise<any> {
    const response = await this.client.get(`/receipts/${receiptId}`);
    return response.data;
  }

  async getAppointmentDetails(appointmentId: number): Promise<{
    id: number;
    calendar_event_id: number;
    patient_id: number;
    patient_name: string;
    practitioner_id: number | null;
    practitioner_name: string;
    appointment_type_id: number;
    appointment_type_name: string;
    event_name: string;
    start_time: string;
    end_time: string;
    status: string;
    notes?: string | null;
    clinic_notes?: string | null;
    line_display_name?: string | null;
    originally_auto_assigned: boolean;
    is_auto_assigned: boolean;
    has_active_receipt: boolean;
    has_any_receipt: boolean;
    receipt_id?: number | null;
    receipt_ids: number[];
  }> {
    const response = await this.client.get(`/clinic/appointments/${appointmentId}`);
    return response.data;
  }

  async voidReceipt(receiptId: number, reason: string): Promise<any> {
    const response = await this.client.post(`/receipts/${receiptId}/void`, {
      reason: reason,
    });
    return response.data;
  }

  async downloadReceiptPDF(receiptId: number): Promise<Blob> {
    const response = await this.client.get(`/receipts/${receiptId}/download`, {
      responseType: 'blob',
    });
    return response.data;
  }

  async getReceiptHtml(receiptId: number): Promise<string> {
    const response = await this.client.get(`/receipts/${receiptId}/html`, {
      responseType: 'text',
    });
    return response.data;
  }

  async getReceiptPreview(customNotes: string | null, showStamp: boolean): Promise<string> {
    const response = await this.client.post('/clinic/settings/receipts/preview', {
      custom_notes: customNotes,
      show_stamp: showStamp,
    }, {
      responseType: 'text',
    });
    return response.data;
  }

  // Practitioner Availability APIs (Updated for new schema)
  async getPractitionerDefaultSchedule(userId: number): Promise<DefaultScheduleResponse> {
    const response = await this.client.get(`/clinic/practitioners/${userId}/availability/default`);
    return response.data;
  }

  async updatePractitionerDefaultSchedule(userId: number, scheduleData: DefaultScheduleResponse): Promise<DefaultScheduleResponse> {
    const response = await this.client.put(`/clinic/practitioners/${userId}/availability/default`, scheduleData);
    return response.data;
  }

  // Practitioner Calendar APIs
  async getMonthlyCalendar(userId: number, month: string, page: number = 1, limit: number = 31): Promise<MonthlyCalendarData> {
    const params = { month, page, limit };
    const response = await this.client.get(`/clinic/practitioners/${userId}/availability/calendar`, { params });
    return response.data;
  }

  async getDailyCalendar(userId: number, date: string): Promise<DailyCalendarData> {
    const params = { date };
    const response = await this.client.get(`/clinic/practitioners/${userId}/availability/calendar`, { params });
    return response.data;
  }

  async getBatchCalendar(data: {
    practitionerIds: number[];
    startDate: string;
    endDate: string;
  }): Promise<{
    results: Array<{
      user_id: number;
      date: string;
      default_schedule: any;
      events: any[];
    }>;
  }> {
    const response = await this.client.post('/clinic/practitioners/calendar/batch', {
      practitioner_ids: data.practitionerIds,
      start_date: data.startDate,
      end_date: data.endDate,
    });
    return response.data;
  }

  async getAvailableSlots(userId: number, date: string, appointmentTypeId: number, excludeCalendarEventId?: number): Promise<AvailableSlotsResponse> {
    const params: { date: string; appointment_type_id: number; exclude_calendar_event_id?: number } = { date, appointment_type_id: appointmentTypeId };
    if (excludeCalendarEventId !== undefined) {
      params.exclude_calendar_event_id = excludeCalendarEventId;
    }
    const response = await this.client.get(`/clinic/practitioners/${userId}/availability/slots`, { params });
    return response.data;
  }

  // Resource Calendar APIs
  async getResourceCalendar(resourceId: number, date: string): Promise<{
    resource_id: number;
    date: string;
    events: any[];
  }> {
    const params = { date };
    const response = await this.client.get(`/clinic/resources/${resourceId}/availability/calendar`, { params });
    return response.data;
  }

  async getBatchResourceCalendar(data: {
    resourceIds: number[];
    startDate: string;
    endDate: string;
  }): Promise<{
    results: Array<{
      resource_id: number;
      date: string;
      events: any[];
    }>;
  }> {
    const response = await this.client.post('/clinic/resources/calendar/batch', {
      resource_ids: data.resourceIds,
      start_date: data.startDate,
      end_date: data.endDate,
    });
    return response.data;
  }

  async getBatchAvailableSlots(
    userId: number,
    dates: string[],
    appointmentTypeId: number,
    excludeCalendarEventId?: number,
    signal?: AbortSignal
  ): Promise<BatchAvailableSlotsResponse> {
    const config = signal ? { signal } : {};
    const requestBody: {
      dates: string[];
      appointment_type_id: number;
      exclude_calendar_event_id?: number;
    } = {
      dates,
      appointment_type_id: appointmentTypeId,
    };
    if (excludeCalendarEventId !== undefined) {
      requestBody.exclude_calendar_event_id = excludeCalendarEventId;
    }
    const response = await this.client.post(
      `/clinic/practitioners/${userId}/availability/slots/batch`,
      requestBody,
      config
    );
    return response.data;
  }

  // Availability Exception APIs
  async createAvailabilityException(userId: number, exceptionData: AvailabilityExceptionRequest): Promise<AvailabilityExceptionResponse> {
    const response = await this.client.post(`/clinic/practitioners/${userId}/availability/exceptions`, exceptionData);
    return response.data;
  }

  async deleteAvailabilityException(userId: number, exceptionId: number): Promise<{ message: string }> {
    const response = await this.client.delete(`/clinic/practitioners/${userId}/availability/exceptions/${exceptionId}`);
    return response.data;
  }

  async checkSchedulingConflicts(
    userId: number,
    date: string,
    startTime: string,
    appointmentTypeId: number,
    excludeCalendarEventId?: number,
    signal?: AbortSignal
  ): Promise<SchedulingConflictResponse> {
    const config: any = {
      params: {
        date,
        start_time: startTime,
        appointment_type_id: appointmentTypeId,
      }
    };
    if (excludeCalendarEventId !== undefined) {
      config.params.exclude_calendar_event_id = excludeCalendarEventId;
    }
    if (signal) {
      config.signal = signal;
    }
    const response = await this.client.get(`/clinic/practitioners/${userId}/availability/conflicts`, config);
    return response.data;
  }

  // Appointment Management APIs
  async cancelClinicAppointment(appointmentId: number, note?: string): Promise<{ success: boolean; message: string; appointment_id: number }> {
    const params = note ? { note } : {};
    const response = await this.client.delete(`/clinic/appointments/${appointmentId}`, { params });
    return response.data;
  }

  async createClinicAppointment(data: {
    patient_id: number;
    appointment_type_id: number;
    start_time: string; // ISO datetime string
    practitioner_id?: number | null;
    clinic_notes?: string;
    selected_resource_ids?: number[];
  }): Promise<{ success: boolean; appointment_id: number; message: string }> {
    const response = await this.client.post('/clinic/appointments', data);
    return response.data;
  }

  async checkRecurringConflicts(data: {
    practitioner_id: number;
    appointment_type_id: number;
    occurrences: string[]; // List of ISO datetime strings
  }): Promise<{
    occurrences: Array<{
      start_time: string;
      has_conflict: boolean;
      conflict_type: string | null;
      appointment_conflict: {
        appointment_id: number;
        patient_name: string;
        start_time: string;
        end_time: string;
        appointment_type: string;
      } | null;
      exception_conflict: {
        exception_id: number;
        start_time: string;
        end_time: string;
        reason: string | null;
      } | null;
      default_availability: {
        is_within_hours: boolean;
        normal_hours: string | null;
      };
      // Additional fields for duplicate detection
      is_duplicate: boolean;
      duplicate_index: number | null;
    }>;
  }> {
    const response = await this.client.post('/clinic/appointments/check-recurring-conflicts', data);
    return response.data;
  }

  async createRecurringAppointments(data: {
    patient_id: number;
    appointment_type_id: number;
    practitioner_id: number;
    clinic_notes?: string;
    occurrences: Array<{ start_time: string; selected_resource_ids?: number[] }>;
  }): Promise<{
    success: boolean;
    created_count: number;
    failed_count: number;
    created_appointments: Array<{
      appointment_id: number;
      start_time: string;
      end_time: string;
    }>;
    failed_occurrences: Array<{
      start_time: string;
      error_code: string;
      error_message: string;
    }>;
  }> {
    const response = await this.client.post('/clinic/appointments/recurring', data);
    return response.data;
  }

  async previewEditNotification(appointmentId: number, data: {
    new_practitioner_id?: number | null;
    new_start_time?: string | null; // ISO datetime string
    note?: string;
  }): Promise<{
    preview_message: string | null;
    old_appointment_details: {
      practitioner_id: number;
      start_time: string;
      is_auto_assigned: boolean;
    };
    new_appointment_details: {
      practitioner_id: number;
      start_time: string;
    };
    conflicts: string[];
    is_valid: boolean;
    will_send_notification: boolean;
  }> {
    const response = await this.client.post(`/clinic/appointments/${appointmentId}/edit-preview`, data);
    return response.data;
  }

  async previewAppointmentMessage(data: {
    appointment_type_id?: number;
    message_type: 'patient_confirmation' | 'clinic_confirmation' | 'reminder';
    template: string;
    sample_patient_name?: string;
    sample_appointment_time?: string;
    sample_appointment_type_name?: string;
  }): Promise<{
    preview_message: string;
    used_placeholders: Record<string, string>;
    completeness_warnings?: string[];
    clinic_info_availability?: {
      has_address?: boolean;
      has_phone?: boolean;
    };
  }> {
    const response = await this.client.post('/clinic/appointment-message-preview', data);
    return response.data;
  }

  async editClinicAppointment(appointmentId: number, data: {
    appointment_type_id?: number | null;
    practitioner_id?: number | null;
    start_time?: string | null; // ISO datetime string
    clinic_notes?: string;
    notification_note?: string; // Optional note for notification (does not update appointment.notes)
    selected_resource_ids?: number[];
  }): Promise<{ success: boolean; appointment_id: number; message: string }> {
    const response = await this.client.put(`/clinic/appointments/${appointmentId}`, data);
    return response.data;
  }

  // Practitioner Appointment Type Management APIs
  async getPractitionerAppointmentTypes(userId: number): Promise<{ practitioner_id: number; appointment_types: { id: number; clinic_id: number; name: string; duration_minutes: number }[] }> {
    const response = await this.client.get(`/clinic/practitioners/${userId}/appointment-types`);
    return response.data;
  }

  async updatePractitionerAppointmentTypes(userId: number, appointmentTypeIds: number[]): Promise<{ success: boolean; message: string }> {
    const response = await this.client.put(`/clinic/practitioners/${userId}/appointment-types`, {
      appointment_type_ids: appointmentTypeIds
    });
    return response.data;
  }

  async updatePractitionerSettings(userId: number, settings: Record<string, any>): Promise<{ success: boolean; message: string }> {
    const response = await this.client.put(`/clinic/practitioners/${userId}/settings`, {
      settings
    });
    return response.data;
  }

  // Practitioner Status Check APIs (for admin warnings)
  async getPractitionerStatus(userId: number): Promise<{
    has_appointment_types: boolean;
    has_availability: boolean;
    appointment_types_count: number;
  }> {
    const response = await this.client.get(`/clinic/practitioners/${userId}/status`);
    return response.data;
  }

  async getBatchPractitionerStatus(practitionerIds: number[]): Promise<{
    results: Array<{
      user_id: number;
      has_appointment_types: boolean;
      has_availability: boolean;
      appointment_types_count: number;
    }>;
  }> {
    const response = await this.client.post('/clinic/practitioners/status/batch', {
      practitioner_ids: practitionerIds,
    });
    return response.data;
  }

  // Profile Management APIs
  async getProfile(): Promise<any> {
    const response = await this.client.get('/profile');
    return response.data;
  }

  async updateProfile(profileData: { full_name?: string; settings?: { compact_schedule_enabled?: boolean } }): Promise<any> {
    const response = await this.client.put('/profile', profileData);
    return response.data;
  }

  async generateLinkCode(): Promise<{ code: string; expires_at: string }> {
    const response = await this.client.post('/profile/link-code');
    return response.data;
  }

  async unlinkLineAccount(): Promise<{ message: string }> {
    const response = await this.client.delete('/profile/unlink-line');
    return response.data;
  }


  // Signup APIs (public)
  async initiateClinicSignup(token: string): Promise<OAuthResponse> {
    const response = await this.client.get(`/signup/clinic?token=${token}`);
    return response.data;
  }

  async initiateMemberSignup(token: string): Promise<OAuthResponse & { clinic?: { id: number; name: string; display_name: string } }> {
    const response = await this.client.get(`/signup/member?token=${token}`);
    return response.data;
  }

  async confirmName(token: string, fullName: string): Promise<{ redirect_url: string; refresh_token: string }> {
    const response = await this.client.post(`/signup/confirm-name?token=${token}`, { full_name: fullName });
    return response.data;
  }

  async joinClinicAsExistingUser(token: string, name?: string): Promise<{
    association_created: boolean;
    clinic_id: number;
    switch_clinic: boolean;
    clinic: {
      id: number;
      name: string;
      display_name: string;
    };
  }> {
    const response = await this.client.post(`/signup/member/join-existing?token=${token}`, {
      name: name || undefined
    });
    return response.data;
  }

  async getDashboardMetrics(): Promise<{
    months: Array<{ year: number; month: number; display_name: string; is_current: boolean }>;
    active_patients_by_month: Array<{ month: { year: number; month: number; display_name: string; is_current: boolean }; count: number }>;
    new_patients_by_month: Array<{ month: { year: number; month: number; display_name: string; is_current: boolean }; count: number }>;
    appointments_by_month: Array<{ month: { year: number; month: number; display_name: string; is_current: boolean }; count: number }>;
    cancellation_rate_by_month: Array<{
      month: { year: number; month: number; display_name: string; is_current: boolean };
      canceled_by_clinic_count: number;
      canceled_by_clinic_percentage: number;
      canceled_by_patient_count: number;
      canceled_by_patient_percentage: number;
      total_canceled_count: number;
      total_cancellation_rate: number;
    }>;
    appointment_type_stats_by_month: Array<{
      month: { year: number; month: number; display_name: string; is_current: boolean };
      appointment_type_id: number;
      appointment_type_name: string;
      count: number;
      percentage: number;
    }>;
    practitioner_stats_by_month: Array<{
      month: { year: number; month: number; display_name: string; is_current: boolean };
      user_id: number;
      practitioner_name: string;
      count: number;
      percentage: number;
    }>;
    paid_messages_by_month: Array<{
      month: { year: number; month: number; display_name: string; is_current: boolean };
      recipient_type: string | null;
      event_type: string | null;
      event_display_name: string;
      trigger_source: string | null;
      count: number;
    }>;
    ai_reply_messages_by_month: Array<{
      month: { year: number; month: number; display_name: string; is_current: boolean };
      recipient_type: string | null;
      event_type: string | null;
      event_display_name: string;
      trigger_source: string | null;
      count: number;
    }>;
  }> {
    const response = await this.client.get('/clinic/dashboard/metrics');
    return response.data;
  }

  // Business Insights API
  async getBusinessInsights(params: {
    start_date: string;
    end_date: string;
    practitioner_id?: number | string | null; // Can be number, 'null' string, or null
    service_item_id?: number | string | null; // Can be number or 'custom:name'
    service_type_group_id?: number | string | null; // Can be number, '-1' for ungrouped, or null
  }): Promise<{
    summary: {
      total_revenue: number;
      valid_receipt_count: number;
      service_item_count: number;
      active_patients: number;
      average_transaction_amount: number;
    };
    revenue_trend: Array<{
      date: string;
      total: number;
      by_service: Record<string, number>;
      by_practitioner: Record<string, number>;
      by_group?: Record<string, number>;
    }>;
    by_service: Array<{
      service_item_id: number | null;
      service_item_name: string;
      receipt_name: string;
      is_custom: boolean;
      total_revenue: number;
      item_count: number;
      percentage: number;
    }>;
    by_practitioner: Array<{
      practitioner_id: number | null;
      practitioner_name: string;
      total_revenue: number;
      item_count: number;
      percentage: number;
    }>;
    by_group?: Array<{
      service_type_group_id: number | null;
      group_name: string;
      total_revenue: number;
      item_count: number;
      percentage: number;
    }>;
  }> {
    const response = await this.client.get('/clinic/dashboard/business-insights', { params });
    return response.data;
  }

  // Revenue Distribution API
  async getRevenueDistribution(params: {
    start_date: string;
    end_date: string;
    practitioner_id?: number | string | null; // Can be number, 'null' string, or null
    service_item_id?: number | string | null;
    service_type_group_id?: number | string | null; // Can be number, '-1' for ungrouped, or null
    show_overwritten_only?: boolean;
    page?: number;
    page_size?: number;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
  }): Promise<{
    summary: {
      total_revenue: number;
      total_clinic_share: number;
      receipt_item_count: number;
    };
    items: Array<{
      receipt_id: number;
      receipt_number: string;
      date: string;
      patient_name: string;
      service_item_id: number | null;
      service_item_name: string;
      receipt_name: string;
      is_custom: boolean;
      quantity: number;
      practitioner_id: number | null;
      practitioner_name: string | null;
      billing_scenario: string;
      amount: number;
      revenue_share: number;
      appointment_id: number | null;
    }>;
    total: number;
    page: number;
    page_size: number;
  }> {
    const response = await this.client.get('/clinic/dashboard/revenue-distribution', { params });
    return response.data;
  }

  // Resource Management APIs
  async getResourceTypes(): Promise<{ resource_types: ResourceType[] }> {
    const response = await this.client.get('/clinic/resource-types');
    return response.data;
  }

  async createResourceType(data: { name: string }): Promise<ResourceType> {
    const response = await this.client.post('/clinic/resource-types', data);
    return response.data;
  }

  async updateResourceType(resourceTypeId: number, data: { name: string }): Promise<ResourceType> {
    const response = await this.client.put(`/clinic/resource-types/${resourceTypeId}`, data);
    return response.data;
  }

  async deleteResourceType(resourceTypeId: number): Promise<{ success: boolean; message: string }> {
    const response = await this.client.delete(`/clinic/resource-types/${resourceTypeId}`);
    return response.data;
  }

  async getResources(resourceTypeId: number): Promise<{ resources: Resource[] }> {
    const response = await this.client.get(`/clinic/resource-types/${resourceTypeId}/resources`);
    return response.data;
  }

  async createResource(resourceTypeId: number, data: { name?: string; description?: string }): Promise<Resource> {
    const response = await this.client.post(`/clinic/resource-types/${resourceTypeId}/resources`, data);
    return response.data;
  }

  async updateResource(resourceId: number, data: { name: string; description?: string }): Promise<Resource> {
    const response = await this.client.put(`/clinic/resources/${resourceId}`, data);
    return response.data;
  }

  async deleteResource(resourceId: number): Promise<{ success: boolean; message: string }> {
    const response = await this.client.delete(`/clinic/resources/${resourceId}`);
    return response.data;
  }

  async getAppointmentTypesByResourceType(resourceTypeId: number): Promise<{ appointment_types: Array<{ id: number; name: string; required_quantity: number }> }> {
    const response = await this.client.get(`/clinic/resource-types/${resourceTypeId}/appointment-types`);
    return response.data;
  }

  async getResourceRequirements(appointmentTypeId: number): Promise<{ requirements: ResourceRequirement[] }> {
    const response = await this.client.get(`/clinic/appointment-types/${appointmentTypeId}/resource-requirements`);
    return response.data;
  }

  async createResourceRequirement(
    appointmentTypeId: number,
    data: { resource_type_id: number; quantity: number }
  ): Promise<ResourceRequirement> {
    const response = await this.client.post(`/clinic/appointment-types/${appointmentTypeId}/resource-requirements`, data);
    return response.data;
  }

  async updateResourceRequirement(
    appointmentTypeId: number,
    requirementId: number,
    data: { quantity: number }
  ): Promise<ResourceRequirement> {
    const response = await this.client.put(
      `/clinic/appointment-types/${appointmentTypeId}/resource-requirements/${requirementId}`,
      data
    );
    return response.data;
  }

  async deleteResourceRequirement(
    appointmentTypeId: number,
    requirementId: number
  ): Promise<{ success: boolean; message: string }> {
    const response = await this.client.delete(
      `/clinic/appointment-types/${appointmentTypeId}/resource-requirements/${requirementId}`
    );
    return response.data;
  }

  async getResourceAvailability(params: {
    appointment_type_id: number;
    practitioner_id: number;
    date: string;
    start_time: string;
    end_time: string;
    exclude_calendar_event_id?: number;
  }, signal?: AbortSignal): Promise<ResourceAvailabilityResponse> {
    const config = signal ? { signal, params } : { params };
    const response = await this.client.get('/clinic/appointments/resource-availability', config);
    return response.data;
  }

  async getAppointmentResources(appointmentId: number, signal?: AbortSignal): Promise<{ resources: Resource[] }> {
    const config = signal ? { signal } : {};
    const response = await this.client.get(`/clinic/appointments/${appointmentId}/resources`, config);
    return response.data;
  }

  async updateAppointmentResources(
    appointmentId: number,
    resourceIds: number[]
  ): Promise<{ success: boolean; message: string }> {
    const response = await this.client.put(`/clinic/appointments/${appointmentId}/resources`, resourceIds);
    return response.data;
  }

  async sendCustomNotification(_data: {
    patient_id: number;
    message: string;
    event_type: string;
  }): Promise<{ success: boolean }> {
    // TODO: Implement custom notification endpoint in backend
    throw new Error('Custom notification feature is not yet implemented');
  }

  // Service Type Group Management
  async getServiceTypeGroups(): Promise<{ groups: ServiceTypeGroup[] }> {
    const response = await this.client.get('/clinic/service-type-groups');
    return response.data;
  }

  async createServiceTypeGroup(data: { name: string; display_order?: number }): Promise<ServiceTypeGroup> {
    const response = await this.client.post('/clinic/service-type-groups', data);
    return response.data;
  }

  async updateServiceTypeGroup(groupId: number, data: { name?: string; display_order?: number }): Promise<ServiceTypeGroup> {
    const response = await this.client.put(`/clinic/service-type-groups/${groupId}`, data);
    return response.data;
  }

  async deleteServiceTypeGroup(groupId: number): Promise<{ success: boolean; message: string }> {
    const response = await this.client.delete(`/clinic/service-type-groups/${groupId}`);
    return response.data;
  }

  async bulkUpdateGroupOrder(groupOrders: Array<{ id: number; display_order: number }>): Promise<{ success: boolean; message: string }> {
    const response = await this.client.put('/clinic/service-type-groups/bulk-order', { group_orders: groupOrders });
    return response.data;
  }

  async bulkUpdateAppointmentTypeOrder(serviceOrders: Array<{ id: number; display_order: number }>): Promise<{ success: boolean; message: string }> {
    const response = await this.client.put('/clinic/appointment-types/bulk-order', { service_orders: serviceOrders });
    return response.data;
  }

  // Follow-Up Message Management APIs
  async getFollowUpMessages(appointmentTypeId: number): Promise<{ follow_up_messages: Array<{
    id: number;
    appointment_type_id: number;
    clinic_id: number;
    timing_mode: 'hours_after' | 'specific_time';
    hours_after?: number | null;
    days_after?: number | null;
    time_of_day?: string | null;
    message_template: string;
    is_enabled: boolean;
    display_order: number;
    created_at: string;
    updated_at: string;
  }> }> {
    const response = await this.client.get(`/clinic/appointment-types/${appointmentTypeId}/follow-up-messages`);
    return response.data;
  }

  async createFollowUpMessage(appointmentTypeId: number, data: {
    timing_mode: 'hours_after' | 'specific_time';
    hours_after?: number;
    days_after?: number;
    time_of_day?: string;
    message_template: string;
    is_enabled?: boolean;
    display_order?: number;
  }): Promise<{
    id: number;
    appointment_type_id: number;
    clinic_id: number;
    timing_mode: 'hours_after' | 'specific_time';
    hours_after?: number | null;
    days_after?: number | null;
    time_of_day?: string | null;
    message_template: string;
    is_enabled: boolean;
    display_order: number;
    created_at: string;
    updated_at: string;
  }> {
    const response = await this.client.post(`/clinic/appointment-types/${appointmentTypeId}/follow-up-messages`, data);
    return response.data;
  }

  async updateFollowUpMessage(
    appointmentTypeId: number,
    messageId: number,
    data: {
      timing_mode?: 'hours_after' | 'specific_time';
      hours_after?: number;
      days_after?: number;
      time_of_day?: string;
      message_template?: string;
      is_enabled?: boolean;
      display_order?: number;
    }
  ): Promise<{
    id: number;
    appointment_type_id: number;
    clinic_id: number;
    timing_mode: 'hours_after' | 'specific_time';
    hours_after?: number | null;
    days_after?: number | null;
    time_of_day?: string | null;
    message_template: string;
    is_enabled: boolean;
    display_order: number;
    created_at: string;
    updated_at: string;
  }> {
    const response = await this.client.put(`/clinic/appointment-types/${appointmentTypeId}/follow-up-messages/${messageId}`, data);
    return response.data;
  }

  async deleteFollowUpMessage(appointmentTypeId: number, messageId: number): Promise<{ success: boolean; message: string }> {
    const response = await this.client.delete(`/clinic/appointment-types/${appointmentTypeId}/follow-up-messages/${messageId}`);
    return response.data;
  }

  async previewFollowUpMessage(data: {
    appointment_type_id?: number;
    appointment_type_name?: string;
    timing_mode: 'hours_after' | 'specific_time';
    hours_after?: number;
    days_after?: number;
    time_of_day?: string;
    message_template: string;
  }): Promise<{
    preview_message: string;
    used_placeholders: Record<string, string>;
    completeness_warnings?: string[];
  }> {
    const response = await this.client.post('/clinic/follow-up-message-preview', data);
    return response.data;
  }
}

export const apiService = new ApiService();

// Shared fetch functions for useApiData to ensure cache key consistency
// These are stable function references that multiple components can share
export const sharedFetchFunctions = {
  getPractitioners: () => apiService.getPractitioners(),
  getClinicSettings: () => apiService.getClinicSettings(),
  getMembers: () => apiService.getMembers(),
};

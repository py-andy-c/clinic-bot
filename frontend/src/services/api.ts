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
  LineUserWithStatus
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
  AvailabilityExceptionResponse
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

  async getPractitioners(signal?: AbortSignal): Promise<{ id: number; full_name: string }[]> {
    const config = signal ? { signal } : {};
    const response = await this.client.get('/clinic/practitioners', config);
    return response.data.practitioners;
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
    search?: string
  ): Promise<{ patients: Patient[]; total: number; page: number; page_size: number }> {
    const config = signal ? { signal } : {};
    const params: Record<string, string> = {};
    if (page !== undefined) params.page = page.toString();
    if (pageSize !== undefined) params.page_size = pageSize.toString();
    if (search !== undefined && search.trim()) params.search = search.trim();
    const response = await this.client.get('/clinic/patients', { ...config, params });
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

  async getBatchAvailableSlots(
    userId: number,
    dates: string[],
    appointmentTypeId: number,
    excludeCalendarEventId?: number
  ): Promise<BatchAvailableSlotsResponse> {
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
      requestBody
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
    notes?: string;
  }): Promise<{ success: boolean; appointment_id: number; message: string }> {
    const response = await this.client.post('/clinic/appointments', data);
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

  async editClinicAppointment(appointmentId: number, data: {
    practitioner_id?: number | null;
    start_time?: string | null; // ISO datetime string
    notes?: string;
    notification_note?: string; // Optional note for notification (does not update appointment.notes)
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
}

export const apiService = new ApiService();

// Shared fetch functions for useApiData to ensure cache key consistency
// These are stable function references that multiple components can share
export const sharedFetchFunctions = {
  getPractitioners: () => apiService.getPractitioners(),
  getClinicSettings: () => apiService.getClinicSettings(),
  getMembers: () => apiService.getMembers(),
};

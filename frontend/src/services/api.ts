import axios, { AxiosInstance } from 'axios';
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
  AuthUser
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
  AvailabilityExceptionRequest,
  AvailabilityExceptionResponse,
  PractitionerAvailability
} from '../types';

/**
 * Delay before redirecting to login page (in milliseconds).
 * 
 * This delay ensures React has finished rendering before we redirect,
 * preventing "useAuth must be used within an AuthProvider" errors that occur
 * when window.location.replace() is called during React's rendering cycle.
 * 
 * requestAnimationFrame waits for the next frame (~16ms at 60fps), which is
 * typically sufficient for React to finish rendering. Set to 0 to use only
 * requestAnimationFrame, or increase if additional delay is needed.
 */
const REDIRECT_DELAY_MS = 0; // Using requestAnimationFrame only (no additional delay needed)

export class ApiService {
  private client: AxiosInstance;
  private sessionExpired = false; // Flag to prevent multiple redirects
  private redirectInProgress = false; // Flag to prevent multiple redirects

  constructor() {
    // Reset session expired flag if we have a token (user might have logged in before)
    const token = authStorage.getAccessToken();
    if (token) {
      this.sessionExpired = false;
    }

    this.client = axios.create({
      baseURL: config.apiBaseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
    });

    // Add request interceptor to include auth token
    this.client.interceptors.request.use((config) => {
      const token = authStorage.getAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        // Reset session expired flag if we have a token
        this.sessionExpired = false;
      }
      return config;
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;

        // If session already expired, immediately redirect without processing
        if (this.sessionExpired) {
          return Promise.reject(new Error('會話已過期，正在重新導向至登入頁面...'));
        }

        // Prevent infinite loops - don't retry refresh token requests
        // Check if this is a refresh token endpoint request (works with both full URL and path)
        const requestUrl = originalRequest.url || '';
        const isRefreshRequest = requestUrl.includes('/auth/refresh');
        
        // Skip retry if already retried, if not a 401, or if this is a refresh request
        if (originalRequest._retry || error.response?.status !== 401 || isRefreshRequest) {
          return Promise.reject(error);
        }

        originalRequest._retry = true;

        // Check if we have a refresh token before attempting refresh
        const refreshToken = authStorage.getRefreshToken();
        if (!refreshToken) {
          logger.warn('ApiService: No refresh token available, logging out');
          this.sessionExpired = true;
          authStorage.clearAuth();
          this.redirectToLogin();
          return Promise.reject(new Error('會話已過期，正在重新導向至登入頁面...'));
        }

        try {
          // Use centralized token refresh service (handles duplicate requests automatically)
          // The TokenRefreshService uses refreshInProgress promise to prevent concurrent refreshes
          // Refresh service creates its own client to avoid interceptor loops
          await tokenRefreshService.refreshToken({ 
            validateToken: false
          });

          // Reset session expired flag after successful refresh (before retry)
          // This ensures the flag is cleared even if retry fails for other reasons
          this.sessionExpired = false;
          
          // Retry the original request with the new access token
          const token = authStorage.getAccessToken();
          if (token) {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            // Clear the retry flag to allow retry
            originalRequest._retry = false;
            // Reset timeout for retry to ensure we have full timeout available
            // Create a new request config to avoid timeout issues
            const retryConfig = {
              ...originalRequest,
              timeout: 10000, // Reset timeout to full 10 seconds
            };
            const retryResponse = await this.client.request(retryConfig);
            // Reset session expired flag after successful refresh and retry
            this.sessionExpired = false;
            return retryResponse;
          } else {
            throw new Error('重新整理後找不到存取權杖');
          }
        } catch (refreshError: any) {
          logger.error('ApiService: Token refresh or retry failed:', refreshError);
          
          // Refresh failed (session expired), clear auth state and redirect to login
          // This handles cases where:
          // - Refresh token is invalid/expired
          // - Refresh token is missing
          // - Network error during refresh
          this.sessionExpired = true;
          authStorage.clearAuth();
          this.redirectToLogin();
          
          // Return a rejected promise with a special error that won't cause infinite loops
          return Promise.reject(new Error('會話已過期，正在重新導向至登入頁面...'));
        }

        return Promise.reject(error);
      }
    );
  }

  // Authentication methods
  async initiateGoogleAuth(userType?: 'system_admin' | 'clinic_user'): Promise<OAuthResponse> {
    const params = userType ? { user_type: userType } : {};
    return this.client.get('/auth/google/login', { params }).then(res => res.data);
  }

  /**
   * Reset the session expired flag - called when we successfully get a new token
   * Can be called publicly when login succeeds from outside the service
   */
  resetSessionExpired(): void {
    this.sessionExpired = false;
    this.redirectInProgress = false;
  }

  /**
   * Redirect to login page with delay to avoid interrupting React rendering.
   * 
   * Prevents multiple redirects from happening simultaneously and ensures React
   * has finished rendering before redirecting, which prevents "useAuth must be
   * used within an AuthProvider" errors.
   * 
   * Uses requestAnimationFrame to wait for the next frame, ensuring React has
   * finished rendering before the redirect occurs.
   */
  private redirectToLogin(): void {
    // Prevent multiple redirects
    if (this.redirectInProgress) {
      return;
    }
    
    this.redirectInProgress = true;
    
    // Use requestAnimationFrame to ensure redirect happens after React has finished rendering
    // This prevents "useAuth must be used within an AuthProvider" errors that occur
    // when window.location.replace() is called during React's rendering cycle
    requestAnimationFrame(() => {
      if (REDIRECT_DELAY_MS > 0) {
        setTimeout(() => {
          window.location.replace('/login');
        }, REDIRECT_DELAY_MS);
      } else {
        // No additional delay needed - requestAnimationFrame is sufficient
        window.location.replace('/login');
      }
    });
  }


  async logout(): Promise<void> {
    const refreshToken = authStorage.getRefreshToken();
    if (refreshToken) {
      await this.client.post('/auth/logout', { refresh_token: refreshToken });
    }
    authStorage.clearAuth();
  }

  /**
   * Verify the current access token and get user data
   * This goes through the axios interceptor which handles token refresh automatically
   */
  async verifyToken(): Promise<AuthUser> {
    const response = await this.client.get('/auth/verify');
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

  async getClinicHealth(clinicId: number): Promise<ClinicHealth> {
    const response = await this.client.get(`/system/clinics/${clinicId}/health`);
    return response.data;
  }

  async generateClinicSignupLink(clinicId: number): Promise<{ signup_url: string }> {
    const response = await this.client.post(`/system/clinics/${clinicId}/signup-link`);
    return response.data;
  }

  // Clinic APIs

  async getMembers(signal?: AbortSignal): Promise<Member[]> {
    const config = signal ? { signal } : {};
    const response = await this.client.get('/clinic/members', config);
    return response.data.members;
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


  async getPatients(signal?: AbortSignal): Promise<Patient[]> {
    const config = signal ? { signal } : {};
    const response = await this.client.get('/clinic/patients', config);
    return response.data.patients;
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

  async getAvailableSlots(userId: number, date: string, appointmentTypeId: number): Promise<AvailableSlotsResponse> {
    const params = { date, appointment_type_id: appointmentTypeId };
    const response = await this.client.get(`/clinic/practitioners/${userId}/availability/slots`, { params });
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

  // Legacy availability APIs (deprecated, kept for backward compatibility)
  async getPractitionerAvailability(userId: number): Promise<PractitionerAvailability[]> {
    const response = await this.client.get(`/clinic/practitioners/${userId}/availability`);
    return response.data.availability;
  }

  async createPractitionerAvailability(userId: number, availabilityData: { day_of_week: number; start_time: string; end_time: string }): Promise<PractitionerAvailability> {
    const response = await this.client.post(`/clinic/practitioners/${userId}/availability`, availabilityData);
    return response.data;
  }

  async updatePractitionerAvailability(userId: number, availabilityId: number, availabilityData: { day_of_week: number; start_time: string; end_time: string }): Promise<PractitionerAvailability> {
    const response = await this.client.put(`/clinic/practitioners/${userId}/availability/${availabilityId}`, availabilityData);
    return response.data;
  }

  async deletePractitionerAvailability(userId: number, availabilityId: number): Promise<void> {
    await this.client.delete(`/clinic/practitioners/${userId}/availability/${availabilityId}`);
  }

  // Appointment Management APIs
  async cancelClinicAppointment(appointmentId: number, note?: string): Promise<{ success: boolean; message: string; appointment_id: number }> {
    const params = note ? { note } : {};
    const response = await this.client.delete(`/clinic/appointments/${appointmentId}`, { params });
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

  // Profile Management APIs
  async getProfile(): Promise<any> {
    const response = await this.client.get('/profile');
    return response.data;
  }

  async updateProfile(profileData: { full_name?: string }): Promise<any> {
    const response = await this.client.put('/profile', profileData);
    return response.data;
  }


  // Signup APIs (public)
  async initiateClinicSignup(token: string): Promise<OAuthResponse> {
    const response = await this.client.get(`/signup/clinic?token=${token}`);
    return response.data;
  }

  async initiateMemberSignup(token: string): Promise<OAuthResponse> {
    const response = await this.client.get(`/signup/member?token=${token}`);
    return response.data;
  }

  async confirmName(token: string, fullName: string): Promise<{ redirect_url: string; refresh_token: string }> {
    const response = await this.client.post(`/signup/confirm-name?token=${token}`, { full_name: fullName });
    return response.data;
  }
}

export const apiService = new ApiService();

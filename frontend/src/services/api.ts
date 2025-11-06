import axios, { AxiosInstance } from 'axios';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { tokenRefreshService } from './tokenRefresh';
import { ApiErrorType, AxiosErrorResponse } from '../types';
import {
  Clinic,
  Member,
  Patient,
  ClinicCreateData,
  ClinicHealth,
  MemberInviteData,
  OAuthResponse,
  UserRole
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

export class ApiService {
  private client: AxiosInstance;
  private refreshTokenPromise: Promise<void> | null = null;
  private isRefreshing = false;
  private sessionExpired = false; // Flag to prevent multiple redirects

  constructor() {
    // Reset session expired flag if we have a token (user might have logged in before)
    const token = localStorage.getItem('access_token');
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
      // Enable credentials (cookies) for cross-origin requests
      // Required for refresh token cookies when frontend is on Vercel and backend on Railway
      withCredentials: true,
    });

    // Add request interceptor to include auth token
    this.client.interceptors.request.use((config) => {
      const token = localStorage.getItem('access_token');
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

        // Capture current token before refresh attempt
        const accessTokenBeforeRefresh = localStorage.getItem('access_token');

        try {
          // Check if refresh is already in progress (using centralized service)
          const refreshInProgress = tokenRefreshService.isRefreshing() || this.isRefreshing;
          
          // Queue requests if refresh is already in progress
          if (refreshInProgress && this.refreshTokenPromise) {
            await this.refreshTokenPromise;
          } else {
            this.isRefreshing = true;
            this.refreshTokenPromise = this.refreshToken().finally(() => {
              this.isRefreshing = false;
            });
            await this.refreshTokenPromise;
          }

          // Retry with new token
          const token = localStorage.getItem('access_token');
          if (token) {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return this.client.request(originalRequest);
          }
        } catch (refreshError: any) {
          // Check if this is a CORS/network error (refresh might have succeeded on backend)
          const isCorsError = !refreshError.response && 
            (refreshError.code === 'ERR_NETWORK' || 
             refreshError.message?.includes('CORS') ||
             refreshError.message?.includes('access control') ||
             refreshError.message?.includes('Load failed'));
          
          if (isCorsError) {
            logger.log('ApiService: CORS error during refresh - checking if current token is still valid', {
              hasAccessToken: !!localStorage.getItem('access_token'),
              accessTokenBeforeRefresh: !!accessTokenBeforeRefresh,
              timestamp: new Date().toISOString()
            });
            
            // When CORS blocks the response, we can't get the new token
            // But the backend might have refreshed successfully
            // Check if our current token is still valid (might have been refreshed by another request)
            const currentToken = localStorage.getItem('access_token');
            if (currentToken) {
              try {
                // Try to validate the current token - it might have been refreshed by another request
                const verifyResponse = await this.client.get('/auth/verify', {
                  headers: { Authorization: `Bearer ${currentToken}` }
                });
                if (verifyResponse.status === 200) {
                  logger.log('ApiService: Current token is still valid after CORS error - refresh may have succeeded', {
                    timestamp: new Date().toISOString()
                  });
                  this.resetSessionExpired();
                  // Retry the original request with the current token
                  originalRequest.headers.Authorization = `Bearer ${currentToken}`;
                  return this.client.request(originalRequest);
                }
              } catch (verifyError: any) {
                logger.warn('ApiService: Current token validation failed after CORS error', {
                  error: verifyError.message,
                  timestamp: new Date().toISOString()
                });
              }
            }
            
            // Wait a moment and check again - another request might have refreshed the token
            await new Promise(resolve => setTimeout(resolve, 100)); // Reduced from 300ms
            const tokenAfterWait = localStorage.getItem('access_token');
            if (tokenAfterWait && tokenAfterWait !== currentToken) {
              logger.log('ApiService: New token appeared after wait - refresh succeeded via another request', {
                timestamp: new Date().toISOString()
              });
              try {
                const verifyResponse = await this.client.get('/auth/verify', {
                  headers: { Authorization: `Bearer ${tokenAfterWait}` }
                });
                if (verifyResponse.status === 200) {
                  this.resetSessionExpired();
                  originalRequest.headers.Authorization = `Bearer ${tokenAfterWait}`;
                  return this.client.request(originalRequest);
                }
              } catch (verifyError) {
                logger.warn('ApiService: New token validation failed', {
                  error: verifyError instanceof Error ? verifyError.message : String(verifyError),
                  timestamp: new Date().toISOString()
                });
              }
            }
          }
          
          // Refresh failed (session expired), clear auth state and redirect to login
          this.sessionExpired = true; // Mark session as expired to prevent further attempts
          this.isRefreshing = false;
          // Clear localStorage to ensure auth state is cleared
          localStorage.removeItem('access_token');
          localStorage.removeItem('was_logged_in');
          // Refresh flag is now managed by TokenRefreshService
          
          // Use replace instead of href to prevent back navigation issues
          // This immediately redirects without waiting for async operations
          window.location.replace('/login');
          
          // Return a rejected promise with a special error that won't cause infinite loops
          // The redirect happens immediately, so components won't be stuck loading
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
  }

  async refreshToken(): Promise<void> {
    try {
      // Use centralized token refresh service
      // Pass axios instance to use existing interceptors
      await tokenRefreshService.refreshToken({
        validateToken: false, // Don't validate here, just refresh token
        axiosInstance: this.client,
      });

      this.resetSessionExpired();
      logger.log('ApiService: Token refresh successful');
    } catch (error: ApiErrorType) {
      logger.error('ApiService: Token refresh failed with exception:', error);

      // Set session expired flag for 401 errors
      if (typeof error === 'object' && error && 'response' in error) {
        const axiosError = error as AxiosErrorResponse;
        if (axiosError.response?.status === 401) {
          this.sessionExpired = true;
        }
      }

      throw error;
    }
  }

  async logout(): Promise<void> {
    await this.client.post('/auth/logout', {}, { withCredentials: true });
    localStorage.removeItem('access_token');
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

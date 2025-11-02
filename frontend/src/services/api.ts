import axios, { AxiosInstance } from 'axios';
import { config } from '../config/env';
import {
  // AuthUser,
  Clinic,
  Member,
  Patient,
  ClinicCreateData,
  ClinicUpdateData,
  ClinicHealth,
  SignupTokenInfo,
  MemberInviteData,
  OAuthResponse,
  UserRole
} from '../types';
import {
  validateClinicSettings,
  validateSignupResponse,
  ClinicSettings,
  SignupResponse
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

class ApiService {
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
          return Promise.reject(new Error('Session expired. Redirecting to login...'));
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

        try {
          // Queue requests if refresh is already in progress
          if (this.isRefreshing) {
            await this.refreshTokenPromise;
          } else {
            this.isRefreshing = true;
            this.refreshTokenPromise = this.refreshToken();
            await this.refreshTokenPromise;
            this.isRefreshing = false;
          }

          // Retry with new token
          const token = localStorage.getItem('access_token');
          if (token) {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return this.client.request(originalRequest);
          }
        } catch (refreshError: any) {
          // Refresh failed (session expired), clear auth state and redirect to login
          this.sessionExpired = true; // Mark session as expired to prevent further attempts
          this.isRefreshing = false;
          // Clear localStorage to ensure auth state is cleared
          localStorage.removeItem('access_token');
          localStorage.removeItem('was_logged_in');
          
          // Use replace instead of href to prevent back navigation issues
          // This immediately redirects without waiting for async operations
          window.location.replace('/login');
          
          // Return a rejected promise with a special error that won't cause infinite loops
          // The redirect happens immediately, so components won't be stuck loading
          return Promise.reject(new Error('Session expired. Redirecting to login...'));
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
      // Note: The interceptor checks the URL to prevent infinite refresh loops
      // If /auth/refresh returns 401, the interceptor won't retry
      const response = await this.client.post('/auth/refresh', {}, { 
        withCredentials: true
      });
      if (response.status === 200 && response.data.access_token) {
        localStorage.setItem('access_token', response.data.access_token);
        // Reset session expired flag on successful refresh
        this.resetSessionExpired();
      } else {
        // Refresh failed - throw error to be caught by interceptor
        throw new Error('Token refresh failed');
      }
    } catch (error: any) {
      // If refresh token is invalid (401), ensure we clear auth state
      if (error.response?.status === 401) {
        localStorage.removeItem('access_token');
        localStorage.removeItem('was_logged_in');
        throw error;
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

  async updateClinic(clinicId: number, clinicData: ClinicUpdateData): Promise<Clinic> {
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

  async initiateMemberGcalAuth(userId: number): Promise<OAuthResponse> {
    const response = await this.client.get(`/clinic/members/${userId}/gcal/auth`);
    return response.data;
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

  async updateAvailabilityException(userId: number, exceptionId: number, exceptionData: Partial<AvailabilityExceptionRequest>): Promise<AvailabilityExceptionResponse> {
    const response = await this.client.put(`/clinic/practitioners/${userId}/availability/exceptions/${exceptionId}`, exceptionData);
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
  async cancelClinicAppointment(appointmentId: number): Promise<{ success: boolean; message: string; appointment_id: number }> {
    const response = await this.client.delete(`/clinic/appointments/${appointmentId}`);
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
  async validateSignupToken(token: string, type: 'clinic' | 'member'): Promise<SignupTokenInfo> {
    const response = await this.client.get(`/signup/${type}`, { params: { token } });
    return response.data;
  }

  async initiateClinicSignup(token: string): Promise<OAuthResponse> {
    const response = await this.client.get(`/signup/clinic?token=${token}`);
    return response.data;
  }

  async initiateMemberSignup(token: string): Promise<OAuthResponse> {
    const response = await this.client.get(`/signup/member?token=${token}`);
    return response.data;
  }

  async completeClinicSignup(token: string): Promise<SignupResponse> {
    const response = await this.client.post('/signup/callback', { token, type: 'clinic' });
    return validateSignupResponse(response.data);
  }

  async completeMemberSignup(token: string): Promise<SignupResponse> {
    const response = await this.client.post('/signup/callback', { token, type: 'member' });
    return validateSignupResponse(response.data);
  }

  async confirmName(token: string, fullName: string): Promise<{ redirect_url: string; refresh_token: string }> {
    const response = await this.client.post(`/signup/confirm-name?token=${token}`, { full_name: fullName });
    return response.data;
  }
}

export const apiService = new ApiService();

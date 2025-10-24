import axios, { AxiosInstance } from 'axios';
import {
  // AuthUser,
  Clinic,
  Member,
  Patient,
  ClinicDashboardStats,
  SystemDashboardStats,
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
  validateClinicDashboardStats,
  validateSignupResponse,
  ClinicSettings,
  SignupResponse
} from '../schemas/api';

class ApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: (import.meta as any).env?.VITE_API_BASE_URL || '/api',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor to include auth token
    this.client.interceptors.request.use((config) => {
      const token = localStorage.getItem('access_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          // Token expired or invalid, try refresh
          if (localStorage.getItem('access_token')) {
            // Trigger refresh and retry
            this.refreshToken().then(() => {
              // Retry the original request
              const token = localStorage.getItem('access_token');
              if (token) {
                error.config.headers.Authorization = `Bearer ${token}`;
                return axios.request(error.config);
              }
              return Promise.reject(error);
            }).catch(() => {
              // Refresh failed, redirect to login
              window.location.href = '/auth/google/login';
              return Promise.reject(error);
            });
          } else {
            // No token, redirect to login
            window.location.href = '/auth/google/login';
          }
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

  async refreshToken(): Promise<void> {
    const response = await this.client.post('/auth/refresh', {}, { withCredentials: true });
    if (response.data.access_token) {
      localStorage.setItem('access_token', response.data.access_token);
    }
  }

  async logout(): Promise<void> {
    await this.client.post('/auth/logout', {}, { withCredentials: true });
    localStorage.removeItem('access_token');
  }

  // System Admin APIs
  async getSystemDashboard(): Promise<SystemDashboardStats> {
    const response = await this.client.get('/system/dashboard');
    return response.data;
  }

  async getClinics(): Promise<Clinic[]> {
    const response = await this.client.get('/system/clinics');
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
  async getClinicDashboard(): Promise<ClinicDashboardStats> {
    const response = await this.client.get('/clinic/dashboard');
    return validateClinicDashboardStats(response.data);
  }

  async getMembers(): Promise<Member[]> {
    const response = await this.client.get('/clinic/members');
    return response.data.members;
  }

  async inviteMember(inviteData: MemberInviteData): Promise<{ signup_url: string }> {
    const response = await this.client.post('/clinic/members/invite', inviteData);
    return response.data;
  }

  async updateMemberRoles(userId: number, roles: UserRole[]): Promise<void> {
    await this.client.put(`/clinic/members/${userId}/roles`, { roles });
  }

  async removeMember(userId: number): Promise<void> {
    await this.client.delete(`/clinic/members/${userId}`);
  }

  async initiateMemberGcalAuth(userId: number): Promise<OAuthResponse> {
    const response = await this.client.get(`/clinic/members/${userId}/gcal/auth`);
    return response.data;
  }

  async getPatients(): Promise<Patient[]> {
    const response = await this.client.get('/clinic/patients');
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

  async getCalendarEmbed(): Promise<{ embed_url: string; practitioners: any[] }> {
    const response = await this.client.get('/clinic/calendar/embed');
    return response.data;
  }

  // Practitioner Availability APIs
  async getPractitionerAvailability(userId: number): Promise<any[]> {
    const response = await this.client.get(`/clinic/practitioners/${userId}/availability`);
    return response.data.availability;
  }

  async createPractitionerAvailability(userId: number, availabilityData: any): Promise<any> {
    const response = await this.client.post(`/clinic/practitioners/${userId}/availability`, availabilityData);
    return response.data;
  }

  async updatePractitionerAvailability(userId: number, availabilityId: number, availabilityData: any): Promise<any> {
    const response = await this.client.put(`/clinic/practitioners/${userId}/availability/${availabilityId}`, availabilityData);
    return response.data;
  }

  async deletePractitionerAvailability(userId: number, availabilityId: number): Promise<void> {
    await this.client.delete(`/clinic/practitioners/${userId}/availability/${availabilityId}`);
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

  async getCalendarSettings(): Promise<{ gcal_sync_enabled: boolean; gcal_watch_resource_id?: string }> {
    const response = await this.client.get('/profile/calendar');
    return response.data;
  }

  async updateCalendarSettings(calendarData: { gcal_sync_enabled?: boolean }): Promise<{ gcal_sync_enabled: boolean; gcal_watch_resource_id?: string }> {
    const response = await this.client.put('/profile/calendar', calendarData);
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
}

export const apiService = new ApiService();

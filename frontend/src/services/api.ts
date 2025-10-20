import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { ApiResponse } from '../types';

class ApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          // Redirect to login on unauthorized
          window.location.href = '/auth/google/login';
        }
        return Promise.reject(error);
      }
    );
  }

  // Generic request methods
  async get<T>(url: string, params?: any): Promise<T> {
    const response = await this.client.get<ApiResponse<T>>(url, { params });
    if (response.data.error) {
      throw new Error(response.data.error);
    }
    return response.data.data || response.data;
  }

  async post<T>(url: string, data?: any): Promise<T> {
    const response = await this.client.post<ApiResponse<T>>(url, data);
    if (response.data.error) {
      throw new Error(response.data.error);
    }
    return response.data.data || response.data;
  }

  async put<T>(url: string, data?: any): Promise<T> {
    const response = await this.client.put<ApiResponse<T>>(url, data);
    if (response.data.error) {
      throw new Error(response.data.error);
    }
    return response.data.data || response.data;
  }

  async delete<T>(url: string): Promise<T> {
    const response = await this.client.delete<ApiResponse<T>>(url);
    if (response.data.error) {
      throw new Error(response.data.error);
    }
    return response.data.data || response.data;
  }

  // Authentication methods
  async initiateGoogleAuth(): Promise<{ auth_url: string }> {
    return this.get('/auth/google/login');
  }

  // Therapist management
  async getTherapists(): Promise<any[]> {
    return this.get('/admin/therapists');
  }

  async inviteTherapist(email: string, name: string): Promise<any> {
    return this.post('/admin/therapists', { email, name });
  }

  async initiateTherapistGcalAuth(therapistId: number): Promise<{ auth_url: string }> {
    return this.get(`/admin/therapists/${therapistId}/gcal/auth`);
  }

  // Patient management
  async getPatients(): Promise<any[]> {
    return this.get('/admin/patients');
  }

  // Settings management
  async getSettings(): Promise<any> {
    return this.get('/admin/settings');
  }

  async updateSettings(settings: any): Promise<any> {
    return this.put('/admin/settings', settings);
  }

  // Dashboard
  async getDashboardStats(): Promise<any> {
    return this.get('/admin/dashboard');
  }

  // Provider endpoints
  async getProviderDashboard(): Promise<any> {
    return this.get('/provider/dashboard');
  }

  async getProviderClinics(): Promise<any[]> {
    return this.get('/provider/clinics');
  }

  async createProviderClinic(clinicData: any): Promise<any> {
    return this.post('/provider/clinics', clinicData);
  }

  async getProviderClinicDetails(clinicId: number): Promise<any> {
    return this.get(`/provider/clinics/${clinicId}`);
  }

  async updateProviderClinic(clinicId: number, clinicData: any): Promise<any> {
    return this.put(`/provider/clinics/${clinicId}`, clinicData);
  }
}

export const apiService = new ApiService();

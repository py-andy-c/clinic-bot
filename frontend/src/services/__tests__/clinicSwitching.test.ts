/**
 * Integration tests for clinic switching API methods.
 * 
 * Tests the listAvailableClinics and switchClinic methods
 * to ensure they work correctly with the backend API.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { authStorage } from '../../utils/storage';

// Mock axios before importing apiService
vi.mock('axios');
const mockedAxios = vi.mocked(axios);

// Mock storage
vi.mock('../../utils/storage', () => ({
  authStorage: {
    getAccessToken: vi.fn(),
    getRefreshToken: vi.fn(),
    setAccessToken: vi.fn(),
    setRefreshToken: vi.fn(),
    clearAuth: vi.fn(),
  },
}));

// Mock tokenRefreshService
vi.mock('../tokenRefresh', () => ({
  tokenRefreshService: {
    refreshToken: vi.fn(),
    isRefreshing: vi.fn(() => false),
  },
}));

// Mock config
vi.mock('../../config/env', () => ({
  config: {
    apiBaseUrl: 'http://localhost:8000',
  },
}));

describe('Clinic Switching API', () => {
  let mockAxiosInstance: any;
  let apiService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module cache to allow re-import with fresh mocks
    vi.resetModules();
    
    mockAxiosInstance = {
      get: vi.fn(),
      post: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    };
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
    (authStorage.getAccessToken as any).mockReturnValue('test-access-token');
  });

  // Import apiService after mocks are set up in a separate beforeEach
  beforeEach(async () => {
    const apiModule = await import('../api');
    apiService = apiModule.apiService;
  });

  describe('listAvailableClinics', () => {
    it('should fetch available clinics successfully', async () => {
      const mockResponse = {
        data: {
          clinics: [
            {
              id: 1,
              name: 'Clinic A',
              display_name: 'Clinic A',
              roles: ['admin'],
              is_active: true,
              last_accessed_at: '2025-01-15T10:00:00Z',
            },
            {
              id: 2,
              name: 'Clinic B',
              display_name: 'Clinic B',
              roles: ['practitioner'],
              is_active: true,
              last_accessed_at: '2025-01-14T10:00:00Z',
            },
          ],
          active_clinic_id: 1,
        },
      };

      mockAxiosInstance.get.mockResolvedValueOnce(mockResponse);

      const result = await apiService.listAvailableClinics();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/auth/clinics', {
        params: { include_inactive: false },
      });
      expect(result.clinics).toHaveLength(2);
      expect(result.clinics[0]?.id).toBe(1);
      expect(result.clinics[0]?.name).toBe('Clinic A');
      expect(result.active_clinic_id).toBe(1);
    });

    it('should include inactive clinics when requested', async () => {
      const mockResponse = {
        data: {
          clinics: [
            {
              id: 1,
              name: 'Clinic A',
              display_name: 'Clinic A',
              roles: ['admin'],
              is_active: true,
              last_accessed_at: '2025-01-15T10:00:00Z',
            },
            {
              id: 2,
              name: 'Clinic B',
              display_name: 'Clinic B',
              roles: ['practitioner'],
              is_active: false,
              last_accessed_at: null,
            },
          ],
          active_clinic_id: 1,
        },
      };

      mockAxiosInstance.get.mockResolvedValueOnce(mockResponse);

      const result = await apiService.listAvailableClinics(true);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/auth/clinics', {
        params: { include_inactive: true },
      });
      expect(result.clinics).toHaveLength(2);
      expect(result.clinics[1]?.is_active).toBe(false);
    });

    it('should handle empty clinics list', async () => {
      const mockResponse = {
        data: {
          clinics: [],
          active_clinic_id: null,
        },
      };

      mockAxiosInstance.get.mockResolvedValueOnce(mockResponse);

      const result = await apiService.listAvailableClinics();

      expect(result.clinics).toHaveLength(0);
      expect(result.active_clinic_id).toBeNull();
    });
  });

  describe('switchClinic', () => {
    it('should switch clinic successfully', async () => {
      const mockResponse = {
        data: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          active_clinic_id: 2,
          roles: ['practitioner'],
          name: 'Dr. Smith',
          clinic: {
            id: 2,
            name: 'Clinic B',
            display_name: 'Clinic B',
          },
        },
      };

      mockAxiosInstance.post.mockResolvedValueOnce(mockResponse);

      const result = await apiService.switchClinic(2);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/switch-clinic', {
        clinic_id: 2,
      });
      expect(result.active_clinic_id).toBe(2);
      expect(result.roles).toEqual(['practitioner']);
      expect(result.clinic.id).toBe(2);
      expect(result.clinic.name).toBe('Clinic B');
    });

    it('should handle idempotent switch (already on clinic)', async () => {
      const mockResponse = {
        data: {
          access_token: null,
          refresh_token: null,
          active_clinic_id: 1,
          roles: ['admin'],
          name: 'Dr. Admin',
          clinic: {
            id: 1,
            name: 'Clinic A',
            display_name: 'Clinic A',
          },
        },
      };

      mockAxiosInstance.post.mockResolvedValueOnce(mockResponse);

      const result = await apiService.switchClinic(1);

      expect(result.access_token).toBeNull();
      expect(result.refresh_token).toBeNull();
      expect(result.active_clinic_id).toBe(1);
    });

    it('should handle rate limit error', async () => {
      const error = {
        response: {
          status: 429,
          data: {
            detail: 'Too many clinic switches. Maximum 10 switches per minute.',
          },
        },
      };

      mockAxiosInstance.post.mockRejectedValueOnce(error);

      await expect(apiService.switchClinic(2)).rejects.toThrow();
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/switch-clinic', {
        clinic_id: 2,
      });
    });

    it('should handle access denied error', async () => {
      const error = {
        response: {
          status: 403,
          data: {
            detail: '您沒有此診所的存取權限',
          },
        },
      };

      mockAxiosInstance.post.mockRejectedValue(error);

      await expect(apiService.switchClinic(999)).rejects.toThrow();
    });

    it('should handle invalid clinic error', async () => {
      const error = {
        response: {
          status: 400,
          data: {
            detail: '無法切換診所',
          },
        },
      };

      mockAxiosInstance.post.mockRejectedValue(error);

      await expect(apiService.switchClinic(999)).rejects.toThrow();
    });
  });
});


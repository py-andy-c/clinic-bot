import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { TokenRefreshService, tokenRefreshService } from '../tokenRefresh';
import { authStorage } from '../../utils/storage';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios);

// Mock storage
vi.mock('../../utils/storage', () => ({
  authStorage: {
    getRefreshToken: vi.fn(),
    setAccessToken: vi.fn(),
    setRefreshToken: vi.fn(),
    setWasLoggedIn: vi.fn(),
  },
}));

describe('TokenRefreshService', () => {
  let service: TokenRefreshService;
  const mockAxiosInstance = {
    post: vi.fn(),
    get: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TokenRefreshService();
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
  });

  afterEach(() => {
    service.clearRefresh();
  });

  describe('refreshToken', () => {
    it('should refresh token using cookie successfully', async () => {
      const mockResponse = {
        data: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);
      (authStorage.getRefreshToken as any).mockReturnValue('test-refresh-token');

      const result = await service.refreshToken();

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/auth/refresh',
        { refresh_token: 'test-refresh-token' }
      );
      expect(authStorage.setAccessToken).toHaveBeenCalledWith('new-access-token');
      expect(authStorage.setRefreshToken).toHaveBeenCalledWith('new-refresh-token');
      expect(authStorage.setWasLoggedIn).toHaveBeenCalledWith(true);
    });

    it('should refresh token using localStorage', async () => {
      const mockResponse = {
        data: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);
      (authStorage.getRefreshToken as any).mockReturnValue('stored-refresh-token');

      const result = await service.refreshToken();

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/auth/refresh',
        { refresh_token: 'stored-refresh-token' }
      );
    });

    it('should throw error if refresh request fails', async () => {
      // Reset mocks to ensure clean state
      vi.clearAllMocks();
      const error = new Error('Refresh failed');
      mockAxiosInstance.post.mockRejectedValueOnce(error);
      (authStorage.getRefreshToken as any).mockReturnValue('stored-refresh-token');

      await expect(service.refreshToken()).rejects.toThrow('Refresh failed');
    });

    it('should throw error if no refresh token available', async () => {
      (authStorage.getRefreshToken as any).mockReturnValue(null);

      await expect(service.refreshToken()).rejects.toThrow('找不到重新整理權杖');
    });

    it('should validate token and return user data when requested', async () => {
      const mockRefreshResponse = {
        data: {
          access_token: 'new-access-token',
        },
      };

      const mockUserData = {
        id: 1,
        email: 'test@example.com',
      };

      mockAxiosInstance.post.mockResolvedValue(mockRefreshResponse);
      mockAxiosInstance.get.mockResolvedValue({ data: mockUserData });
      (authStorage.getRefreshToken as any).mockReturnValue('test-refresh-token');

      const result = await service.refreshToken({ validateToken: true });

      expect(result.userData).toEqual(mockUserData);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/auth/verify', {
        headers: {
          'Authorization': 'Bearer new-access-token',
        },
      });
    });

    it('should reuse in-progress refresh promise', async () => {
      const mockResponse = {
        data: {
          access_token: 'new-access-token',
        },
      };

      let resolveFirst: (value: any) => void;
      const firstPromise = new Promise((resolve) => {
        resolveFirst = resolve;
      });

      mockAxiosInstance.post.mockReturnValue(firstPromise);
      (authStorage.getRefreshToken as any).mockReturnValue('test-refresh-token');

      // Start first refresh (this will set refreshInProgress)
      const promise1 = service.refreshToken();
      
      // Check that refresh is in progress
      expect(service.isRefreshing()).toBe(true);
      
      // Start second refresh before first completes (should return same promise)
      const promise2 = service.refreshToken();

      // The service should return the same promise instance when refresh is in progress
      // Note: The service wraps the promise in finally(), which creates a new promise,
      // but both calls should return the same wrapped promise instance stored in refreshInProgress
      // We verify this by checking that only one axios call is made (below)
      // and that both promises resolve to the same value
      // Note: We can't use toBe() because finally() creates a new promise, but we verify
      // the behavior by checking that only one axios call is made

      // Resolve the refresh
      resolveFirst!(mockResponse);

      const result1 = await promise1;
      const result2 = await promise2;

      // Results should be equal (same data) - proving both promises resolve to the same value
      expect(result1.accessToken).toBe(result2.accessToken);
      expect(result1.accessToken).toBe('new-access-token');
      // Only one axios call should be made (proving we reused the promise)
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });

    it('should throw error if response missing access_token', async () => {
      const mockResponse = {
        data: {
          // Missing access_token
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);
      (authStorage.getRefreshToken as any).mockReturnValue('test-refresh-token');

      await expect(service.refreshToken()).rejects.toThrow('重新整理權杖回應缺少存取權杖');
    });
  });

  describe('isRefreshing', () => {
    it('should return false when no refresh in progress', () => {
      expect(service.isRefreshing()).toBe(false);
    });

    it('should return true when refresh in progress', async () => {
      const mockResponse = {
        data: {
          access_token: 'new-access-token',
        },
      };

      let resolveRefresh: (value: any) => void;
      const refreshPromise = new Promise((resolve) => {
        resolveRefresh = resolve;
      });

      mockAxiosInstance.post.mockReturnValue(refreshPromise);
      (authStorage.getRefreshToken as any).mockReturnValue('test-refresh-token');

      const refreshPromiseResult = service.refreshToken();

      expect(service.isRefreshing()).toBe(true);

      resolveRefresh!(mockResponse);
      await refreshPromiseResult;

      expect(service.isRefreshing()).toBe(false);
    });
  });

  describe('clearRefresh', () => {
    it('should clear in-progress refresh', async () => {
      const mockResponse = {
        data: {
          access_token: 'new-access-token',
        },
      };

      let resolveRefresh: (value: any) => void;
      const refreshPromise = new Promise((resolve) => {
        resolveRefresh = resolve;
      });

      mockAxiosInstance.post.mockReturnValue(refreshPromise);
      (authStorage.getRefreshToken as any).mockReturnValue('test-refresh-token');

      service.refreshToken();

      expect(service.isRefreshing()).toBe(true);

      service.clearRefresh();

      expect(service.isRefreshing()).toBe(false);

      resolveRefresh!(mockResponse);
    });
  });

  describe('singleton instance', () => {
    it('should export singleton instance', () => {
      expect(tokenRefreshService).toBeInstanceOf(TokenRefreshService);
    });
  });
});

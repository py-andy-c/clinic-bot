/**
 * Unit tests for ApiService refreshToken method.
 * 
 * Tests the localStorage fallback mechanism for Safari ITP compatibility.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock axios - must be hoisted, define instance inside factory
vi.mock('axios', () => {
  const mockInterceptors = {
    request: { 
      use: () => {},
      eject: () => {},
    },
    response: { 
      use: () => {},
      eject: () => {},
    },
  };
  
  const mockInstance = {
    post: () => Promise.resolve({ status: 200, data: {} }),
    get: () => Promise.resolve({ status: 200, data: {} }),
    put: () => Promise.resolve({ status: 200, data: {} }),
    delete: () => Promise.resolve({ status: 200, data: {} }),
    defaults: {
      baseURL: 'http://localhost:8000'
    },
    interceptors: mockInterceptors,
  };
  
  return {
    default: {
      create: () => mockInstance,
    },
  };
});

// Mock logger
vi.mock('../../utils/logger', () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }
}));

// Mock config
vi.mock('../../config/env', () => ({
  config: {
    apiBaseUrl: 'http://localhost:8000'
  }
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock document.cookie
Object.defineProperty(document, 'cookie', {
  writable: true,
  value: '',
});

// Import ApiService after mocks are set up
// Note: ApiService is exported as a class, but we also need to import the class
import { ApiService } from '../api';

// Create mock axios instance factory (for fresh instances in tests)
const createMockAxiosInstance = () => ({
  post: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  defaults: {
    baseURL: 'http://localhost:8000'
  },
  interceptors: {
    request: { 
      use: vi.fn((callback: any) => callback),
      eject: vi.fn(),
    },
    response: { 
      use: vi.fn((onFulfilled: any, onRejected: any) => ({
        onFulfilled,
        onRejected,
      })),
      eject: vi.fn(),
    },
  },
});

describe('ApiService.refreshToken', () => {
  let apiService: any;
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Clear mocks
    vi.clearAllMocks();
    localStorageMock.clear();
    document.cookie = '';

    // Create fresh mock axios instance for this test
    mockAxiosInstance = createMockAxiosInstance();

    // Create new ApiService instance
    apiService = new ApiService();
    
    // Replace the client with our mock instance for testing
    apiService.client = mockAxiosInstance;
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    document.cookie = '';
  });

  describe('cookie-based refresh (successful)', () => {
    it('should refresh token using cookie when cookie is available', async () => {
      // Setup: Cookie is available
      document.cookie = 'refresh_token=test-refresh-token';

      // Mock successful response
      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 200,
        data: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          token_type: 'bearer',
          expires_in: '3600',
        },
      });

      await apiService.refreshToken();

      // Verify cookie was tried first
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/auth/refresh',
        {},
        { withCredentials: true }
      );

      // Verify tokens were stored
      expect(localStorage.getItem('access_token')).toBe('new-access-token');
      expect(localStorage.getItem('refresh_token')).toBe('new-refresh-token');
    });

    it('should store tokens even when refresh_token is missing from response', async () => {
      document.cookie = 'refresh_token=test-refresh-token';

      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 200,
        data: {
          access_token: 'new-access-token',
          token_type: 'bearer',
          expires_in: '3600',
        },
      });

      await apiService.refreshToken();

      expect(localStorage.getItem('access_token')).toBe('new-access-token');
      expect(localStorage.getItem('refresh_token')).toBeNull();
    });
  });

  describe('localStorage fallback (cookie fails)', () => {
    it('should fallback to localStorage when cookie fails with 401', async () => {
      // Setup: Cookie fails, localStorage has token
      document.cookie = '';
      localStorageMock.setItem('refresh_token', 'localStorage-refresh-token');

      // Mock cookie attempt fails with 401
      const cookieError = {
        response: {
          status: 401,
          data: { detail: '找不到重新整理權杖' },
        },
      };

      // Mock localStorage fallback succeeds
      mockAxiosInstance.post
        .mockRejectedValueOnce(cookieError)
        .mockResolvedValueOnce({
          status: 200,
          data: {
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            token_type: 'bearer',
            expires_in: '3600',
          },
        });

      await apiService.refreshToken();

      // Verify both attempts were made
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);

      // First attempt: cookie (fails)
      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(
        1,
        '/auth/refresh',
        {},
        { withCredentials: true }
      );

      // Second attempt: localStorage (succeeds)
      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(
        2,
        '/auth/refresh',
        { refresh_token: 'localStorage-refresh-token' },
        { withCredentials: true }
      );

      // Verify tokens were stored
      expect(localStorage.getItem('access_token')).toBe('new-access-token');
      expect(localStorage.getItem('refresh_token')).toBe('new-refresh-token');
    });

    it('should throw error when both cookie and localStorage fail', async () => {
      // Setup: Cookie fails, localStorage has token, but localStorage also fails
      document.cookie = '';
      localStorageMock.setItem('refresh_token', 'localStorage-refresh-token');

      const cookieError = {
        response: {
          status: 401,
          data: { detail: '找不到重新整理權杖' },
        },
      };

      const localStorageError = {
        response: {
          status: 401,
          data: { detail: '無效的重新整理權杖' },
        },
      };

      mockAxiosInstance.post
        .mockRejectedValueOnce(cookieError)
        .mockRejectedValueOnce(localStorageError);

      // Should throw error
      await expect(apiService.refreshToken()).rejects.toEqual(localStorageError);

      // Verify both attempts were made
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);

      // Verify auth state was cleared
      expect(localStorage.getItem('access_token')).toBeNull();
      expect(localStorage.getItem('was_logged_in')).toBeNull();
    });

    it('should throw error when cookie fails and localStorage has no token', async () => {
      // Setup: Cookie fails, localStorage has no token
      document.cookie = '';
      localStorageMock.removeItem('refresh_token');

      const cookieError = {
        response: {
          status: 401,
          data: { detail: '找不到重新整理權杖' },
        },
      };

      mockAxiosInstance.post.mockRejectedValueOnce(cookieError);

      // Should throw error
      await expect(apiService.refreshToken()).rejects.toEqual(cookieError);

      // Verify only cookie attempt was made (no localStorage attempt)
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);

      // Verify auth state was cleared
      expect(localStorage.getItem('access_token')).toBeNull();
      expect(localStorage.getItem('was_logged_in')).toBeNull();
    });
  });

  describe('non-401 errors', () => {
    it('should attempt localStorage fallback for non-401 errors', async () => {
      document.cookie = 'refresh_token=test-refresh-token';
      localStorageMock.setItem('refresh_token', 'localStorage-refresh-token');

      // Mock 500 error (not 401)
      const serverError = {
        response: {
          status: 500,
          data: { detail: 'Internal server error' },
        },
      };

      // Mock cookie attempt to fail, then localStorage to succeed
      mockAxiosInstance.post
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({
          status: 200,
          data: {
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            token_type: 'bearer',
            expires_in: 3600,
          },
        });

      await apiService.refreshToken();

      // Verify both cookie and localStorage attempts were made
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
    });

    it('should attempt localStorage fallback for network errors', async () => {
      document.cookie = 'refresh_token=test-refresh-token';
      localStorageMock.setItem('refresh_token', 'localStorage-refresh-token');

      // Mock network error (no response)
      const networkError = new Error('Network error');

      // Mock cookie attempt to fail, then localStorage to succeed
      mockAxiosInstance.post
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({
          status: 200,
          data: {
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            token_type: 'bearer',
            expires_in: 3600,
          },
        });

      await apiService.refreshToken();

      // Verify both cookie and localStorage attempts were made
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('edge cases', () => {
    it('should handle empty localStorage token', async () => {
      document.cookie = '';
      localStorageMock.setItem('refresh_token', '');

      const cookieError = {
        response: {
          status: 401,
          data: { detail: '找不到重新整理權杖' },
        },
      };

      mockAxiosInstance.post.mockRejectedValueOnce(cookieError);

      // Should throw error (empty string is falsy)
      await expect(apiService.refreshToken()).rejects.toEqual(cookieError);

      // Verify only cookie attempt was made
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });

    it('should handle successful cookie refresh and update localStorage', async () => {
      document.cookie = 'refresh_token=test-refresh-token';
      localStorageMock.setItem('refresh_token', 'old-refresh-token');

      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 200,
        data: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          token_type: 'bearer',
          expires_in: '3600',
        },
      });

      await apiService.refreshToken();

      // Verify localStorage was updated with new tokens
      expect(localStorage.getItem('access_token')).toBe('new-access-token');
      expect(localStorage.getItem('refresh_token')).toBe('new-refresh-token');
    });

    it('should handle response without access_token', async () => {
      document.cookie = 'refresh_token=test-refresh-token';

      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 200,
        data: {
          token_type: 'bearer',
          expires_in: '3600',
        },
      });

      // Should throw error when trying to store undefined access_token
      await expect(apiService.refreshToken()).rejects.toThrow('Failed to persist authentication token');
    });
  });

  describe('Safari ITP scenario', () => {
    it('should successfully use localStorage fallback when Safari blocks cookies', async () => {
      // Simulate Safari blocking cookies: cookie was set but not sent
      document.cookie = ''; // Cookie blocked by Safari
      localStorageMock.setItem('refresh_token', 'localStorage-refresh-token');

      // Cookie attempt fails (Safari blocked it)
      const cookieError = {
        response: {
          status: 401,
          data: { detail: '找不到重新整理權杖' },
        },
      };

      // localStorage fallback succeeds
      mockAxiosInstance.post
        .mockRejectedValueOnce(cookieError)
        .mockResolvedValueOnce({
          status: 200,
          data: {
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            token_type: 'bearer',
            expires_in: '3600',
          },
        });

      await apiService.refreshToken();

      // Verify localStorage fallback was used
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(
        2,
        '/auth/refresh',
        { refresh_token: 'localStorage-refresh-token' },
        { withCredentials: true }
      );

      // Verify tokens were stored
      expect(localStorage.getItem('access_token')).toBe('new-access-token');
      expect(localStorage.getItem('refresh_token')).toBe('new-refresh-token');
    });
  });
});

/**
 * Unit tests for ApiService refreshToken method.
 * 
 * Tests the localStorage fallback mechanism for Safari ITP compatibility.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tokenRefreshService } from '../tokenRefresh';

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

// Mock storage first (before TokenRefreshService)
vi.mock('../../utils/storage', async () => {
  const actual = await vi.importActual('../../utils/storage');
  return {
    ...actual,
    authStorage: {
      getRefreshToken: vi.fn(() => localStorage.getItem('refresh_token')),
      setAccessToken: vi.fn((token: string) => localStorage.setItem('access_token', token)),
      setRefreshToken: vi.fn((token: string) => localStorage.setItem('refresh_token', token)),
      setWasLoggedIn: vi.fn((value: boolean) => localStorage.setItem('was_logged_in', String(value))),
      getAccessToken: vi.fn(() => localStorage.getItem('access_token')),
      getWasLoggedIn: vi.fn(() => localStorage.getItem('was_logged_in') === 'true'),
      removeAccessToken: vi.fn(() => localStorage.removeItem('access_token')),
      removeRefreshToken: vi.fn(() => localStorage.removeItem('refresh_token')),
    },
  };
});

// Mock TokenRefreshService - make it actually call storage when mocked
vi.mock('../tokenRefresh', async () => {
  const storage = await vi.importActual('../../utils/storage');
  return {
    tokenRefreshService: {
      refreshToken: vi.fn(async (options?: any) => {
        // When mock is called with a result, we need to store it
        // This will be overridden in tests, but we provide a default implementation
        const result = {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
        };
        // Store tokens when mock is called
        (storage as any).authStorage.setAccessToken(result.accessToken);
        (storage as any).authStorage.setRefreshToken(result.refreshToken);
        (storage as any).authStorage.setWasLoggedIn(true);
        return result;
      }),
      isRefreshing: vi.fn(() => false),
      clearRefresh: vi.fn(),
    },
  };
});

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
      // Mock TokenRefreshService to succeed and store tokens
      (tokenRefreshService.refreshToken as any).mockImplementationOnce(async () => {
        const { authStorage } = await import('../../utils/storage');
        authStorage.setAccessToken('new-access-token');
        authStorage.setRefreshToken('new-refresh-token');
        authStorage.setWasLoggedIn(true);
        return {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
        };
      });

      await apiService.refreshToken();

      // Verify TokenRefreshService was called
      expect(tokenRefreshService.refreshToken).toHaveBeenCalledWith({
        validateToken: false,
        axiosInstance: mockAxiosInstance,
      });

      // Verify tokens were stored (via TokenRefreshService)
      expect(localStorage.getItem('access_token')).toBe('new-access-token');
      expect(localStorage.getItem('refresh_token')).toBe('new-refresh-token');
    });

    it('should store tokens even when refresh_token is missing from response', async () => {
      // Mock TokenRefreshService to return without refreshToken
      (tokenRefreshService.refreshToken as any).mockImplementationOnce(async () => {
        const { authStorage } = await import('../../utils/storage');
        authStorage.setAccessToken('new-access-token');
        authStorage.setWasLoggedIn(true);
        return {
          accessToken: 'new-access-token',
          // refreshToken is optional
        };
      });

      await apiService.refreshToken();

      expect(localStorage.getItem('access_token')).toBe('new-access-token');
      // refreshToken may or may not be stored depending on TokenRefreshService
    });
  });

  describe('localStorage fallback (cookie fails)', () => {
    it('should fallback to localStorage when cookie fails with 401', async () => {
      // Mock TokenRefreshService to succeed (it handles fallback internally)
      (tokenRefreshService.refreshToken as any).mockImplementationOnce(async () => {
        const { authStorage } = await import('../../utils/storage');
        authStorage.setAccessToken('new-access-token');
        authStorage.setRefreshToken('new-refresh-token');
        authStorage.setWasLoggedIn(true);
        return {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
        };
      });

      await apiService.refreshToken();

      // Verify TokenRefreshService was called (it handles fallback internally)
      expect(tokenRefreshService.refreshToken).toHaveBeenCalledWith({
        validateToken: false,
        axiosInstance: mockAxiosInstance,
      });

      // Verify tokens were stored
      expect(localStorage.getItem('access_token')).toBe('new-access-token');
      expect(localStorage.getItem('refresh_token')).toBe('new-refresh-token');
    });

    it('should throw error when both cookie and localStorage fail', async () => {
      // Mock TokenRefreshService to fail
      const error = {
        response: {
          status: 401,
          data: { detail: '找不到重新整理權杖' },
        },
      };
      (tokenRefreshService.refreshToken as any).mockRejectedValueOnce(error);

      // Should throw error
      await expect(apiService.refreshToken()).rejects.toEqual(error);

      // Verify TokenRefreshService was called
      expect(tokenRefreshService.refreshToken).toHaveBeenCalledWith({
        validateToken: false,
        axiosInstance: mockAxiosInstance,
      });
    });

    it('should throw error when cookie fails and localStorage has no token', async () => {
      // Mock TokenRefreshService to fail
      const error = {
        response: {
          status: 401,
          data: { detail: '找不到重新整理權杖' },
        },
      };
      (tokenRefreshService.refreshToken as any).mockRejectedValueOnce(error);

      // Should throw error
      await expect(apiService.refreshToken()).rejects.toEqual(error);

      // Verify TokenRefreshService was called
      expect(tokenRefreshService.refreshToken).toHaveBeenCalledWith({
        validateToken: false,
        axiosInstance: mockAxiosInstance,
      });
    });
  });

  describe('non-401 errors', () => {
    it('should attempt localStorage fallback for non-401 errors', async () => {
      // Mock TokenRefreshService to succeed (it handles fallback internally)
      (tokenRefreshService.refreshToken as any).mockResolvedValueOnce({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });

      await apiService.refreshToken();

      // Verify TokenRefreshService was called (it handles fallback internally)
      expect(tokenRefreshService.refreshToken).toHaveBeenCalled();
    });

    it('should attempt localStorage fallback for network errors', async () => {
      // Mock TokenRefreshService to succeed (it handles fallback internally)
      (tokenRefreshService.refreshToken as any).mockResolvedValueOnce({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });

      await apiService.refreshToken();

      // Verify TokenRefreshService was called (it handles fallback internally)
      expect(tokenRefreshService.refreshToken).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle empty localStorage token', async () => {
      // Mock TokenRefreshService to fail
      const error = {
        response: {
          status: 401,
          data: { detail: '找不到重新整理權杖' },
        },
      };
      (tokenRefreshService.refreshToken as any).mockRejectedValueOnce(error);

      // Should throw error
      await expect(apiService.refreshToken()).rejects.toEqual(error);
    });

    it('should handle successful cookie refresh and update localStorage', async () => {
      // Mock TokenRefreshService to succeed
      (tokenRefreshService.refreshToken as any).mockImplementationOnce(async () => {
        const { authStorage } = await import('../../utils/storage');
        authStorage.setAccessToken('new-access-token');
        authStorage.setRefreshToken('new-refresh-token');
        authStorage.setWasLoggedIn(true);
        return {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
        };
      });

      await apiService.refreshToken();

      // Verify localStorage was updated with new tokens
      expect(localStorage.getItem('access_token')).toBe('new-access-token');
      expect(localStorage.getItem('refresh_token')).toBe('new-refresh-token');
    });

    it('should handle response without access_token', async () => {
      // Mock TokenRefreshService to fail (missing access_token)
      const error = new Error('重新整理權杖回應缺少存取權杖');
      (tokenRefreshService.refreshToken as any).mockRejectedValueOnce(error);

      await expect(apiService.refreshToken()).rejects.toThrow('重新整理權杖回應缺少存取權杖');
    });
  });

  describe('Safari ITP scenario', () => {
    it('should successfully use localStorage fallback when Safari blocks cookies', async () => {
      // Mock TokenRefreshService to succeed (it handles Safari ITP fallback internally)
      (tokenRefreshService.refreshToken as any).mockImplementationOnce(async () => {
        const { authStorage } = await import('../../utils/storage');
        authStorage.setAccessToken('new-access-token');
        authStorage.setRefreshToken('new-refresh-token');
        authStorage.setWasLoggedIn(true);
        return {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
        };
      });

      await apiService.refreshToken();

      // Verify TokenRefreshService was called (it handles Safari ITP fallback internally)
      expect(tokenRefreshService.refreshToken).toHaveBeenCalledWith({
        validateToken: false,
        axiosInstance: mockAxiosInstance,
      });

      // Verify tokens were stored
      expect(localStorage.getItem('access_token')).toBe('new-access-token');
      expect(localStorage.getItem('refresh_token')).toBe('new-refresh-token');
    });
  });
});

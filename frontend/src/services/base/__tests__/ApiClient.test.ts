import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { ApiClient } from '../ApiClient';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios);

describe('ApiClient', () => {
  let apiClient: ApiClient;
  const mockAxiosInstance = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  };

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup axios.create mock to return our mock instance
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any);

    // Create a test implementation of ApiClient
    class TestApiClient extends ApiClient {
      async testGet() {
        return this.get('/test');
      }

      async testPost(data: any) {
        return this.post('/test', data);
      }

      async testPut(data: any) {
        return this.put('/test', data);
      }

      async testPatch(data: any) {
        return this.patch('/test', data);
      }

      async testDelete() {
        return this.delete('/test');
      }
    }

    apiClient = new TestApiClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize with correct axios configuration', () => {
    expect(mockedAxios.create).toHaveBeenCalledWith({
      baseURL: expect.any(String), // config.apiBaseUrl
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  });

  describe('HTTP methods', () => {
    const mockResponse = { data: { success: true } };

    beforeEach(() => {
      // Setup mock responses for all HTTP methods
      mockAxiosInstance.get.mockResolvedValue(mockResponse);
      mockAxiosInstance.post.mockResolvedValue(mockResponse);
      mockAxiosInstance.put.mockResolvedValue(mockResponse);
      mockAxiosInstance.patch.mockResolvedValue(mockResponse);
      mockAxiosInstance.delete.mockResolvedValue(mockResponse);
    });

    it('should handle GET requests', async () => {
      const result = await (apiClient as any).testGet();
      expect(result).toEqual({ success: true });
    });

    it('should handle POST requests', async () => {
      const data = { name: 'test' };
      const result = await (apiClient as any).testPost(data);
      expect(result).toEqual({ success: true });
    });

    it('should handle PUT requests', async () => {
      const data = { name: 'test' };
      const result = await (apiClient as any).testPut(data);
      expect(result).toEqual({ success: true });
    });

    it('should handle PATCH requests', async () => {
      const data = { name: 'test' };
      const result = await (apiClient as any).testPatch(data);
      expect(result).toEqual({ success: true });
    });

    it('should handle DELETE requests', async () => {
      const result = await (apiClient as any).testDelete();
      expect(result).toEqual({ success: true });
    });
  });

  describe('Error handling', () => {
    const mockError = {
      response: {
        data: {
          detail: 'Test error'
        }
      }
    };

    beforeEach(() => {
      // Setup mock to reject with error
      mockAxiosInstance.get.mockRejectedValue(mockError);
      mockAxiosInstance.post.mockRejectedValue(mockError);
      mockAxiosInstance.put.mockRejectedValue(mockError);
      mockAxiosInstance.patch.mockRejectedValue(mockError);
      mockAxiosInstance.delete.mockRejectedValue(mockError);
    });

    it('should handle errors and throw with proper message', async () => {
      await expect((apiClient as any).testGet()).rejects.toThrow('Test error');
    });

    it('should handle errors without response', async () => {
      const networkError = new Error('Network Error');
      mockAxiosInstance.get.mockRejectedValue(networkError);

      await expect((apiClient as any).testGet()).rejects.toThrow('網路連線異常，請檢查網路狀況');
    });
  });

  describe('Interceptors', () => {
    it('should setup interceptors on initialization', () => {
      // The interceptors are already set up in beforeEach
      expect(mockAxiosInstance.interceptors.request.use).toHaveBeenCalled();
      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
    });

    it('should allow overriding request interceptor', () => {
      class CustomApiClient extends ApiClient {
        protected onRequest(config: any) {
          config.customHeader = 'test';
          return config;
        }
      }

      const customClient = new CustomApiClient();
      const result = customClient['onRequest']({ url: '/test' });

      expect(result).toEqual({ url: '/test', customHeader: 'test' });
    });
  });
});

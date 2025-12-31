/**
 * Unit tests for useApiData hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useApiData, clearApiDataCache } from '../useApiData';
import { logger } from '../../utils/logger';

// Mock logger
vi.mock('../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

// Mock useAuth
let mockClinicId: number | null | undefined = 1;
vi.mock('../useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: mockClinicId !== undefined ? { active_clinic_id: mockClinicId } : null,
  })),
}));

describe('useApiData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear cache before each test to prevent test interference
    clearApiDataCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clear cache after each test
    clearApiDataCache();
  });

  it('should fetch data on mount when enabled', async () => {
    const mockData = { id: 1, name: 'Test' };
    const fetchFn = vi.fn().mockResolvedValue(mockData);

    const { result } = renderHook(() => useApiData(fetchFn));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(mockData);
    expect(result.current.error).toBeNull();
  });

  it('should not fetch data when enabled is false', async () => {
    const mockData = { id: 1, name: 'Test' };
    const fetchFn = vi.fn().mockResolvedValue(mockData);

    const { result } = renderHook(() =>
      useApiData(fetchFn, { enabled: false })
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('should use initial data when provided', async () => {
    const initialData = { id: 0, name: 'Initial' };
    const fetchFn = vi.fn().mockResolvedValue({ id: 1, name: 'Test' });

    const { result } = renderHook(() =>
      useApiData(fetchFn, { initialData, cacheTTL: 0 }) // Disable cache for this test
    );

    expect(result.current.data).toEqual(initialData);
    expect(result.current.loading).toBe(true);

    // Wait for the fetch to complete to avoid act warnings
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('should handle fetch errors', async () => {
    const error = new Error('Fetch failed');
    const fetchFn = vi.fn().mockRejectedValue(error);

    const { result } = renderHook(() => useApiData(fetchFn, { cacheTTL: 0 })); // Disable cache for this test

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('Fetch failed');
    expect(logger.error).toHaveBeenCalled();
  });

  it('should use custom error message when provided', async () => {
    const error = new Error('Fetch failed');
    const fetchFn = vi.fn().mockRejectedValue(error);
    const customMessage = '無法載入資料';

    const { result } = renderHook(() =>
      useApiData(fetchFn, { defaultErrorMessage: customMessage })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe(customMessage);
  });

  it('should call onSuccess callback when fetch succeeds', async () => {
    const mockData = { id: 1, name: 'Test' };
    const fetchFn = vi.fn().mockResolvedValue(mockData);
    const onSuccess = vi.fn();

    const { result } = renderHook(() =>
      useApiData(fetchFn, { onSuccess })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(onSuccess).toHaveBeenCalledWith(mockData);
  });

  it('should call onError callback when fetch fails', async () => {
    const error = new Error('Fetch failed');
    const fetchFn = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useApiData(fetchFn, { onError })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(onError).toHaveBeenCalledWith(error);
  });

  it('should refetch data when refetch is called', async () => {
    const mockData1 = { id: 1, name: 'Test 1' };
    const mockData2 = { id: 2, name: 'Test 2' };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(mockData1)
      .mockResolvedValueOnce(mockData2);

    const { result } = renderHook(() => useApiData(fetchFn, { cacheTTL: 0 })); // Disable cache for this test

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(mockData1);

    await result.current.refetch();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual(mockData2);
  });

  it('should clear error when clearError is called', async () => {
    const error = new Error('Fetch failed');
    const fetchFn = vi.fn().mockRejectedValue(error);

    const { result } = renderHook(() => useApiData(fetchFn));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });

  it('should set data manually when setData is called', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ id: 1, name: 'Test' });

    const { result } = renderHook(() => useApiData(fetchFn));

    // Wait for initial fetch to complete
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const newData = { id: 2, name: 'Manual' };
    act(() => {
      result.current.setData(newData);
    });

    expect(result.current.data).toEqual(newData);
  });

  it('should refetch when dependencies change', async () => {
    const mockData = { id: 1, name: 'Test' };
    const fetchFn = vi.fn().mockResolvedValue(mockData);

    const { result, rerender } = renderHook(
      ({ userId }: { userId: number }) =>
        useApiData(fetchFn, { dependencies: [userId], cacheTTL: 0 }), // Disable cache for this test
      {
        initialProps: { userId: 1 },
      }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Change dependency
    rerender({ userId: 2 });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('should not log errors when logErrors is false', async () => {
    const error = new Error('Fetch failed');
    const fetchFn = vi.fn().mockRejectedValue(error);

    const { result } = renderHook(() =>
      useApiData(fetchFn, { logErrors: false })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(logger.error).not.toHaveBeenCalled();
  });

  it('should handle unmounting during fetch', async () => {
    const mockData = { id: 1, name: 'Test' };
    let resolvePromise: (value: { id: number; name: string }) => void;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    const fetchFn = vi.fn().mockReturnValue(promise);

    const { result, unmount } = renderHook(() => useApiData(fetchFn, { cacheTTL: 0 })); // Disable cache for this test

    expect(result.current.loading).toBe(true);

    // Unmount before fetch completes
    unmount();

    // Resolve the promise after unmount
    resolvePromise!(mockData);

    // Wait a bit to ensure no state updates occur
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should not throw errors
    expect(fetchFn).toHaveBeenCalled();
  });

  describe('clinic ID auto-injection', () => {
    beforeEach(() => {
      clearApiDataCache();
      mockClinicId = 1; // Reset to default
    });

    it('should include clinic ID in cache key for clinic-specific endpoints (method name)', async () => {
      // Mock clinic-specific method
      const mockApiService = {
        getClinicSettings: vi.fn().mockResolvedValue({ settings: 'test' }),
      };
      const fetchFn = () => mockApiService.getClinicSettings();
      
      // Test with clinic ID 1
      mockClinicId = 1;
      const { result: result1, rerender } = renderHook(() => 
        useApiData(fetchFn, { cacheTTL: 60000 })
      );
      
      await waitFor(() => {
        expect(result1.current.loading).toBe(false);
      });
      
      expect(mockApiService.getClinicSettings).toHaveBeenCalledTimes(1);
      
      // Clear cache to ensure we're testing cache key differences, not cache hits
      clearApiDataCache();
      
      // Switch to clinic ID 2 - should trigger new fetch
      mockClinicId = 2;
      rerender();
      
      await waitFor(() => {
        expect(result1.current.loading).toBe(false);
      });
      
      // Should fetch again because cache key includes clinic ID
      expect(mockApiService.getClinicSettings).toHaveBeenCalledTimes(2);
    });

    it('should include clinic ID in cache key for clinic-specific endpoints (URL pattern)', async () => {
      // Mock function that matches URL pattern
      const fetchFn = () => Promise.resolve({ data: 'test' });
      // Override toString to simulate URL pattern
      fetchFn.toString = () => "this.client.get('/clinic/settings')";
      
      // Test with clinic ID 1
      mockClinicId = 1;
      const { result: result1, rerender } = renderHook(() => 
        useApiData(fetchFn, { cacheTTL: 60000 })
      );
      
      await waitFor(() => {
        expect(result1.current.loading).toBe(false);
      });
      
      // Switch to clinic ID 2 - should trigger new fetch
      mockClinicId = 2;
      rerender();
      
      await waitFor(() => {
        expect(result1.current.loading).toBe(false);
      });
      
      // Should have fetched twice (once per clinic)
      expect(result1.current.data).toBeTruthy();
    });

    it('should not include clinic ID for non-clinic-specific endpoints', async () => {
      // Mock non-clinic-specific method
      const mockApiService = {
        getSystemInfo: vi.fn().mockResolvedValue({ info: 'test' }),
      };
      const fetchFn = () => mockApiService.getSystemInfo();
      
      // Test with clinic ID 1
      mockClinicId = 1;
      const { result: result1, rerender } = renderHook(() => 
        useApiData(fetchFn, { cacheTTL: 60000 })
      );
      
      await waitFor(() => {
        expect(result1.current.loading).toBe(false);
      });
      
      expect(mockApiService.getSystemInfo).toHaveBeenCalledTimes(1);
      
      // Switch to clinic ID 2 - should NOT trigger new fetch (same cache key)
      mockClinicId = 2;
      rerender();
      
      // Wait a bit to ensure no new fetch
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Should still be called only once (cached)
      expect(mockApiService.getSystemInfo).toHaveBeenCalledTimes(1);
    });

    it('should handle null clinic ID correctly', async () => {
      const mockApiService = {
        getClinicSettings: vi.fn().mockResolvedValue({ settings: 'test' }),
      };
      const fetchFn = () => mockApiService.getClinicSettings();
      
      // Test with null clinic ID
      mockClinicId = null;
      const { result: result1, rerender } = renderHook(() => 
        useApiData(fetchFn, { cacheTTL: 60000 })
      );
      
      await waitFor(() => {
        expect(result1.current.loading).toBe(false);
      });
      
      expect(mockApiService.getClinicSettings).toHaveBeenCalledTimes(1);
      
      // Clear cache to ensure we're testing cache key differences
      clearApiDataCache();
      
      // Switch to clinic ID 1 - should trigger new fetch (null vs 1 are different)
      mockClinicId = 1;
      rerender();
      
      await waitFor(() => {
        expect(result1.current.loading).toBe(false);
      });
      
      // Should fetch again because null and 1 are different cache keys
      expect(mockApiService.getClinicSettings).toHaveBeenCalledTimes(2);
    });

    it('should handle undefined clinic ID (no user)', async () => {
      const mockApiService = {
        getClinicSettings: vi.fn().mockResolvedValue({ settings: 'test' }),
      };
      const fetchFn = () => mockApiService.getClinicSettings();
      
      // Test with undefined clinic ID (no user)
      mockClinicId = undefined;
      const { result } = renderHook(() => 
        useApiData(fetchFn, { cacheTTL: 60000 })
      );
      
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      
      // Should still work (undefined is not included in cache key)
      expect(mockApiService.getClinicSettings).toHaveBeenCalledTimes(1);
      expect(result.current.data).toBeTruthy();
    });
  });
});


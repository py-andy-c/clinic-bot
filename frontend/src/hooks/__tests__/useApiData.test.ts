/**
 * Unit tests for useApiData hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useApiData, clearApiDataCache } from '../useApiData';
import { logger } from '../../utils/logger';
import { ApiErrorType } from '../../types';

// Mock logger
vi.mock('../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
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
    let resolvePromise: (value: any) => void;
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
});


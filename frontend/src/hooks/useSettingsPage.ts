import { useState, useEffect, useRef } from 'react';
import { useUnsavedChangesDetection } from './useUnsavedChangesDetection';
import { logger } from '../utils/logger';

interface UIState {
  loading: boolean;
  saving: boolean;
  error: string | null;
}

interface SettingsPageConfig<T> {
  fetchData: () => Promise<T>;
  saveData: (data: T) => Promise<void>;
  validateData: (data: T) => string | null;
  getSectionChanges: (current: T, original: T) => Record<string, boolean>;
  onValidationError?: (error: string) => Promise<void>;
  onSaveError?: (error: string) => Promise<void>;
  onSuccess?: (data: T) => void;
}

interface UseSettingsPageOptions<T> {
  isLoading?: boolean;
  initialData?: T | null; // Allow passing initial/cached data to skip fetch
  skipFetch?: boolean; // If true, never fetch - only use initialData
}

export const useSettingsPage = <T extends Record<string, any>>(
  config: SettingsPageConfig<T>,
  options?: UseSettingsPageOptions<T>
) => {
  const { isLoading: authLoading = false, initialData, skipFetch = false } = options || {};
  const [data, setData] = useState<T | null>(initialData ?? null);
  const [originalData, setOriginalData] = useState<T | null>(
    initialData ? JSON.parse(JSON.stringify(initialData)) : null
  );
  const [uiState, setUiState] = useState<UIState>({
    loading: initialData ? false : (skipFetch ? false : true), // If we have initial data or skipFetch, don't show loading
    saving: false,
    error: null,
  });
  const fetchInProgressRef = useRef(false); // Track if fetch is already in progress

  // Update data when initialData becomes available
  // Only update if there are no unsaved changes to avoid overwriting user edits
  const prevInitialDataRef = useRef(initialData);
  useEffect(() => {
    // Only process if initialData actually changed
    if (initialData && initialData !== prevInitialDataRef.current) {
      prevInitialDataRef.current = initialData;
      // Check if there are unsaved changes by comparing current data with original
      const hasUnsavedChanges = data && originalData && JSON.stringify(data) !== JSON.stringify(originalData);

      // Only update from initialData if there are no unsaved changes
      if (!hasUnsavedChanges) {
        setData(initialData);
        setOriginalData(JSON.parse(JSON.stringify(initialData)));
        setUiState(prev => ({ ...prev, loading: false }));
      }
    } else if (skipFetch && !initialData) {
      setUiState(prev => ({ ...prev, loading: true }));
    }
  }, [initialData, skipFetch]); // Removed data and originalData from deps to prevent loops

  // Fetch data on mount (skip if using external data source)
  useEffect(() => {
    if (skipFetch) {
      return;
    }
    if (!authLoading && !initialData && !data && !fetchInProgressRef.current) {
      fetchInProgressRef.current = true;
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, skipFetch]);

  const fetchData = async () => {
    try {
      setUiState(prev => ({ ...prev, loading: true, error: null }));
      const result = await config.fetchData();
      setData(result);
      setOriginalData(JSON.parse(JSON.stringify(result))); // Deep clone for comparison
      fetchInProgressRef.current = false; // Reset flag after successful fetch
    } catch (err) {
      setUiState(prev => ({ ...prev, error: '無法載入設定' }));
      logger.error('Fetch settings error:', err);
      fetchInProgressRef.current = false; // Reset flag after error
    } finally {
      setUiState(prev => ({ ...prev, loading: false }));
    }
  };

  // Check if there are unsaved changes
  const hasUnsavedChanges = () => {
    if (!data || !originalData) return false;
    return JSON.stringify(data) !== JSON.stringify(originalData);
  };

  // Get section-specific changes
  const sectionChanges = data && originalData ? config.getSectionChanges(data, originalData) : {};

  // Setup navigation warnings for unsaved changes
  useUnsavedChangesDetection({ hasUnsavedChanges: () => hasUnsavedChanges() });

  const saveData = async () => {
    if (!data) return;

    try {
      setUiState(prev => ({ ...prev, saving: true, error: null }));

      // Validate before saving
      const validationError = config.validateData(data);
      if (validationError) {
        // Use custom validation error handler if provided, otherwise set inline error
        if (config.onValidationError) {
          await config.onValidationError(validationError);
          setUiState(prev => ({ ...prev, saving: false }));
          return;
        }
        setUiState(prev => ({ ...prev, error: validationError }));
        return;
      }

      await config.saveData(data);

      // Update original data after successful save
      setOriginalData(JSON.parse(JSON.stringify(data)));

      // Call onSuccess callback if provided
      if (config.onSuccess) {
        await config.onSuccess(data);
        // Don't show default alert if onSuccess is provided (caller handles success messaging)
        return;
      }

      // Default success message if no onSuccess callback provided
      alert('設定已更新');
    } catch (err: any) {
      logger.error('Save settings error:', err);
      // Extract error message from response
      const errorMessage = err.response?.data?.detail || err.response?.data?.message || err.message || '儲存設定失敗，請稍後再試';
      logger.error('Error details:', {
        status: err.response?.status,
        data: err.response?.data,
        message: errorMessage
      });

      // Use custom save error handler if provided, otherwise set inline error
      if (config.onSaveError) {
        await config.onSaveError(errorMessage);
        setUiState(prev => ({ ...prev, saving: false }));
        return;
      }

      setUiState(prev => ({
        ...prev,
        error: errorMessage
      }));
    } finally {
      setUiState(prev => ({ ...prev, saving: false }));
    }
  };

  const updateData = (updates: Partial<T> | ((prev: T) => Partial<T>)) => {
    setData(prev => {
      if (!prev) return null;
      if (typeof updates === 'function') {
        const partialUpdates = updates(prev);
        return { ...prev, ...partialUpdates };
      }
      return { ...prev, ...updates };
    });
  };

  const resetData = () => {
    setData(originalData ? JSON.parse(JSON.stringify(originalData)) : null);
  };

  return {
    data,
    originalData,
    uiState,
    sectionChanges,
    hasUnsavedChanges,
    fetchData,
    saveData,
    updateData,
    resetData,
  };
};

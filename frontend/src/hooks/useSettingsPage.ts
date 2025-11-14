import { useState, useEffect } from 'react';
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

interface UseSettingsPageOptions {
  isLoading?: boolean;
}

export const useSettingsPage = <T extends Record<string, any>>(
  config: SettingsPageConfig<T>,
  options?: UseSettingsPageOptions
) => {
  const { isLoading: authLoading = false } = options || {};
  const [data, setData] = useState<T | null>(null);
  const [originalData, setOriginalData] = useState<T | null>(null);
  const [uiState, setUiState] = useState<UIState>({
    loading: true,
    saving: false,
    error: null,
  });

  // Fetch data on mount - wait for auth to complete before fetching
  useEffect(() => {
    // Wait for auth to complete before fetching data
    if (!authLoading) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  const fetchData = async () => {
    try {
      setUiState(prev => ({ ...prev, loading: true, error: null }));
      const result = await config.fetchData();
      setData(result);
      setOriginalData(JSON.parse(JSON.stringify(result))); // Deep clone for comparison
    } catch (err) {
      setUiState(prev => ({ ...prev, error: '無法載入設定' }));
      logger.error('Fetch settings error:', err);
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
        config.onSuccess(data);
      }

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

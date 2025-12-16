/**
 * Generic factory for creating settings form stores.
 * 
 * This factory provides a reusable pattern for managing form state in settings forms.
 * It handles common operations like loading, saving, change detection, and state management.
 * 
 * @example
 * ```typescript
 * const useChatSettingsStore = createSettingsFormStore({
 *   fetchServerData: () => apiService.getClinicSettings().then(s => s.chat_settings),
 *   transformServerToForm: (server) => server,
 *   transformFormToServer: (form) => form,
 *   saveFormData: (data) => apiService.updateClinicSettings({ chat_settings: data }),
 * });
 * ```
 */

import { create, StateCreator } from 'zustand';
import { logger } from '../utils/logger';

export interface SettingsFormStoreConfig<TFormData, TServerData> {
  // Server data loading
  fetchServerData: () => Promise<TServerData>;
  
  // Transformations
  transformServerToForm: (server: TServerData) => TFormData;
  transformFormToServer: (form: TFormData) => Partial<TServerData>;
  
  // Save operation
  saveFormData: (data: Partial<TServerData>) => Promise<void>;
  
  // Optional: Validation
  validateFormData?: (data: TFormData) => string | null;
  
  // Optional: Pre-save hook (e.g., for ID mapping)
  onBeforeSave?: (formData: TFormData) => Promise<TFormData> | TFormData;
  
  // Optional: Post-save hook (e.g., for updating state with real IDs)
  onAfterSave?: (savedData: TServerData, formData: TFormData) => Promise<void> | void;
}

export interface SettingsFormStoreState<TFormData> {
  // State
  formData: TFormData | null;
  originalData: TFormData | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  
  // Actions
  load: () => Promise<void>;
  updateField: <K extends keyof TFormData>(field: K, value: TFormData[K]) => void;
  updateFields: (updates: Partial<TFormData>) => void;
  save: (idMapping?: Record<number, number>) => Promise<void>;
  reset: () => void;
  hasUnsavedChanges: () => boolean;
}

/**
 * Creates a generic settings form store with standard operations.
 * 
 * @param config Configuration for the store
 * @returns Zustand store hook
 */
export function createSettingsFormStore<TFormData extends Record<string, any>, TServerData>(
  config: SettingsFormStoreConfig<TFormData, TServerData>
) {
  const storeCreator: StateCreator<SettingsFormStoreState<TFormData>> = (set, get) => ({
    // Initial state
    formData: null,
    originalData: null,
    loading: false,
    saving: false,
    error: null,

    // Load server data and transform to form data
    load: async () => {
      try {
        set({ loading: true, error: null });
        const serverData = await config.fetchServerData();
        const formData = config.transformServerToForm(serverData);
        set({
          formData,
          originalData: JSON.parse(JSON.stringify(formData)), // Deep clone
          loading: false,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '無法載入資料';
        logger.error('Error loading form data:', err);
        set({
          loading: false,
          error: errorMessage,
        });
      }
    },

    // Update a single field
    updateField: <K extends keyof TFormData>(field: K, value: TFormData[K]) => {
      const current = get().formData;
      if (!current) return;
      
      set({
        formData: {
          ...current,
          [field]: value,
        },
      });
    },

    // Update multiple fields
    updateFields: (updates: Partial<TFormData>) => {
      const current = get().formData;
      if (!current) return;
      
      set({
        formData: {
          ...current,
          ...updates,
        },
      });
    },

    // Save form data
    save: async () => {
      const state = get();
      if (!state.formData) {
        throw new Error('No form data to save');
      }

      try {
        set({ saving: true, error: null });

        // Validate if validator provided
        if (config.validateFormData) {
          const validationError = config.validateFormData(state.formData);
          if (validationError) {
            set({ saving: false, error: validationError });
            return;
          }
        }

        // Pre-save hook (e.g., for ID mapping)
        let formDataToSave = state.formData;
        if (config.onBeforeSave) {
          formDataToSave = await config.onBeforeSave(state.formData);
        }

        // Transform form data to server format
        const serverData = config.transformFormToServer(formDataToSave);

        // Save to server
        await config.saveFormData(serverData);

        // Post-save hook (e.g., for updating state with real IDs)
        if (config.onAfterSave) {
          // Fetch fresh data to get real IDs
          const freshServerData = await config.fetchServerData();
          await config.onAfterSave(freshServerData, formDataToSave);
        }

        // Update original data after successful save
        set({
          originalData: JSON.parse(JSON.stringify(formDataToSave)), // Deep clone
          saving: false,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '儲存失敗';
        logger.error('Error saving form data:', err);
        set({
          saving: false,
          error: errorMessage,
        });
        throw err;
      }
    },

    // Reset to original data
    reset: () => {
      const original = get().originalData;
      if (original) {
        set({
          formData: JSON.parse(JSON.stringify(original)), // Deep clone
          error: null,
        });
      }
    },

    // Check if there are unsaved changes
    hasUnsavedChanges: () => {
      const { formData, originalData } = get();
      if (!formData || !originalData) return false;
      return JSON.stringify(formData) !== JSON.stringify(originalData);
    },
  });

  return create<SettingsFormStoreState<TFormData>>(storeCreator);
}


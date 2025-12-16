import React, { createContext, useContext, ReactNode } from 'react';
import { ClinicSettings } from '../schemas/api';
import { useSettingsPage } from '../hooks/useSettingsPage';
import { useAuth } from '../hooks/useAuth';
import { useApiData, invalidateCacheForFunction, invalidateCacheByPattern } from '../hooks/useApiData';
import { sharedFetchFunctions, apiService } from '../services/api';
import { validateClinicSettings, getClinicSectionChanges } from '../utils/clinicSettings';
import { useModal } from './ModalContext';
import { useUnsavedChangesDetection } from '../hooks/useUnsavedChangesDetection';
import { useServiceItemsStore } from '../stores/serviceItemsStore';

// Re-export BillingScenario from store for backwards compatibility
export type { BillingScenario } from '../stores/serviceItemsStore';

interface SettingsContextValue {
  settings: ClinicSettings | null;
  originalData: ClinicSettings | null;
  uiState: {
    loading: boolean;
    saving: boolean;
    error: string | null;
  };
  sectionChanges: Record<string, boolean>;
  saveData: () => Promise<void>;
  updateData: (updates: Partial<ClinicSettings> | ((prev: ClinicSettings) => Partial<ClinicSettings>)) => void;
  fetchData: () => Promise<void>;
  refreshTrigger: number;
  setRefreshTrigger: React.Dispatch<React.SetStateAction<number>>;
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider');
  }
  return context;
};

interface SettingsProviderProps {
  children: ReactNode;
}

export const SettingsProvider: React.FC<SettingsProviderProps> = ({ children }) => {
  const { isLoading, user } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const { alert } = useModal();
  const [clinicInfoRefreshTrigger, setClinicInfoRefreshTrigger] = React.useState(0);

  // Fetch clinic settings with caching (shares cache with GlobalWarnings)
  const { data: cachedSettings, loading: settingsLoading } = useApiData(
    sharedFetchFunctions.getClinicSettings,
    {
      enabled: !isLoading,
      dependencies: [isLoading],
      cacheTTL: 5 * 60 * 1000, // 5 minutes cache
    }
  );

  // Use settings page hook with cached data to avoid duplicate fetch
  const {
    data: settings,
    originalData,
    uiState,
    sectionChanges,
    saveData: saveDataInternal,
    updateData,
    fetchData,
  } = useSettingsPage({
    fetchData: async () => {
      return await sharedFetchFunctions.getClinicSettings();
    },
    saveData: async (data: ClinicSettings) => {
      // Convert reminder hours and booking restriction hours to numbers for backend
      const settingsToSave = {
        ...data,
        notification_settings: {
          ...data.notification_settings,
          reminder_hours_before: parseInt(String(data.notification_settings.reminder_hours_before)) || 24
        },
        booking_restriction_settings: {
          ...data.booking_restriction_settings,
          minimum_booking_hours_ahead: parseInt(String(data.booking_restriction_settings.minimum_booking_hours_ahead)) || 24,
          max_future_appointments: parseInt(String(data.booking_restriction_settings.max_future_appointments || 3)) || 3,
          max_booking_window_days: parseInt(String(data.booking_restriction_settings.max_booking_window_days || 90)) || 90,
          minimum_cancellation_hours_before: parseInt(String(data.booking_restriction_settings.minimum_cancellation_hours_before || 24)) || 24,
          allow_patient_deletion: data.booking_restriction_settings.allow_patient_deletion ?? true
        }
      };
      try {
        await apiService.updateClinicSettings(settingsToSave);
      } catch (error: any) {
        // Handle appointment type deletion error
        if (error.response?.status === 400 && error.response?.data?.detail?.error === 'cannot_delete_appointment_types') {
          const errorDetail = error.response.data.detail;
          // For simplicity, show only the first blocked appointment type
          // (in practice, this usually happens one at a time)
          const blockedType = errorDetail.appointment_types[0];
          const practitionerNames = blockedType.practitioners.join('、');
          const errorMessage = `「${blockedType.name}」正在被以下治療師使用：${practitionerNames}\n\n請先移除治療師的此服務設定後再刪除。`;
          throw new Error(errorMessage);
        }
        throw error;
      }
    },
    validateData: validateClinicSettings,
    getSectionChanges: getClinicSectionChanges,
    onValidationError: async (error: string) => {
      await alert(error, '錯誤');
    },
    onSaveError: async (error: string) => {
      // Errors from saveDataInternal (appointment types) will be handled here
      await alert(error, '儲存失敗');
    },
    onSuccess: async () => {
      // This will only be called if saveDataInternal succeeds
      // But we override saveData to handle all three types, so this might not be called
      // if there are service items changes. We'll handle success in the outer saveData.
      
      // Invalidate cache after successful save so other components see fresh data
      invalidateCacheForFunction(sharedFetchFunctions.getClinicSettings);

      // Check if clinic info was changed and saved by comparing with the data before save
      if (settings && originalData) {
        const changes = getClinicSectionChanges(settings, originalData);
        if (changes.clinicInfoSettings) {
          // Clinic info was saved, refresh the preview
          setClinicInfoRefreshTrigger(prev => prev + 1);
        }
      }

      // Note: Success message will be shown by outer saveData if all operations succeed
    },
  }, {
    isLoading: isLoading || settingsLoading,
    ...(cachedSettings ? { initialData: cachedSettings } : {}),
    skipFetch: !!cachedSettings // Only skip fetch if we have cached data
  });


  // Refresh settings when clinic changes
  // Invalidate cache to ensure fresh data for the new clinic
  const previousClinicIdRef = React.useRef<number | null | undefined>(activeClinicId ?? null);
  const clearServiceItems = useServiceItemsStore(state => state.clear);
  React.useEffect(() => {
    const currentClinicId = activeClinicId;
    if (!isLoading && currentClinicId && previousClinicIdRef.current !== currentClinicId && previousClinicIdRef.current !== null && previousClinicIdRef.current !== undefined) {
      // Invalidate cache when clinic changes
      invalidateCacheForFunction(sharedFetchFunctions.getClinicSettings);
      invalidateCacheByPattern('api_getPractitionerStatus_');
      invalidateCacheByPattern('api_getBatchPractitionerStatus_');
      // Clear service items store when clinic changes (will be reloaded for new clinic)
      clearServiceItems();
      // Force refetch by calling fetchData (skipFetch will be false after invalidation)
      if (fetchData) {
        fetchData();
      }
    }
    // Update ref value
    previousClinicIdRef.current = currentClinicId ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClinicId, isLoading, clearServiceItems]);

  // Save function that saves appointment types
  const saveData = async () => {
        await saveDataInternal();
  };


  // hasUnsavedChanges only checks settings changes (service items are handled separately)
  const hasUnsavedChanges = React.useCallback(() => {
    // Check settings changes (from useSettingsPage)
    if (!settings || !originalData) {
      return false;
    }
    return JSON.stringify(settings) !== JSON.stringify(originalData);
  }, [settings, originalData]);

  // Setup navigation warnings for unsaved changes (including service items)
  useUnsavedChangesDetection({ hasUnsavedChanges });

  // sectionChanges includes settings changes and service items changes
  const hasServiceItemsUnsavedChanges = useServiceItemsStore(state => state.hasUnsavedChanges);
  const extendedSectionChanges = React.useMemo(() => {
    return {
      ...sectionChanges,
      serviceItemsSettings: sectionChanges.appointmentSettings || hasServiceItemsUnsavedChanges(),
    };
  }, [sectionChanges, hasServiceItemsUnsavedChanges]);

  const value: SettingsContextValue = {
    settings,
    originalData,
    uiState,
    sectionChanges: extendedSectionChanges,
    saveData,
    updateData,
    fetchData,
    refreshTrigger: clinicInfoRefreshTrigger,
    setRefreshTrigger: setClinicInfoRefreshTrigger,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};


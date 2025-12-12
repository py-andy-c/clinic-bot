import React, { createContext, useContext, ReactNode } from 'react';
import { ClinicSettings } from '../schemas/api';
import { useSettingsPage } from '../hooks/useSettingsPage';
import { useAuth } from '../hooks/useAuth';
import { useApiData, invalidateCacheForFunction, invalidateCacheByPattern } from '../hooks/useApiData';
import { sharedFetchFunctions } from '../services/api';
import { apiService } from '../services/api';
import { validateClinicSettings, getClinicSectionChanges } from '../utils/clinicSettings';
import { useModal } from './ModalContext';
import { logger } from '../utils/logger';
import { useUnsavedChangesDetection } from '../hooks/useUnsavedChangesDetection';

// BillingScenario type (matches ServiceItemsSettings)
export interface BillingScenario {
  id: number;
  practitioner_appointment_type_id: number;
  name: string;
  amount: number;
  revenue_share: number;
  is_default: boolean;
}

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
  // Service Items additional state
  practitionerAssignments: Record<number, number[]>; // service_item_id -> practitioner_ids[]
  originalPractitionerAssignments: Record<number, number[]>;
  billingScenarios: Record<string, BillingScenario[]>; // key: "service_item_id-practitioner_id"
  originalBillingScenarios: Record<string, BillingScenario[]>;
  updatePractitionerAssignments: (serviceItemId: number, practitionerIds: number[]) => void;
  updateBillingScenarios: (key: string, scenarios: BillingScenario[]) => void;
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
  
  // Service Items additional state: Practitioner assignments
  // service_item_id -> practitioner_ids[]
  const [practitionerAssignments, setPractitionerAssignments] = React.useState<Record<number, number[]>>({});
  const [originalPractitionerAssignments, setOriginalPractitionerAssignments] = React.useState<Record<number, number[]>>({});
  
  // Service Items additional state: Billing scenarios
  // key: "service_item_id-practitioner_id" -> BillingScenario[]
  const [billingScenarios, setBillingScenarios] = React.useState<Record<string, BillingScenario[]>>({});
  const [originalBillingScenarios, setOriginalBillingScenarios] = React.useState<Record<string, BillingScenario[]>>({});

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

  // Load original practitioner assignments and billing scenarios when settings are loaded
  const isLoadingServiceItemsDataRef = React.useRef(false);
  React.useEffect(() => {
    const loadServiceItemsData = async () => {
      if (!settings || !settings.appointment_types || settings.appointment_types.length === 0) {
        return;
      }

      // Prevent multiple concurrent loads
      if (isLoadingServiceItemsDataRef.current) {
        return;
      }

      isLoadingServiceItemsDataRef.current = true;

      try {
        // Load members (practitioners)
        const membersData = await apiService.getMembers();
        const practitioners = membersData.filter(m => m.roles.includes('practitioner'));
        
        if (practitioners.length === 0) {
          setOriginalPractitionerAssignments({});
          setPractitionerAssignments({});
          return;
        }

        // Load practitioner assignments
        const assignments: Record<number, number[]> = {};
        for (const practitioner of practitioners) {
          try {
            const data = await apiService.getPractitionerAppointmentTypes(practitioner.id);
            const appointmentTypes = data?.appointment_types;
            if (appointmentTypes && Array.isArray(appointmentTypes)) {
              for (const at of appointmentTypes) {
                if (at?.id) {
                  const typeId = at.id;
                  if (!assignments[typeId]) {
                    assignments[typeId] = [];
                  }
                  assignments[typeId].push(practitioner.id);
                }
              }
            }
          } catch (err) {
            logger.error(`Error loading assignments for practitioner ${practitioner.id}:`, err);
          }
        }
        
        setOriginalPractitionerAssignments(assignments);
        setPractitionerAssignments(assignments);
        
        // Billing scenarios will be loaded lazily when service items are expanded
        setOriginalBillingScenarios({});
        setBillingScenarios({});
      } catch (err) {
        logger.error('Error loading service items data:', err);
      } finally {
        isLoadingServiceItemsDataRef.current = false;
      }
    };

    if (settings && !uiState.loading) {
      loadServiceItemsData();
    }
  }, [settings, uiState.loading]);

  // Refresh settings when clinic changes
  // Invalidate cache to ensure fresh data for the new clinic
  const previousClinicIdRef = React.useRef<number | null | undefined>(activeClinicId ?? null);
  React.useEffect(() => {
    const currentClinicId = activeClinicId;
    if (!isLoading && currentClinicId && previousClinicIdRef.current !== currentClinicId && previousClinicIdRef.current !== null && previousClinicIdRef.current !== undefined) {
      // Invalidate cache when clinic changes
      invalidateCacheForFunction(sharedFetchFunctions.getClinicSettings);
      invalidateCacheByPattern('api_getPractitionerStatus_');
      invalidateCacheByPattern('api_getBatchPractitionerStatus_');
      // Reset service items state
      setPractitionerAssignments({});
      setOriginalPractitionerAssignments({});
      setBillingScenarios({});
      setOriginalBillingScenarios({});
      // Force refetch by calling fetchData (skipFetch will be false after invalidation)
      if (fetchData) {
        fetchData();
      }
    }
    // Update ref value
    previousClinicIdRef.current = currentClinicId ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClinicId, isLoading]);

  // Update functions for practitioner assignments and billing scenarios
  const updatePractitionerAssignments = React.useCallback((serviceItemId: number, practitionerIds: number[]) => {
    setPractitionerAssignments(prev => ({
      ...prev,
      [serviceItemId]: practitionerIds,
    }));
  }, []);

  const updateBillingScenarios = React.useCallback((key: string, scenarios: BillingScenario[]) => {
    setBillingScenarios(prev => {
      const updated = { ...prev, [key]: scenarios };
      // If this is the first time we're setting scenarios for this key, also update original
      // (lazy loading - original starts empty, so first load becomes original)
      setOriginalBillingScenarios(prevOriginal => {
        if (!prevOriginal[key]) {
          return { ...prevOriginal, [key]: scenarios };
        }
        return prevOriginal;
      });
      return updated;
    });
  }, []);

  // Extended save function that saves appointment types, practitioner assignments, and billing scenarios
  const saveData = async () => {
    const saveResults = {
      appointmentTypes: false,
      practitionerAssignments: false,
      billingScenarios: false,
    };
    const errors: string[] = [];

    // Check if there are service items changes (practitioner assignments or billing scenarios)
    const hasServiceItemsChanges = 
      JSON.stringify(practitionerAssignments) !== JSON.stringify(originalPractitionerAssignments) ||
      JSON.stringify(billingScenarios) !== JSON.stringify(originalBillingScenarios);

    try {
      // 1. Save appointment types (existing)
      // Note: If there are service items changes, we'll handle success message ourselves
      // to show combined result. Otherwise, saveDataInternal's onSuccess will handle it.
      try {
        await saveDataInternal();
        saveResults.appointmentTypes = true;
        
        // If there are no service items changes, saveDataInternal's onSuccess already showed success
        // If there are service items changes, we'll show combined success/error message below
      } catch (err: any) {
        const errorMsg = `儲存服務項目設定失敗：${err instanceof Error ? err.message : '未知錯誤'}`;
        errors.push(errorMsg);
        logger.error('Error saving appointment types:', err);
        // Don't throw yet - continue to try other operations if there are service items changes
        if (!hasServiceItemsChanges) {
          // If no service items changes, let the error propagate (saveDataInternal already handled it)
          throw err;
        }
      }

      // 2. Save practitioner assignments
      const assignmentChanges = getPractitionerAssignmentChanges();
      const practitionerAssignmentErrors: string[] = [];
      
      if (Object.keys(assignmentChanges).length > 0) {
        // Get all practitioners
        const membersData = await apiService.getMembers();
        const practitioners = membersData.filter(m => m.roles.includes('practitioner'));
        
        // For each practitioner, determine their new appointment type IDs from current state
        for (const practitioner of practitioners) {
          const newTypeIds: number[] = [];
          for (const [serviceItemId, practitionerIds] of Object.entries(practitionerAssignments)) {
            if (practitionerIds.includes(practitioner.id)) {
              newTypeIds.push(parseInt(serviceItemId));
            }
          }
          
          // Get original assignment for this practitioner
          const originalTypeIds: number[] = [];
          for (const [serviceItemId, practitionerIds] of Object.entries(originalPractitionerAssignments)) {
            if (practitionerIds.includes(practitioner.id)) {
              originalTypeIds.push(parseInt(serviceItemId));
            }
          }
          
          // Only save if changed
          if (JSON.stringify(newTypeIds.sort()) !== JSON.stringify(originalTypeIds.sort())) {
            try {
              await apiService.updatePractitionerAppointmentTypes(practitioner.id, newTypeIds);
            } catch (err) {
              const errorMsg = `儲存治療師「${practitioner.full_name}」的指派失敗：${err instanceof Error ? err.message : '未知錯誤'}`;
              logger.error(`Error saving practitioner assignments for practitioner ${practitioner.id}:`, err);
              practitionerAssignmentErrors.push(errorMsg);
              // Continue with other practitioners
            }
          }
        }
        
        // Mark as succeeded if no errors occurred
        if (practitionerAssignmentErrors.length === 0) {
          saveResults.practitionerAssignments = true;
        } else {
          errors.push(...practitionerAssignmentErrors);
        }
      } else {
        // No changes to save
        saveResults.practitionerAssignments = true;
      }

      // 3. Save billing scenarios
      const scenarioChanges = getBillingScenarioChanges();
      const billingScenarioErrors: string[] = [];
      const createdScenarios: Array<{ key: string; tempId: number; realId: number; practitioner_appointment_type_id: number }> = [];
      
      for (const [key, scenarios] of Object.entries(scenarioChanges)) {
        const parts = key.split('-');
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          logger.error(`Invalid billing scenario key format: ${key}`);
          continue;
        }
        const serviceItemId = parseInt(parts[0], 10);
        const practitionerId = parseInt(parts[1], 10);
        
        if (isNaN(serviceItemId) || isNaN(practitionerId)) {
          logger.error(`Invalid billing scenario key values: ${key}`);
          continue;
        }
        
        const originalKey = key;
        const originalScenarios = originalBillingScenarios[originalKey] || [];
        
        // Determine what needs to be created, updated, or deleted
        const originalIds = new Set(originalScenarios.map(s => s.id));
        const currentIds = new Set(scenarios.map(s => s.id));
        
        // Delete scenarios that are no longer present
        for (const originalScenario of originalScenarios) {
          if (!currentIds.has(originalScenario.id)) {
            try {
              await apiService.deleteBillingScenario(serviceItemId, practitionerId, originalScenario.id);
            } catch (err) {
              const errorMsg = `刪除計費方案「${originalScenario.name}」失敗：${err instanceof Error ? err.message : '未知錯誤'}`;
              logger.error(`Error deleting billing scenario ${originalScenario.id}:`, err);
              billingScenarioErrors.push(errorMsg);
            }
          }
        }
        
        // Create or update scenarios
        for (const scenario of scenarios) {
          // Check if this is a temporary ID (negative IDs are temporary)
          const isTemporaryId = scenario.id < 0;
          
          if (!isTemporaryId && originalIds.has(scenario.id)) {
            // Update existing (real ID from backend)
            try {
              await apiService.updateBillingScenario(serviceItemId, practitionerId, scenario.id, {
                name: scenario.name,
                amount: scenario.amount,
                revenue_share: scenario.revenue_share,
                is_default: scenario.is_default,
              });
            } catch (err) {
              const errorMsg = `更新計費方案「${scenario.name}」失敗：${err instanceof Error ? err.message : '未知錯誤'}`;
              logger.error(`Error updating billing scenario ${scenario.id}:`, err);
              billingScenarioErrors.push(errorMsg);
            }
          } else {
            // Create new (either temporary ID or not in original)
            try {
              const response = await apiService.createBillingScenario(serviceItemId, practitionerId, {
                name: scenario.name,
                amount: scenario.amount,
                revenue_share: scenario.revenue_share,
                is_default: scenario.is_default,
              });
              // Track created scenarios to update state after all operations
              createdScenarios.push({
                key,
                tempId: scenario.id,
                realId: response.id,
                practitioner_appointment_type_id: response.practitioner_appointment_type_id,
              });
            } catch (err) {
              const errorMsg = `建立計費方案「${scenario.name}」失敗：${err instanceof Error ? err.message : '未知錯誤'}`;
              logger.error(`Error creating billing scenario:`, err);
              billingScenarioErrors.push(errorMsg);
            }
          }
        }
      }

      // 4. Track billing scenarios save result
      if (Object.keys(scenarioChanges).length > 0) {
        if (billingScenarioErrors.length === 0) {
          saveResults.billingScenarios = true;
        } else {
          errors.push(...billingScenarioErrors);
        }
      } else {
        // No changes to save
        saveResults.billingScenarios = true;
      }

      // 5. Update billing scenarios with real IDs from backend (only if no errors)
      let updatedBillingScenarios = billingScenarios;
      if (createdScenarios.length > 0) {
        updatedBillingScenarios = { ...billingScenarios };
        for (const { key, tempId, realId, practitioner_appointment_type_id } of createdScenarios) {
          const currentScenarios = updatedBillingScenarios[key] || [];
          updatedBillingScenarios[key] = currentScenarios.map(s => 
            s.id === tempId 
              ? { ...s, id: realId, practitioner_appointment_type_id }
              : s
          );
        }
        setBillingScenarios(updatedBillingScenarios);
      }

      // 5. Check if all operations succeeded
      const allSucceeded = saveResults.appointmentTypes && saveResults.practitionerAssignments && saveResults.billingScenarios;
      
      if (!allSucceeded) {
        // Build detailed error message
        const succeededParts: string[] = [];
        const failedParts: string[] = [];
        
        if (saveResults.appointmentTypes) {
          succeededParts.push('服務項目設定');
        } else {
          failedParts.push('服務項目設定');
        }
        
        if (saveResults.practitionerAssignments) {
          succeededParts.push('治療師指派');
        } else {
          failedParts.push('治療師指派');
        }
        
        if (saveResults.billingScenarios) {
          succeededParts.push('計費方案');
        } else {
          failedParts.push('計費方案');
        }
        
        let errorMessage = '部分設定儲存失敗：\n\n';
        if (succeededParts.length > 0) {
          errorMessage += `✅ 已成功儲存：${succeededParts.join('、')}\n\n`;
        }
        if (failedParts.length > 0) {
          errorMessage += `❌ 儲存失敗：${failedParts.join('、')}\n\n`;
        }
        if (errors.length > 0) {
          errorMessage += `詳細錯誤：\n${errors.join('\n')}`;
        }
        
        // Show error via modal and throw to prevent state update
        await alert(errorMessage, '儲存失敗');
        throw new Error(errorMessage);
      }

      // 6. Update original states only after all operations succeed
      setOriginalPractitionerAssignments(JSON.parse(JSON.stringify(practitionerAssignments)));
      setOriginalBillingScenarios(JSON.parse(JSON.stringify(updatedBillingScenarios)));
      
      // 7. Show success message only if all operations succeeded
      // Only show if there were service items changes (otherwise saveDataInternal already showed success)
      if (hasServiceItemsChanges) {
        // Invalidate cache after successful save
        invalidateCacheForFunction(sharedFetchFunctions.getClinicSettings);
        
        // Check if clinic info was changed (from appointment types save)
        if (settings && originalData) {
          const changes = getClinicSectionChanges(settings, originalData);
          if (changes.clinicInfoSettings) {
            setClinicInfoRefreshTrigger(prev => prev + 1);
          }
        }
        
        await alert('所有設定已成功儲存', '成功');
      }
      // If no service items changes, saveDataInternal's onSuccess already handled cache invalidation and success message
    } catch (error: any) {
      logger.error('Error saving service items data:', error);
      throw error;
    }
  };

  // Helper functions to detect changes
  const getPractitionerAssignmentChanges = (): Record<number, number[]> => {
    const changes: Record<number, number[]> = {};
    const allServiceItemIds = new Set([
      ...Object.keys(practitionerAssignments).map(Number),
      ...Object.keys(originalPractitionerAssignments).map(Number),
    ]);
    
    for (const serviceItemId of allServiceItemIds) {
      const current = practitionerAssignments[serviceItemId] || [];
      const original = originalPractitionerAssignments[serviceItemId] || [];
      if (JSON.stringify(current.sort()) !== JSON.stringify(original.sort())) {
        changes[serviceItemId] = current;
      }
    }
    return changes;
  };

  const getBillingScenarioChanges = (): Record<string, BillingScenario[]> => {
    const changes: Record<string, BillingScenario[]> = {};
    const allKeys = new Set([
      ...Object.keys(billingScenarios),
      ...Object.keys(originalBillingScenarios),
    ]);
    
    for (const key of allKeys) {
      const current = billingScenarios[key] || [];
      const original = originalBillingScenarios[key] || [];
      if (JSON.stringify(current) !== JSON.stringify(original)) {
        changes[key] = current;
      }
    }
    return changes;
  };

  // Extended hasUnsavedChanges that includes service items changes
  const hasUnsavedChanges = React.useCallback(() => {
    // Check settings changes (from useSettingsPage)
    const settingsChanged = settings && originalData && 
      JSON.stringify(settings) !== JSON.stringify(originalData);
    
    // Check practitioner assignments changes
    const practitionerAssignmentsChanged = 
      JSON.stringify(practitionerAssignments) !== JSON.stringify(originalPractitionerAssignments);
    
    // Check billing scenarios changes
    const billingScenariosChanged = 
      JSON.stringify(billingScenarios) !== JSON.stringify(originalBillingScenarios);
    
    return settingsChanged || practitionerAssignmentsChanged || billingScenariosChanged;
  }, [settings, originalData, practitionerAssignments, originalPractitionerAssignments, billingScenarios, originalBillingScenarios]);

  // Setup navigation warnings for unsaved changes (including service items)
  useUnsavedChangesDetection({ hasUnsavedChanges });

  // Extend sectionChanges to include service items changes
  const extendedSectionChanges = React.useMemo(() => {
    const practitionerAssignmentsChanged = 
      JSON.stringify(practitionerAssignments) !== JSON.stringify(originalPractitionerAssignments);
    const billingScenariosChanged = 
      JSON.stringify(billingScenarios) !== JSON.stringify(originalBillingScenarios);
    
    return {
      ...sectionChanges,
      serviceItemsSettings: 
        sectionChanges.appointmentSettings || 
        practitionerAssignmentsChanged || 
        billingScenariosChanged,
    };
  }, [sectionChanges, practitionerAssignments, originalPractitionerAssignments, billingScenarios, originalBillingScenarios]);

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
    practitionerAssignments,
    originalPractitionerAssignments,
    billingScenarios,
    originalBillingScenarios,
    updatePractitionerAssignments,
    updateBillingScenarios,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};


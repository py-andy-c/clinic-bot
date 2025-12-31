import React, { useEffect } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../hooks/useAuth';
import { LoadingSpinner } from '../../components/shared';
import ResourcesSettings from '../../components/ResourcesSettings';
import SettingsBackButton from '../../components/SettingsBackButton';
import PageHeader from '../../components/PageHeader';
import { useResourcesStore } from '../../stores/resourcesStore';
import { useModal } from '../../contexts/ModalContext';
import { useUnsavedChangesDetection } from '../../hooks/useUnsavedChangesDetection';
import { useFormErrorScroll } from '../../hooks/useFormErrorScroll';
import { ResourcesSettingsFormSchema } from '../../schemas/api';

type ResourcesSettingsFormData = z.infer<typeof ResourcesSettingsFormSchema>;

const SettingsResourcesPage: React.FC = () => {
  const { isClinicAdmin } = useAuth();
  const { alert } = useModal();
  const { onInvalid: scrollOnError } = useFormErrorScroll();
  const { 
    resourceTypes,
    resourcesByType,
    loading, 
    saving,
    error, 
    loadData, 
    saveAll,
    hasUnsavedChanges
  } = useResourcesStore();

  const methods = useForm<ResourcesSettingsFormData>({
    resolver: zodResolver(ResourcesSettingsFormSchema),
    defaultValues: {
      resourceTypes: resourceTypes.map(t => ({
        ...t,
        resources: resourcesByType[t.id] || []
      }))
    },
    mode: 'onBlur',
  });

  const { reset, handleSubmit, formState: { isDirty } } = methods;

  const onInvalid = (errors: Record<string, unknown>) => {
    scrollOnError(errors, methods, { expandType: 'resourceType' });
  };

  const hasInitializedRef = React.useRef(false);

  // Sync form with store data only on initial load
  useEffect(() => {
    if (!loading && resourceTypes.length > 0 && !hasInitializedRef.current) {
      reset({
        resourceTypes: resourceTypes.map(t => ({
          ...t,
          resources: resourcesByType[t.id] || []
        }))
      });
      hasInitializedRef.current = true;
    }
  }, [loading, resourceTypes, resourcesByType, reset]);

  // Setup navigation warnings for unsaved changes
  useUnsavedChangesDetection({ hasUnsavedChanges: () => isDirty || hasUnsavedChanges() });

  // Load data when component mounts
  useEffect(() => {
    loadData();
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [loadData]);

  const onFormSubmit = async (data: ResourcesSettingsFormData) => {
    // Sync RHF state to store before saving
    useResourcesStore.getState().syncFromRHF(data);
    
    const success = await saveAll();
    if (success) {
      alert('資源設定已成功儲存');
      // Reset form with fresh data from store (with real IDs)
      reset({
        resourceTypes: useResourcesStore.getState().resourceTypes.map(t => ({
          ...t,
          resources: useResourcesStore.getState().resourcesByType[t.id] || []
        }))
      });
    }
  };

  if (loading && !error) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  const unsaved = isDirty || hasUnsavedChanges();

  return (
    <FormProvider {...methods}>
      <SettingsBackButton />
      <div className="flex justify-between items-center mb-6">
        <PageHeader title="設備資源設定" />
        {unsaved && (
          <button
            type="button"
            onClick={handleSubmit(onFormSubmit, onInvalid)}
            disabled={saving}
            className="btn-primary text-sm px-4 py-2"
          >
            {saving ? '儲存中...' : '儲存變更'}
          </button>
        )}
      </div>

      <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm p-0 md:p-6">
        <ResourcesSettings isClinicAdmin={isClinicAdmin} />
      </div>

      {/* Error Display */}
      {error && (
        <div className="mt-6 bg-white rounded-lg border border-red-200 shadow-sm p-4 md:p-6">
          <div className="p-4 bg-red-50 border border-red-200 rounded-md">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">錯誤</h3>
                <div className="mt-2 text-sm text-red-700 whitespace-pre-line">
                  {error}
                </div>
                <button 
                  onClick={() => loadData()}
                  className="mt-3 text-sm font-medium text-red-800 hover:text-red-900 underline"
                >
                  重試
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </FormProvider>
  );
};

export default SettingsResourcesPage;

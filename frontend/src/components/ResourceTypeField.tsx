import React, { useState, useEffect } from 'react';
import { useFormContext, useFieldArray, useWatch } from 'react-hook-form';
import { Resource } from '../types';
import { useResourcesStore } from '../stores/resourcesStore';
import { useModal } from '../contexts/ModalContext';
import { LoadingSpinner } from './shared';
import { FormField, FormInput } from './forms';
import { z } from 'zod';
import { ResourcesSettingsFormSchema } from '../schemas/api';

type ResourcesSettingsFormData = z.infer<typeof ResourcesSettingsFormSchema>;

interface ResourceTypeFieldProps {
  index: number;
  isClinicAdmin: boolean;
  onDelete: () => void;
  onServiceItemsNavigation: (e: React.MouseEvent) => void;
}

export const ResourceTypeField: React.FC<ResourceTypeFieldProps> = ({
  index,
  isClinicAdmin,
  onDelete,
  onServiceItemsNavigation,
}) => {
  const { control, setValue } = useFormContext<ResourcesSettingsFormData>();
  const { fields, append, remove } = useFieldArray({
    control,
    name: `resourceTypes.${index}.resources` as const,
  });

  const {
    associatedServiceItems,
    loadingResources,
    loadResources,
    loadAssociatedServiceItems,
    addResourceLocal,
    updateResourceTypeLocal,
    updateResourceLocal,
  } = useResourcesStore();

  const typeId = useWatch({
    control,
    name: `resourceTypes.${index}.id` as const,
  });

  const typeName = useWatch({
    control,
    name: `resourceTypes.${index}.name` as const,
  });

  const [isExpanded, setIsExpanded] = useState(false);
  const { confirm } = useModal();

  useEffect(() => {
    const handleExpand = (e: any) => {
      if (e.detail.type === 'resourceType' && e.detail.index === index) {
        setIsExpanded(true);
      }
    };
    window.addEventListener('form-error-expand', handleExpand);
    return () => window.removeEventListener('form-error-expand', handleExpand);
  }, [index]);

  // Load resources and service items when expanding
  const toggleExpand = async () => {
    const nextExpanded = !isExpanded;
    setIsExpanded(nextExpanded);

    if (nextExpanded && typeId < 1000000000000) {
      await loadResources(typeId);
      await loadAssociatedServiceItems(typeId);
    }
  };

  // Sync expanded resources from store to RHF if RHF is empty but store has them
  // This handles the "loading on expand" case
  useEffect(() => {
    if (isExpanded && typeId < 1000000000000) {
      const storeResources = useResourcesStore.getState().resourcesByType[typeId] || [];
      if (fields.length === 0 && storeResources.length > 0) {
        setValue(`resourceTypes.${index}.resources`, storeResources as any);
      }
    }
  }, [isExpanded, typeId, fields.length, index, setValue]);

  const handleAddResource = () => {
    // We still call the store because it has the naming logic
    // but we'll also update the form state
    const currentResources = fields.length;
    addResourceLocal(typeId);
    
    // Get the new resource from the store (it was just added)
    setTimeout(() => {
      const updatedStoreResources = useResourcesStore.getState().resourcesByType[typeId] || [];
      if (updatedStoreResources.length > currentResources) {
        const newResource = updatedStoreResources[updatedStoreResources.length - 1];
        append(newResource as any);
      }
    }, 0);
  };

  const handleDeleteResource = async (resIndex: number, resource: Resource) => {
    const confirmed = await confirm(
      `確定要刪除資源「${resource.name || '未命名'}」嗎？\n\n如果此資源正在使用中，將無法刪除。`,
      '確認刪除'
    );
    if (confirmed) {
      remove(resIndex);
      // We should also update the store to keep it in sync for associated items display if needed
      // removeResourceLocal(typeId, resource.id);
    }
  };

  const serviceItems = associatedServiceItems[typeId] || [];

  return (
    <div className={`border border-gray-200 rounded-lg ${!isExpanded ? 'hover:bg-gray-50 transition-colors' : ''}`}>
      {/* Header (Collapsed) */}
      {!isExpanded && (
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={toggleExpand}
                  className="text-left flex-1 flex items-center gap-2 p-2 rounded"
                >
                  <svg
                    className="w-5 h-5 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">
                        {typeName || <span className="text-gray-400 italic">未命名資源類型</span>}
                      </span>
                    </div>
                    <div className="text-sm text-gray-500 mt-1 flex items-center gap-2">
                      <span>{fields.length} 個資源</span>
                      <span className="text-gray-300">·</span>
                      <span>{serviceItems.length} 個相關服務</span>
                    </div>
                  </div>
                </button>
              </div>
            </div>
            {isClinicAdmin && (
              <div className="flex items-center gap-2 ml-4">
                <button
                  type="button"
                  onClick={onDelete}
                  className="text-red-600 hover:text-red-800 p-2"
                  title="刪除"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Expanded Content */}
      {isExpanded && (
        <div className="p-4">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <button
                  type="button"
                  onClick={toggleExpand}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
                >
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                  <span>收起</span>
                </button>
                {isClinicAdmin && (
                  <button
                    type="button"
                    onClick={onDelete}
                    className="text-red-600 hover:text-red-800 p-1.5 hover:bg-red-50 rounded transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>

              <FormField name={`resourceTypes.${index}.name`} label="資源類型名稱">
                <FormInput
                  name={`resourceTypes.${index}.name`}
                  placeholder="例如：治療室、運動設備"
                  disabled={!isClinicAdmin}
                  onBlur={(e) => {
                    // Sync to store on blur for other components that depend on store
                    updateResourceTypeLocal(typeId, e.target.value);
                  }}
                />
              </FormField>

              {/* Associated Service Items */}
              {serviceItems.length > 0 && (
                <div className="border border-gray-100 rounded-md p-3 bg-blue-50/50">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider">相關服務項目</h4>
                    <button onClick={onServiceItemsNavigation} className="text-xs text-primary-600 hover:underline font-medium flex items-center gap-1">
                      修改需求 <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-x-2 gap-y-1 items-center">
                    {serviceItems.map((item, idx) => (
                      <React.Fragment key={item.id}>
                        {idx > 0 && <span className="text-gray-300 text-xs mx-1">|</span>}
                        <div className="text-sm text-gray-600">
                          {item.name} (需 {item.required_quantity} 個)
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}

              {/* Resources List */}
              <div className="space-y-3 pt-2">
                <label className="block text-sm font-medium text-gray-700">資源清單</label>
                {loadingResources.has(typeId) ? (
                  <div className="flex justify-center py-4"><LoadingSpinner size="sm" /></div>
                ) : fields.length === 0 ? (
                  <div className="text-sm text-gray-500 italic py-2">尚無資源</div>
                ) : (
                  <div className="space-y-2">
                    {fields.map((field, resIndex) => (
                      <div key={field.id} className="flex gap-3 items-start group">
                        <div className="flex-1">
                          <FormField name={`resourceTypes.${index}.resources.${resIndex}.name`}>
                            <FormInput
                              name={`resourceTypes.${index}.resources.${resIndex}.name`}
                              placeholder="資源名稱"
                              className="text-sm py-1.5"
                              disabled={!isClinicAdmin}
                              onBlur={(e) => {
                                const description = (field as unknown as Resource).description || '';
                                updateResourceLocal((field as unknown as Resource).id, e.target.value, description);
                              }}
                            />
                          </FormField>
                        </div>
                        <div className="flex-[2]">
                          <FormInput
                            name={`resourceTypes.${index}.resources.${resIndex}.description`}
                            placeholder="備注 (選填)"
                            className="text-sm py-1.5"
                            disabled={!isClinicAdmin}
                            onBlur={(e) => {
                              const name = (field as unknown as Resource).name || '';
                              updateResourceLocal((field as unknown as Resource).id, name, e.target.value);
                            }}
                          />
                        </div>
                        {isClinicAdmin && (
                          <button
                            type="button"
                            onClick={() => handleDeleteResource(resIndex, field as unknown as Resource)}
                            className="text-gray-400 hover:text-red-600 p-1.5 mt-0.5"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {isClinicAdmin && (
                  <button
                    type="button"
                    onClick={handleAddResource}
                    className="btn-secondary text-xs w-full py-2 flex items-center justify-center gap-1"
                  >
                    <span>+ 新增資源</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


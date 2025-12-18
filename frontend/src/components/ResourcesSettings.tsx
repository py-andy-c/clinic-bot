import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useFormContext, useFieldArray } from 'react-hook-form';
import { ResourceType } from '../types';
import { useResourcesStore } from '../stores/resourcesStore';
import { useModal } from '../contexts/ModalContext';
import { ResourceTypeField } from './ResourceTypeField';
import { z } from 'zod';
import { ResourcesSettingsFormSchema } from '../schemas/api';

type ResourcesSettingsFormData = z.infer<typeof ResourcesSettingsFormSchema>;

interface ResourcesSettingsProps {
  isClinicAdmin: boolean;
}

const ResourcesSettings: React.FC<ResourcesSettingsProps> = ({ isClinicAdmin }) => {
  const { confirm } = useModal();
  const navigate = useNavigate();
  const { control } = useFormContext<ResourcesSettingsFormData>();
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'resourceTypes',
  });

  const {
    removeResourceTypeLocal,
  } = useResourcesStore();

  const handleServiceItemsNavigation = async (e: React.MouseEvent) => {
    e.preventDefault();
    // In RHF, we check isDirty
    navigate('/admin/clinic/settings/service-items');
  };

  const handleAddResourceType = () => {
    // Manually create a new type object with a temporary ID
    const newTypeId = Date.now();
    append({
      id: newTypeId,
      name: '',
      resources: []
    } as any); // Type cast here is OK for the complex nested structure
    
    // Notify store to create a placeholder if needed, but RHF is the source of truth for the list now
    // We'll sync everything to the store on Save
  };

  const handleDeleteResourceType = async (index: number, type: ResourceType) => {
    const confirmed = await confirm(
      `確定要刪除資源類型「${type.name || '未命名'}」嗎？\n\n此操作無法復原。`,
      '確認刪除'
    );
    if (confirmed) {
      remove(index);
      removeResourceTypeLocal(type.id);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2">
          <label className="block text-sm font-medium text-gray-700">資源類型</label>
        </div>

        <div className="space-y-4">
          {fields.map((field, index) => (
            <ResourceTypeField
              key={field.id}
              index={index}
              isClinicAdmin={isClinicAdmin}
              onDelete={() => handleDeleteResourceType(index, field as unknown as ResourceType)}
              onServiceItemsNavigation={handleServiceItemsNavigation}
            />
          ))}
        </div>

        {isClinicAdmin && (
          <div className="mt-6">
            <button
              type="button"
              onClick={handleAddResourceType}
              className="btn-secondary text-sm w-full py-3"
            >
              + 新增資源類型
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ResourcesSettings;

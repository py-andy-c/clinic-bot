import React, { useState, useEffect } from 'react';
import { useFormContext, useFieldArray } from 'react-hook-form';
import { Member, AppointmentType } from '../types';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { useServiceItemsStore } from '../stores/serviceItemsStore';
import { AppointmentTypeField } from './AppointmentTypeField';

interface ServiceItemsSettingsProps {
  onAddType: () => void;
  onRemoveType: (index: number) => Promise<void> | void;
  isClinicAdmin: boolean;
}

const ServiceItemsSettings: React.FC<ServiceItemsSettingsProps> = ({
  onAddType,
  onRemoveType,
  isClinicAdmin,
}) => {
  const { control, getValues, setValue } = useFormContext();
  const { fields, move } = useFieldArray({
    control,
    name: 'appointment_types',
  });
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const {
    billingScenarios,
    loadingScenarios,
    loadBillingScenarios: loadBillingScenariosFromStore,
  } = useServiceItemsStore();

  const [members, setMembers] = useState<Member[]>([]);
  const [failedScenarios, setFailedScenarios] = useState<Set<string>>(new Set());

  // Load members (practitioners)
  useEffect(() => {
    if (isClinicAdmin) {
      loadMembers();
    }
  }, [isClinicAdmin]);

  const loadMembers = async () => {
    try {
      const membersData = await apiService.getMembers();
      const practitioners = membersData.filter(m => m.roles.includes('practitioner'));
      setMembers(practitioners);
    } catch (err) {
      logger.error('Error loading members:', err);
    }
  };

  const handleLoadBillingScenarios = React.useCallback(async (serviceItemId: number, practitionerId: number) => {
    const key = `${serviceItemId}-${practitionerId}`;
    if (loadingScenarios.has(key) || billingScenarios[key] || failedScenarios.has(key)) return;

    try {
      await loadBillingScenariosFromStore(serviceItemId, practitionerId);
      setFailedScenarios(prev => {
        const newSet = new Set(prev);
        newSet.delete(key);
        return newSet;
      });
    } catch (err) {
      logger.error('Error loading billing scenarios:', err);
      setFailedScenarios(prev => new Set(prev).add(key));
    }
  }, [loadingScenarios, billingScenarios, failedScenarios, loadBillingScenariosFromStore]);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;

    const currentTypes = getValues('appointment_types') as AppointmentType[];
    const newTypes = [...currentTypes];
    const [removed] = newTypes.splice(draggedIndex, 1);
    if (!removed) return;
    newTypes.splice(targetIndex, 0, removed);

    // Update display_order for all items
    const serviceOrders = newTypes
      .filter((at): at is AppointmentType => at !== undefined)
      .map((at, index) => ({
        id: at.id,
        display_order: index,
      }));

    // Update form values
    newTypes.forEach((_at, index) => {
      setValue(`appointment_types.${index}.display_order`, index, { shouldDirty: true });
    });

    // Move in form array
    move(draggedIndex, targetIndex);

    // Save order to backend (optimistic update)
    try {
      // Only save if all items have real IDs (not temporary)
      const allHaveRealIds = serviceOrders.every(so => so.id < 1000000000000);
      if (allHaveRealIds) {
        await apiService.bulkUpdateAppointmentTypeOrder(serviceOrders);
      }
    } catch (err) {
      logger.error('Error updating service order:', err);
      // Reload on error
      const freshSettings = await apiService.getClinicSettings();
      if (freshSettings?.appointment_types) {
        setValue('appointment_types', freshSettings.appointment_types);
      }
    }

    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2">
          <label className="block text-sm font-medium text-gray-700">服務項目</label>
        </div>

        <div className="space-y-4">
          {fields.map((field, index) => (
            <div
              key={field.id}
              draggable={isClinicAdmin}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              className={draggedIndex === index ? 'opacity-50' : ''}
            >
              <div className="flex items-start gap-2">
                {isClinicAdmin && (
                  <div className="text-gray-400 cursor-move mt-4 pt-1">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                    </svg>
                  </div>
                )}
                <div className="flex-1">
                  <AppointmentTypeField
                    index={index}
                    isClinicAdmin={isClinicAdmin}
                    onRemove={() => onRemoveType(index)}
                    members={members}
                    loadingScenarios={loadingScenarios}
                    onLoadBillingScenarios={handleLoadBillingScenarios}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {isClinicAdmin && (
          <div className="mt-4">
            <button
              type="button"
              onClick={onAddType}
              className="btn-secondary text-sm w-full"
            >
              + 新增服務項目
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ServiceItemsSettings;

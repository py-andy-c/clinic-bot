import React, { useState, useEffect } from 'react';
import { useFormContext, useFieldArray } from 'react-hook-form';
import { Member } from '../types';
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
  const { control } = useFormContext();
  const { fields } = useFieldArray({
    control,
    name: 'appointment_types',
  });

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

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2">
          <label className="block text-sm font-medium text-gray-700">服務項目</label>
        </div>

        <div className="space-y-4">
          {fields.map((field, index) => (
            <AppointmentTypeField
              key={field.id}
              index={index}
              isClinicAdmin={isClinicAdmin}
              onRemove={() => onRemoveType(index)}
              members={members}
              loadingScenarios={loadingScenarios}
              onLoadBillingScenarios={handleLoadBillingScenarios}
            />
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

import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { LoadingSpinner } from './shared';

interface PractitionerAppointmentTypesProps {
  selectedAppointmentTypeIds?: number[];
  availableTypes?: Array<{ id: number; name: string; duration_minutes: number }> | undefined; // Available appointment types from clinic settings
  onAppointmentTypeChange?: (selectedTypeIds: number[]) => void;
  showSaveButton?: boolean;
  onSave?: () => void;
  saving?: boolean;
}

const PractitionerAppointmentTypes: React.FC<PractitionerAppointmentTypesProps> = ({
  selectedAppointmentTypeIds: externalSelectedTypeIds,
  availableTypes: externalAvailableTypes,
  onAppointmentTypeChange,
  showSaveButton = false,
  onSave,
  saving = false,
}) => {
  const { user } = useAuth();
  const [availableTypes, setAvailableTypes] = React.useState<any[]>(externalAvailableTypes || []);
  const [selectedTypeIds, setSelectedTypeIds] = React.useState<number[]>(externalSelectedTypeIds || []);
  const [loading, setLoading] = React.useState(externalAvailableTypes === undefined); // Only show loading if we need to fetch
  const [error, setError] = React.useState<string | null>(null);

  // Use external state if provided, otherwise use internal state
  const currentSelectedTypeIds = externalSelectedTypeIds !== undefined ? externalSelectedTypeIds : selectedTypeIds;
  const currentAvailableTypes = externalAvailableTypes || availableTypes;

  // Update available types when external prop changes
  React.useEffect(() => {
    if (externalAvailableTypes) {
      setAvailableTypes(externalAvailableTypes);
    }
  }, [externalAvailableTypes]);

  // Only fetch data if props are not provided (backward compatibility)
  React.useEffect(() => {
    if (externalAvailableTypes === undefined || externalSelectedTypeIds === undefined) {
      fetchData();
    }
  }, [user]);

  // Update internal state when external state changes
  React.useEffect(() => {
    if (externalSelectedTypeIds !== undefined) {
      setSelectedTypeIds(externalSelectedTypeIds);
    }
  }, [externalSelectedTypeIds]);

  const fetchData = async () => {
    if (!user?.user_id) return;

    try {
      setLoading(true);
      setError(null);

      let typesToUse = externalAvailableTypes || availableTypes;

      // Only fetch clinic settings if not provided as prop
      if (externalAvailableTypes === undefined) {
        const clinicSettings = await apiService.getClinicSettings();
        const fetchedTypes = clinicSettings.appointment_types;
        setAvailableTypes(fetchedTypes);
        typesToUse = fetchedTypes;
      }

      // Only fetch practitioner's appointment types if not provided as prop
      if (externalSelectedTypeIds === undefined) {
        const practitionerData = await apiService.getPractitionerAppointmentTypes(user.user_id);
        const selectedIds = practitionerData.appointment_types.map((at: { id: number }) => at.id);
        
        // Defensive filtering: only include IDs that exist in available types
        const availableTypeIds = new Set(typesToUse.map((at: { id: number }) => at.id));
        const validSelectedIds = selectedIds.filter((id: number) => availableTypeIds.has(id));
        setSelectedTypeIds(validSelectedIds);
      }

      // Note: Practitioner status is no longer needed here - it's fetched by GlobalWarnings
      // and cached appropriately. This component only needs appointment types.

    } catch (err) {
      logger.error('Error fetching practitioner appointment types:', err);
      setError('無法載入預約類型設定');
    } finally {
      setLoading(false);
    }
  };

  const handleTypeToggle = (typeId: number) => {
    const newSelectedTypeIds = currentSelectedTypeIds.includes(typeId)
      ? currentSelectedTypeIds.filter(id => id !== typeId)
      : [...currentSelectedTypeIds, typeId];

    if (onAppointmentTypeChange) {
      onAppointmentTypeChange(newSelectedTypeIds);
    } else {
      setSelectedTypeIds(newSelectedTypeIds);
    }
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900">提供的預約類型</h2>
        {showSaveButton && onSave && (
        <button
            onClick={onSave}
          disabled={saving}
          className="btn-primary"
        >
            {saving ? '儲存中...' : '儲存更變'}
        </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">{error}</p>
        </div>
      )}


      <div className="space-y-3">
        {currentAvailableTypes.map((type) => {
          // Defensive check: ensure type ID is valid
          const isSelected = currentSelectedTypeIds.includes(type.id);
          return (
            <div key={type.id} className="flex items-center p-4 border border-gray-200 rounded-lg hover:border-primary-300">
              <input
                type="checkbox"
                id={`type-${type.id}`}
                checked={isSelected}
                onChange={() => handleTypeToggle(type.id)}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
              />
              <label htmlFor={`type-${type.id}`} className="ml-3 flex-1 cursor-pointer">
                <div>
                  <span className="font-medium text-gray-900">{type.name}</span>
                  <span className="ml-2 text-sm text-gray-500">({type.duration_minutes} 分鐘)</span>
                </div>
              </label>
            </div>
          );
        })}

        {currentAvailableTypes.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            診所尚未設定任何預約類型，請至<Link to="/admin/clinic/settings" className="text-primary-600 hover:text-primary-700 underline">診所設定頁面</Link>設定。
          </div>
        )}
      </div>
    </div>
  );
};

export default PractitionerAppointmentTypes;

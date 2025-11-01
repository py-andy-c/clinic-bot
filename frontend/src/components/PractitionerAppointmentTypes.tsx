import React from 'react';
import { useAuth } from '../hooks/useAuth';
import { apiService } from '../services/api';

interface PractitionerAppointmentTypesProps {
  selectedAppointmentTypeIds?: number[];
  onAppointmentTypeChange?: (selectedTypeIds: number[]) => void;
  showSaveButton?: boolean;
  onSave?: () => void;
  saving?: boolean;
}

const PractitionerAppointmentTypes: React.FC<PractitionerAppointmentTypesProps> = ({
  selectedAppointmentTypeIds: externalSelectedTypeIds,
  onAppointmentTypeChange,
  showSaveButton = false,
  onSave,
  saving = false,
}) => {
  const { user } = useAuth();
  const [availableTypes, setAvailableTypes] = React.useState<any[]>([]);
  const [selectedTypeIds, setSelectedTypeIds] = React.useState<number[]>(externalSelectedTypeIds || []);
  const [hasAvailability, setHasAvailability] = React.useState<boolean>(true);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Use external state if provided, otherwise use internal state
  const currentSelectedTypeIds = externalSelectedTypeIds !== undefined ? externalSelectedTypeIds : selectedTypeIds;

  React.useEffect(() => {
    fetchData();
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

      // Get clinic settings to get all available appointment types
      const clinicSettings = await apiService.getClinicSettings();
      setAvailableTypes(clinicSettings.appointment_types);

      // Get practitioner's current appointment types (only set internal state if not using external)
      const practitionerData = await apiService.getPractitionerAppointmentTypes(user.user_id);
      if (externalSelectedTypeIds === undefined) {
        setSelectedTypeIds(practitionerData.appointment_types.map((at: any) => at.id));
      }

      // Get practitioner's status (includes availability check)
      const status = await apiService.getPractitionerStatus(user.user_id);
      setHasAvailability(status.has_availability);

    } catch (err) {
      console.error('Error fetching practitioner appointment types:', err);
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
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
        {availableTypes.map((type) => (
          <div key={type.id} className="flex items-center p-4 border border-gray-200 rounded-lg hover:border-primary-300">
            <input
              type="checkbox"
              id={`type-${type.id}`}
              checked={currentSelectedTypeIds.includes(type.id)}
              onChange={() => handleTypeToggle(type.id)}
              className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
            />
            <label htmlFor={`type-${type.id}`} className="ml-3 flex-1 cursor-pointer">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-gray-900">{type.name}</span>
                  <span className="ml-2 text-sm text-gray-500">({type.duration_minutes} 分鐘)</span>
                </div>
                {currentSelectedTypeIds.includes(type.id) && (
                  <span className="text-primary-600">✓</span>
                )}
              </div>
            </label>
          </div>
        ))}

        {availableTypes.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            診所尚未設定任何預約類型，請聯絡管理員。
          </div>
        )}
      </div>
    </div>
  );
};

export default PractitionerAppointmentTypes;

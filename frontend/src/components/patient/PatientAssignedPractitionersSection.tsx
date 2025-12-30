import React, { useState, useEffect } from 'react';
import { Patient } from '../../types';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../types/api';

interface PatientAssignedPractitionersSectionProps {
  patient: Patient;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onUpdate: (data: { assigned_practitioner_ids?: number[] }) => Promise<void>;
  canEdit: boolean;
  practitioners: Array<{ id: number; full_name: string }>;
}

export const PatientAssignedPractitionersSection: React.FC<PatientAssignedPractitionersSectionProps> = ({
  patient,
  isEditing,
  onEdit,
  onCancel,
  onUpdate,
  canEdit,
  practitioners,
}) => {
  const [selectedPractitionerIds, setSelectedPractitionerIds] = useState<number[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Helper function to extract practitioner IDs from patient data
  const getAssignedPractitionerIds = (): number[] => {
    if (patient.assigned_practitioner_ids !== undefined) {
      return patient.assigned_practitioner_ids;
    }
    if (patient.assigned_practitioners) {
      return patient.assigned_practitioners
        .filter((p) => p.is_active !== false)
        .map((p) => p.id);
    }
    return [];
  };

  // Initialize selected practitioners from patient data
  useEffect(() => {
    setSelectedPractitionerIds(getAssignedPractitionerIds());
  }, [patient]);

  const handleSave = async () => {
    setError(null);
    try {
      setIsSaving(true);
      await onUpdate({
        assigned_practitioner_ids: selectedPractitionerIds,
      });
    } catch (err) {
      logger.error('Failed to update assigned practitioners:', err);
      setError(getErrorMessage(err));
      throw err;
    } finally {
      setIsSaving(false);
    }
  };

  const handleTogglePractitioner = (practitionerId: number) => {
    setSelectedPractitionerIds((prev) => {
      if (prev.includes(practitionerId)) {
        return prev.filter((id) => id !== practitionerId);
      } else {
        return [...prev, practitionerId];
      }
    });
  };

  if (isEditing) {
    return (
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">指定治療師</h2>
        
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="space-y-3">
          {practitioners.map((practitioner) => (
            <label
              key={practitioner.id}
              className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedPractitionerIds.includes(practitioner.id)}
                onChange={() => handleTogglePractitioner(practitioner.id)}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
              />
              <span className="text-sm font-medium text-gray-700">
                {practitioner.full_name}
              </span>
            </label>
          ))}

          {practitioners.length === 0 && (
            <p className="text-sm text-gray-500">目前沒有可用的治療師</p>
          )}
        </div>

        <div className="flex space-x-3 pt-4">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? '儲存中...' : '儲存'}
          </button>
          <button
            onClick={onCancel}
            disabled={isSaving}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50"
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  // Get assigned practitioners by mapping IDs to practitioner objects
  const assignedPractitionerIds = getAssignedPractitionerIds();
  const assignedPractitioners = assignedPractitionerIds
    .map((id) => practitioners.find((p) => p.id === id))
    .filter((p): p is { id: number; full_name: string } => p !== undefined);

  return (
    <div className="bg-white rounded-lg shadow-md p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-gray-900">指定治療師</h2>
        {canEdit && (
          <button
            onClick={onEdit}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            編輯
          </button>
        )}
      </div>

      {assignedPractitioners.length > 0 ? (
        <ul className="space-y-2">
          {assignedPractitioners.map((practitioner) => (
            <li key={practitioner.id} className="text-sm text-gray-900">
              {practitioner.full_name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500">尚未指定治療師</p>
      )}
    </div>
  );
};


import React from 'react';
import { AppointmentType } from '../types';

interface ClinicAppointmentTypesProps {
  appointmentTypes: AppointmentType[];
  onAddType: () => void;
  onUpdateType: (index: number, field: keyof AppointmentType, value: string | number) => void;
  onRemoveType: (index: number) => void;
  showSaveButton?: boolean;
  onSave?: () => void;
  saving?: boolean;
  isClinicAdmin?: boolean;
}

const ClinicAppointmentTypes: React.FC<ClinicAppointmentTypesProps> = ({
  appointmentTypes,
  onAddType,
  onUpdateType,
  onRemoveType,
  showSaveButton = false,
  onSave,
  saving = false,
  isClinicAdmin = false,
}) => {
  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-gray-900">預約類型</h2>
        <div className="flex items-center space-x-3">
          {showSaveButton && onSave && (
            <button
              onClick={onSave}
              disabled={saving}
              className="btn-primary"
            >
              {saving ? '儲存中...' : '儲存更變'}
            </button>
          )}
          {isClinicAdmin && (
            <button
              onClick={onAddType}
              className="btn-secondary text-sm"
            >
              新增類型
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {appointmentTypes.map((type, index) => (
          <div key={type.id} className="flex items-center space-x-4 p-4 border border-gray-200 rounded-lg">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                類型名稱
              </label>
              <input
                type="text"
                value={type.name}
                onChange={(e) => onUpdateType(index, 'name', e.target.value)}
                className="input"
                placeholder="例如：初診評估"
                disabled={!isClinicAdmin}
              />
            </div>

            <div className="w-32">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                時長 (分鐘)
              </label>
              <input
                type="number"
                value={type.duration_minutes}
                onChange={(e) => {
                  const value = e.target.value;
                  onUpdateType(index, 'duration_minutes', value);
                }}
                className="input"
                min="15"
                max="480"
                disabled={!isClinicAdmin}
              />
            </div>

            {isClinicAdmin && (
              <div className="flex items-end">
                <button
                  onClick={() => onRemoveType(index)}
                  className="text-red-600 hover:text-red-800 p-2"
                  title="刪除"
                >
                  🗑️
                </button>
              </div>
            )}
          </div>
        ))}

        {appointmentTypes.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            尚未設定任何預約類型
          </div>
        )}
      </div>
    </div>
  );
};

export default ClinicAppointmentTypes;

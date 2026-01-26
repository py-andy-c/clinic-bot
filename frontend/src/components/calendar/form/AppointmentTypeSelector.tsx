import React, { useMemo } from 'react';

interface AppointmentType {
  id: number;
  name: string;
  duration_minutes: number;
}

interface AppointmentTypeSelectorProps {
  value: number | null;
  options: AppointmentType[];
  onChange: (id: number | null) => void;
  originalTypeId?: number | null | undefined;
  disabled?: boolean;
  requiredError?: string | undefined;
}

export const AppointmentTypeSelector: React.FC<AppointmentTypeSelectorProps> = ({
  value,
  options,
  onChange,
  originalTypeId,
  disabled = false,
  requiredError,
}) => {
  const sortedOptions = useMemo(() => {
    return [...options].sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'));
  }, [options]);

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        預約類型 <span className="text-red-500">*</span>
        {requiredError && <span className="ml-2 text-sm font-normal text-red-600">{requiredError}</span>}
      </label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value ? parseInt(e.target.value) : null)}
        disabled={disabled}
        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
        required
        data-testid="appointment-type-selector"
      >
        <option value="">選擇預約類型</option>
        {sortedOptions.map((type) => (
          <option key={type.id} value={type.id}>
            {type.name} ({type.duration_minutes}分鐘){type.id === originalTypeId ? ' (原)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
};


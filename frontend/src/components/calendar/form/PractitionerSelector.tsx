import React from 'react';

interface Practitioner {
  id: number;
  full_name: string;
}

interface PractitionerSelectorProps {
  value: number | null;
  options: Practitioner[];
  onChange: (id: number | null) => void;
  isLoading?: boolean;
  originalPractitionerId?: number | null | undefined;
  disabled?: boolean;
  appointmentTypeSelected: boolean;
  assignedPractitionerIds?: Set<number> | number[] | undefined; // IDs of assigned practitioners for the selected patient
}

export const PractitionerSelector: React.FC<PractitionerSelectorProps> = ({
  value,
  options,
  onChange,
  isLoading = false,
  originalPractitionerId,
  disabled = false,
  appointmentTypeSelected,
  assignedPractitionerIds,
}) => {
  // Convert assignedPractitionerIds to Set for easy lookup
  const assignedIdsSet = React.useMemo(() => {
    if (!assignedPractitionerIds) return new Set<number>();
    if (assignedPractitionerIds instanceof Set) return assignedPractitionerIds;
    return new Set(assignedPractitionerIds);
  }, [assignedPractitionerIds]);

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        治療師 <span className="text-red-500">*</span>
      </label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value ? parseInt(e.target.value) : null)}
        disabled={disabled || !appointmentTypeSelected || isLoading}
        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
        required
      >
        <option value="">選擇治療師</option>
        {isLoading ? (
          <option value="" disabled>載入中...</option>
        ) : (
          options.map((p) => {
            const isAssigned = assignedIdsSet.has(p.id);
            const isOriginal = p.id === originalPractitionerId;
            return (
              <option key={p.id} value={p.id}>
                {p.full_name}
                {isAssigned ? ' (指定治療師)' : ''}
                {isOriginal ? ' (原)' : ''}
              </option>
            );
          })
        )}
      </select>
      {appointmentTypeSelected && !isLoading && options.length === 0 && (
        <p className="text-sm text-gray-500 mt-1">此預約類型目前沒有可用的治療師</p>
      )}
    </div>
  );
};


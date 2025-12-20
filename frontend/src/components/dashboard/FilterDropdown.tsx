import React from 'react';

export interface PractitionerOption {
  id: number;
  full_name: string;
}

export interface ServiceItemOption {
  id: number;
  name: string;
  receipt_name?: string | null;
  is_custom?: boolean; // If true, this is a custom service item
}

export interface ServiceTypeGroupOption {
  id: number;
  name: string;
}

export type FilterDropdownType = 'practitioner' | 'service' | 'group';

export interface FilterDropdownProps {
  type: FilterDropdownType;
  value: string | number | null;
  onChange: (value: string | number | null) => void;
  practitioners?: PractitionerOption[];
  serviceItems?: ServiceItemOption[];
  groups?: ServiceTypeGroupOption[];
  standardServiceItemIds?: Set<number>; // IDs of standard service items (for detecting custom items)
  hasNullPractitionerInData?: boolean; // Indicates if data contains null practitioners (for showing "無" option)
  className?: string;
}

export const FilterDropdown: React.FC<FilterDropdownProps> = ({
  type,
  value,
  onChange,
  practitioners = [],
  serviceItems = [],
  groups = [],
  standardServiceItemIds,
  hasNullPractitionerInData = false,
  className = '',
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = e.target.value;
    if (newValue === '') {
      onChange(null);
    } else if (newValue === 'null') {
      onChange('null');
    } else if (newValue === '-1') {
      onChange('-1'); // Ungrouped
    } else if (newValue.startsWith('custom:')) {
      onChange(newValue);
    } else {
      onChange(Number(newValue));
    }
  };

  if (type === 'practitioner') {
    const standardPractitioners = practitioners.filter(p => p.id !== null);
    // Check if null practitioners exist in data (not just in members list)
    const hasNullPractitioner = hasNullPractitionerInData;

    return (
      <select
        value={value === null ? '' : value === 'null' ? 'null' : String(value)}
        onChange={handleChange}
        className={`w-full px-3 py-2 border border-gray-300 rounded-md text-sm ${className}`}
      >
        <option value="">全部</option>
        {standardPractitioners.length > 0 && (
          <>
            <option disabled style={{ backgroundColor: '#f3f4f6', color: '#9ca3af' }}>
              ─────────────
            </option>
            {standardPractitioners.map((practitioner) => (
              <option key={practitioner.id} value={practitioner.id}>
                {practitioner.full_name}
              </option>
            ))}
            {hasNullPractitioner && (
              <>
                <option disabled style={{ backgroundColor: '#f3f4f6', color: '#9ca3af' }}>
                  ─────────────
                </option>
                <option value="null" style={{ color: '#6b7280' }}>
                  無治療師
                </option>
              </>
            )}
          </>
        )}
      </select>
    );
  }

  // Service item dropdown
  const standardItems = serviceItems.filter(item => {
    if (standardServiceItemIds) {
      return standardServiceItemIds.has(item.id);
    }
    return !item.is_custom;
  });
  const customItems = serviceItems.filter(item => {
    if (standardServiceItemIds) {
      return !standardServiceItemIds.has(item.id);
    }
    return item.is_custom;
  });

  return (
    <select
      value={value === null ? '' : String(value)}
      onChange={handleChange}
      className={`w-full px-3 py-2 border border-gray-300 rounded-md text-sm ${className}`}
    >
      <option value="">全部</option>
      {standardItems.length > 0 && (
        <>
          <option disabled style={{ backgroundColor: '#f3f4f6', color: '#9ca3af' }}>
            ─────────────
          </option>
          {standardItems.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </>
      )}
      {customItems.length > 0 && (
        <>
          <option disabled style={{ backgroundColor: '#f3f4f6', color: '#9ca3af' }}>
            ─────────────
          </option>
          {customItems.map((item) => (
            <option
              key={item.id}
              value={`custom:${item.receipt_name || item.name}`}
              style={{ fontStyle: 'italic', color: '#6b7280' }}
            >
              {item.receipt_name || item.name} (自訂)
            </option>
          ))}
        </>
      )}
    </select>
  );

  // Group dropdown
  if (type === 'group') {
    return (
      <select
        value={value === null ? '' : value === '-1' ? '-1' : String(value)}
        onChange={handleChange}
        className={`w-full px-3 py-2 border border-gray-300 rounded-md text-sm ${className}`}
      >
        <option value="">全部</option>
        {groups.length > 0 && (
          <>
            <option disabled style={{ backgroundColor: '#f3f4f6', color: '#9ca3af' }}>
              ─────────────
            </option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
            <option disabled style={{ backgroundColor: '#f3f4f6', color: '#9ca3af' }}>
              ─────────────
            </option>
            <option value="-1" style={{ color: '#6b7280' }}>
              未分類
            </option>
          </>
        )}
      </select>
    );
  }

  return null;
};

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

export type FilterDropdownType = 'practitioner' | 'service';

export interface FilterDropdownProps {
  type: FilterDropdownType;
  value: string | number | null;
  onChange: (value: string | number | null) => void;
  practitioners?: PractitionerOption[];
  serviceItems?: ServiceItemOption[];
  standardServiceItemIds?: Set<number>; // IDs of standard service items (for detecting custom items)
  className?: string;
}

export const FilterDropdown: React.FC<FilterDropdownProps> = ({
  type,
  value,
  onChange,
  practitioners = [],
  serviceItems = [],
  standardServiceItemIds,
  className = '',
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = e.target.value;
    if (newValue === '') {
      onChange(null);
    } else if (newValue === 'null') {
      onChange('null');
    } else if (newValue.startsWith('custom:')) {
      onChange(newValue);
    } else {
      onChange(Number(newValue));
    }
  };

  if (type === 'practitioner') {
    const standardPractitioners = practitioners.filter(p => p.id !== null);
    const hasNullPractitioner = practitioners.some(p => p.id === null);

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
                  無
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
              {item.receipt_name || item.name}
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
              style={{ fontStyle: 'italic' }}
            >
              {item.receipt_name || item.name} <span style={{ color: '#9ca3af', fontStyle: 'normal' }}>(自訂)</span>
            </option>
          ))}
        </>
      )}
    </select>
  );
};

import React from 'react';
import { FilterDropdown, PractitionerOption, ServiceItemOption, ServiceTypeGroupOption } from './FilterDropdown';
import { TimeRangePresets, TimeRangePreset } from './TimeRangePresets';
import { InfoButton } from '../shared';

export interface DashboardFiltersProps {
  // Date filters
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  
  // Practitioner filter
  practitionerId: number | string | null;
  onPractitionerChange: (id: number | string | null) => void;
  practitioners: PractitionerOption[];
  hasNullPractitionerInData: boolean;
  
  // Group filter (conditional)
  hasGroups: boolean;
  groupId: number | string | null;
  onGroupChange: (id: number | string | null) => void;
  groups: ServiceTypeGroupOption[];
  
  // Service item filter (conditional)
  serviceItemId: number | string | null;
  onServiceItemChange: (id: number | string | null) => void;
  serviceItems: ServiceItemOption[];
  standardServiceItemIds: Set<number>;
  
  // Actions
  onApplyFilters: () => void;
  onTimeRangePreset: (preset: TimeRangePreset) => void;
  activePreset: TimeRangePreset | null;
  
  // Optional checkbox (for RevenueDistributionPage)
  checkbox?: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: string;
    infoButton?: {
      onClick: () => void;
      ariaLabel: string;
    };
  };
  
}

export const DashboardFilters: React.FC<DashboardFiltersProps> = ({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  practitionerId,
  onPractitionerChange,
  practitioners,
  hasNullPractitionerInData,
  hasGroups,
  groupId,
  onGroupChange,
  groups,
  serviceItemId,
  onServiceItemChange,
  serviceItems,
  standardServiceItemIds,
  onApplyFilters,
  onTimeRangePreset,
  activePreset,
  checkbox,
}) => {
  // Calculate grid columns based on visible filters
  // Base: Start Date, End Date, Practitioner = 3
  // + Group (if hasGroups) = +1
  // + Service Item (if !hasGroups || groupId) = +1
  // + Checkbox (if present) = +1
  const visibleColumns = 3 + // start, end, practitioner
    (hasGroups ? 1 : 0) + // group
    ((!hasGroups || groupId) ? 1 : 0) + // service item
    (checkbox ? 1 : 0); // checkbox
  
  // Map to Tailwind grid classes (max 6 columns supported)
  const gridColsMap: Record<number, string> = {
    3: 'md:grid-cols-3',
    4: 'md:grid-cols-4',
    5: 'md:grid-cols-5',
    6: 'md:grid-cols-6',
  };
  const gridCols = gridColsMap[visibleColumns] || 'md:grid-cols-4';
  
  // Handle group change with service item clearing
  const handleGroupChange = (value: number | string | null) => {
    onGroupChange(value);
    if (!value) {
      onServiceItemChange(null);
    }
  };

  return (
    <div className="bg-white md:rounded-lg md:border md:border-gray-200 md:shadow-sm px-3 py-2 md:px-4 md:py-4 mb-4 md:mb-6">
      <div className={`grid grid-cols-1 gap-3 md:gap-4 ${gridCols}`}>
        {/* Start Date */}
        <div>
          <label className="block text-xs md:text-sm font-medium text-gray-700 mb-1">
            開始日期
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
        </div>

        {/* End Date */}
        <div>
          <label className="block text-xs md:text-sm font-medium text-gray-700 mb-1">
            結束日期
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => onEndDateChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
        </div>

        {/* Practitioner */}
        <div>
          <label className="block text-xs md:text-sm font-medium text-gray-700 mb-1">
            治療師
          </label>
          <FilterDropdown
            type="practitioner"
            value={practitionerId}
            onChange={onPractitionerChange}
            practitioners={practitioners}
            hasNullPractitionerInData={hasNullPractitionerInData}
          />
        </div>

        {/* Group (conditional) */}
        {hasGroups && (
          <div>
            <label className="block text-xs md:text-sm font-medium text-gray-700 mb-1">
              群組
            </label>
            <FilterDropdown
              type="group"
              value={groupId}
              onChange={handleGroupChange}
              groups={groups}
            />
          </div>
        )}

        {/* Service Item (conditional) */}
        {(!hasGroups || groupId) && (
          <div>
            <label className="block text-xs md:text-sm font-medium text-gray-700 mb-1">
              服務項目
            </label>
            <FilterDropdown
              type="service"
              value={serviceItemId}
              onChange={onServiceItemChange}
              serviceItems={serviceItems}
              standardServiceItemIds={standardServiceItemIds}
            />
          </div>
        )}

        {/* Checkbox (optional) */}
        {checkbox && (
          <div className="flex items-end gap-2">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={checkbox.checked}
                onChange={(e) => checkbox.onChange(e.target.checked)}
                className="mr-2"
              />
              <span className="text-xs md:text-sm text-gray-700">
                {checkbox.label}
              </span>
              {checkbox.infoButton && (
                <InfoButton
                  onClick={checkbox.infoButton.onClick}
                  ariaLabel={checkbox.infoButton.ariaLabel}
                />
              )}
            </label>
          </div>
        )}
      </div>

      {/* Time Range Presets */}
      <div className="mt-3 md:mt-4">
        <TimeRangePresets 
          onSelect={onTimeRangePreset} 
          activePreset={activePreset}
        />
      </div>

      {/* Apply Button (bottom-right, in its own row) */}
      <div className="mt-3 md:mt-4 flex justify-end">
        <button
          onClick={onApplyFilters}
          className="w-full md:w-auto px-3 md:px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-xs md:text-sm font-medium"
        >
          套用篩選
        </button>
      </div>
    </div>
  );
};


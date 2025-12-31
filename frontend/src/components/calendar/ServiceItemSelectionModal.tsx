/**
 * ServiceItemSelectionModal Component
 * 
 * Modal for selecting service items with grouping support.
 * Used in CheckoutModal, EditAppointmentModal, and CreateAppointmentModal when grouping is enabled.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { BaseModal } from '../shared/BaseModal';
import { SearchInput } from '../shared/SearchInput';
import { useDebounce } from '../../hooks/useDebounce';
import { useIsMobile } from '../../hooks/useIsMobile';
import { AppointmentType, ServiceTypeGroup } from '../../types';

interface ServiceItemSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (serviceItemId: number | undefined) => void; // undefined = custom "其他" option (CheckoutModal only)
  serviceItems: AppointmentType[]; // Must include service_type_group_id, display_order, and duration_minutes
  groups: ServiceTypeGroup[]; // Must include display_order
  selectedServiceItemId?: number | undefined; // Currently selected item ID (for future use - not used in current implementation)
  originalTypeId?: number | null | undefined; // For marking original selection with (原)
  title?: string; // Default: "選擇服務項目"
  showCustomOtherOption?: boolean; // Show separate "其他" option for custom items (CheckoutModal only)
}

export const ServiceItemSelectionModal: React.FC<ServiceItemSelectionModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  serviceItems,
  groups,
  selectedServiceItemId: _selectedServiceItemId, // eslint-disable-line @typescript-eslint/no-unused-vars
  originalTypeId,
  title = '選擇服務項目',
  showCustomOtherOption = false,
}) => {
  const isMobile = useIsMobile();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<number | 'other'>>(new Set());
  
  const debouncedSearchQuery = useDebounce(searchQuery, 400);

  // Initialize expanded groups
  React.useEffect(() => {
    if (isOpen) {
      // Expand all groups by default
      const allGroupIds = new Set<number | 'other'>(
        groups.map(g => g.id)
      );
      if (serviceItems.some(item => !item.service_type_group_id)) {
        allGroupIds.add('other');
      }
      setExpandedGroups(allGroupIds);
      setSearchQuery(''); // Reset search when modal opens
    }
  }, [isOpen, groups, serviceItems]);

  // Group items by service_type_group_id
  const groupedItems = useMemo(() => {
    const grouped: Partial<Record<number | 'other', AppointmentType[]>> = {};
    serviceItems.forEach(item => {
      const groupId = item.service_type_group_id ?? 'other';
      if (!grouped[groupId]) grouped[groupId] = [];
      grouped[groupId]!.push(item);
    });
    
    // Sort items within each group by display_order
    Object.keys(grouped).forEach(key => {
      const groupId = key === 'other' ? 'other' : Number(key);
      if (grouped[groupId]) {
        grouped[groupId]!.sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
      }
    });
    
    return grouped;
  }, [serviceItems]);

  // Sort groups by display_order
  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => a.display_order - b.display_order);
  }, [groups]);

  // Filter items by search query
  const filteredItems = useMemo(() => {
    if (!debouncedSearchQuery.trim()) {
      return groupedItems;
    }
    
    const queryLower = debouncedSearchQuery.toLowerCase().trim();
    const filtered: Partial<Record<number | 'other', AppointmentType[]>> = {};
    
    Object.keys(groupedItems).forEach(key => {
      const groupId = key === 'other' ? 'other' : Number(key);
      const items = groupedItems[groupId]?.filter(item =>
        item.name.toLowerCase().includes(queryLower)
      ) || [];
      if (items.length > 0) {
        filtered[groupId] = items;
      }
    });
    
    return filtered;
  }, [groupedItems, debouncedSearchQuery]);

  // Get ungrouped items count
  const ungroupedItemsCount = useMemo(() => {
    return serviceItems.filter(item => !item.service_type_group_id).length;
  }, [serviceItems]);

  // Toggle group expansion
  const toggleGroup = useCallback((groupId: number | 'other') => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  // Handle item selection
  const handleItemSelect = useCallback((itemId: number | undefined) => {
    onSelect(itemId);
    onClose();
  }, [onSelect, onClose]);

  // Check if item is original selection
  const isOriginalSelection = useCallback((item: AppointmentType) => {
    return item.id === originalTypeId;
  }, [originalTypeId]);

  // Check if group should be shown (has visible items)
  const shouldShowGroup = useCallback((groupId: number | 'other') => {
    return groupId in filteredItems && (filteredItems[groupId]?.length ?? 0) > 0;
  }, [filteredItems]);

  // Check if "其他" group should be shown
  const shouldShowOtherGroup = useMemo(() => {
    return groups.length > 0 && ungroupedItemsCount > 0 && shouldShowGroup('other');
  }, [groups.length, ungroupedItemsCount, shouldShowGroup]);

  if (!isOpen) return null;

  const hasAnyVisibleGroups = sortedGroups.some(g => shouldShowGroup(g.id)) || shouldShowOtherGroup;

  return (
    <BaseModal
      onClose={onClose}
      fullScreen={isMobile}
      className={isMobile ? '!p-0' : '!p-0 max-w-md'}
      aria-label={title}
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        </div>

        {/* Search Bar */}
        <div className="px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="搜尋"
            className="w-full"
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto py-2">
          {!hasAnyVisibleGroups && debouncedSearchQuery.trim() ? (
            <div className="py-16 text-center text-gray-500 text-sm">
              找不到符合的項目
            </div>
          ) : !hasAnyVisibleGroups ? (
            <div className="py-16 text-center text-gray-500 text-sm">
              目前沒有服務項目
            </div>
          ) : (
            <div className="py-2">
              {/* Regular groups */}
              {sortedGroups.map(group => {
                if (!shouldShowGroup(group.id)) return null;
                
                const items = filteredItems[group.id] ?? [];
                const isExpanded = expandedGroups.has(group.id);
                
                return (
                  <div key={group.id} className="border-b border-gray-200">
                    {/* Group Header */}
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.id)}
                      className="w-full px-6 py-3.5 bg-gray-50 hover:bg-gray-100 border-b border-gray-200 flex items-center justify-between transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-sm font-semibold text-gray-900">{group.name}</span>
                        <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full font-medium">
                          {items.length}項
                        </span>
                      </div>
                      <svg
                        className={`w-[18px] h-[18px] text-gray-600 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </button>

                    {/* Group Items */}
                    {isExpanded && (
                      <div className="bg-white">
                        {items.map(item => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleItemSelect(item.id)}
                            className="w-full px-6 py-3.5 pl-8 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm text-gray-900">{item.name}</span>
                              {item.duration_minutes && (
                                <span className="text-xs text-gray-500">
                                  ({item.duration_minutes}分鐘)
                                </span>
                              )}
                              {isOriginalSelection(item) && (
                                <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                                  原
                                </span>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* "其他" Group */}
              {shouldShowOtherGroup && (
                <div className="border-b border-gray-200">
                  <button
                    type="button"
                    onClick={() => toggleGroup('other')}
                    className="w-full px-6 py-3.5 bg-gray-50 hover:bg-gray-100 border-b border-gray-200 flex items-center justify-between transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-semibold text-gray-900">其他</span>
                      <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full font-medium">
                        {filteredItems['other']?.length ?? 0}項
                      </span>
                    </div>
                    <svg
                      className={`w-[18px] h-[18px] text-gray-600 transition-transform ${expandedGroups.has('other') ? '' : '-rotate-90'}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>

                  {expandedGroups.has('other') && (
                    <div className="bg-white">
                      {(filteredItems['other'] ?? []).map(item => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleItemSelect(item.id)}
                          className="w-full px-6 py-3.5 pl-8 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm text-gray-900">{item.name}</span>
                            {item.duration_minutes && (
                              <span className="text-xs text-gray-500">
                                ({item.duration_minutes}分鐘)
                              </span>
                            )}
                            {isOriginalSelection(item) && (
                              <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                                原
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Custom "其他" Option (CheckoutModal only) */}
              {showCustomOtherOption && (
                <div className="border-b border-gray-200">
                  <button
                    type="button"
                    onClick={() => handleItemSelect(undefined)}
                    className="w-full px-6 py-3.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <span className="text-sm text-gray-900">其他</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </BaseModal>
  );
};


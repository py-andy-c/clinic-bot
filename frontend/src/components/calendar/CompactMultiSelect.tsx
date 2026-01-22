import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useDebounce } from '../../hooks/useDebounce';
import { useIsMobile } from '../../hooks/useIsMobile';
import styles from './CompactMultiSelect.module.css';

export interface SelectableItem {
  id: number;
  name: string;
}

export interface SelectedItem extends SelectableItem {
  color: string;
}

interface CompactMultiSelectProps {
  selectedItems: SelectedItem[];
  allItems: SelectableItem[];
  onSelectionChange: (selectedIds: number[]) => void;
  maxSelections?: number;
  placeholder: string;
  disabled?: boolean;
  'data-testid'?: string;
}

export const CompactMultiSelect: React.FC<CompactMultiSelectProps> = ({
  selectedItems,
  allItems,
  onSelectionChange,
  maxSelections = 10,
  placeholder,
  disabled = false,
  'data-testid': testId,
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [focusedItemIndex, setFocusedItemIndex] = useState(-1);
  const debouncedSearchQuery = useDebounce(searchQuery, 200);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  // Get IDs of selected items for quick lookup
  const selectedIds = useMemo(() => new Set(selectedItems.map(item => item.id)), [selectedItems]);

  // Filter available items (exclude selected, filter by search)
  const availableItems = useMemo(() => {
    const unselectedItems = allItems.filter(item => !selectedIds.has(item.id));

    if (!debouncedSearchQuery.trim()) {
      return unselectedItems;
    }

    const query = debouncedSearchQuery.toLowerCase().trim();
    return unselectedItems.filter(item =>
      item.name.toLowerCase().includes(query)
    );
  }, [allItems, selectedIds, debouncedSearchQuery]);

  // Handle clicking outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
        setSearchQuery('');
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isDropdownOpen) return;

      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          setIsDropdownOpen(false);
          setSearchQuery('');
          setFocusedItemIndex(-1);
          inputRef.current?.blur();
          break;
        case 'ArrowDown':
          event.preventDefault();
          setFocusedItemIndex(prevIndex =>
            prevIndex < availableItems.length - 1 ? prevIndex + 1 : 0
          );
          break;
        case 'ArrowUp':
          event.preventDefault();
          setFocusedItemIndex(prevIndex =>
            prevIndex > 0 ? prevIndex - 1 : availableItems.length - 1
          );
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          if (focusedItemIndex >= 0 && focusedItemIndex < availableItems.length && availableItems[focusedItemIndex]) {
            handleItemSelect(availableItems[focusedItemIndex]);
          }
          break;
        case 'Tab':
          // Allow default tab behavior to move focus away from dropdown
          setIsDropdownOpen(false);
          setSearchQuery('');
          setFocusedItemIndex(-1);
          break;
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDropdownOpen, availableItems, focusedItemIndex]);

  const handleInputFocus = () => {
    if (disabled || selectedItems.length >= maxSelections) return;
    setIsDropdownOpen(true);
    setFocusedItemIndex(-1);
  };

  const handleInputBlur = () => {
    // Keep dropdown open if user might be clicking on items
    setTimeout(() => {
      if (!dropdownRef.current?.contains(document.activeElement)) {
        setIsDropdownOpen(false);
        setSearchQuery('');
        setFocusedItemIndex(-1);
      }
    }, 150);
  };

  const handleItemSelect = (item: SelectableItem) => {
    if (selectedIds.has(item.id) || selectedItems.length >= maxSelections) return;

    const newSelectedIds = [...selectedItems.map(item => item.id), item.id];
    onSelectionChange(newSelectedIds);
    // Keep dropdown open for multiple selections
    // Reset search to show all available items again
    setSearchQuery('');
  };

  const handleRemoveItem = (itemId: number) => {
    const newSelectedIds = selectedItems
      .filter(item => item.id !== itemId)
      .map(item => item.id);
    onSelectionChange(newSelectedIds);
  };


  return (
    <div className={styles.container} data-testid={testId}>
      {/* Selected Items */}
      {selectedItems.length > 0 && (
        <div className={styles.selectedItems}>
          {selectedItems.map((item) => (
            <div
              key={item.id}
              className={styles.selectedItem}
              style={{ backgroundColor: item.color }}
            >
              <span className={styles.selectedItemText}>{item.name}</span>
              <button
                type="button"
                className={styles.removeButton}
                onClick={() => handleRemoveItem(item.id)}
                aria-label={`移除 ${item.name}`}
                disabled={disabled}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Search Input */}
      <div className={styles.dropdownContainer} ref={dropdownRef}>
        <input
          ref={inputRef}
          type="text"
          className={styles.searchInput}
          placeholder={selectedItems.length >= maxSelections ? `已達 ${maxSelections} 項上限` : placeholder}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          disabled={disabled || selectedItems.length >= maxSelections}
          aria-expanded={isDropdownOpen}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          role="combobox"
          aria-describedby={`${testId}-help`}
          data-testid={`${testId}-search-input`}
        />

        {/* Dropdown */}
        {isDropdownOpen && (
          <div
            className={`${styles.dropdown} ${isMobile ? styles.dropdownMobile : ''}`}
            role="listbox"
            aria-label="Available items"
          >
            <div className={styles.dropdownList}>
              {availableItems.length === 0 ? (
                <div className={styles.emptyState}>
                  {debouncedSearchQuery.trim()
                    ? '找不到項目'
                    : '沒有更多可用項目'
                  }
                </div>
              ) : (
                availableItems.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`${styles.dropdownItem} ${focusedItemIndex === index ? styles.dropdownItemFocused : ''}`}
                    onClick={() => handleItemSelect(item)}
                    role="option"
                    aria-selected={focusedItemIndex === index}
                    data-testid={`${testId}-item-${item.id}`}
                  >
                    <span className={styles.dropdownItemText}>{item.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
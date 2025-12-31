import React, { useState, useEffect, useRef, useMemo } from 'react';
import { getPractitionerColor } from '../utils/practitionerColors';

interface Practitioner {
  id: number;
  full_name: string;
}

interface PractitionerSelectorProps {
  practitioners: Practitioner[];
  selectedPractitionerIds: number[];
  currentUserId: number | null;
  isPractitioner: boolean;
  onChange: (practitionerIds: number[]) => void;
  maxSelectable?: number; // Maximum number of practitioners that can be selected
  showAsList?: boolean; // If true, show all practitioners as a list instead of dropdown
}

const PractitionerSelector: React.FC<PractitionerSelectorProps> = ({
  practitioners,
  selectedPractitionerIds,
  currentUserId,
  isPractitioner,
  onChange,
  maxSelectable = 5, // Default limit of 5 additional practitioners
  showAsList = false, // Default to dropdown mode
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
    return undefined;
  }, [isOpen]);

  // Close dropdown on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  // Filter out current user if they're a practitioner (their calendar is always shown)
  const availablePractitioners = practitioners.filter(
    (p) => !isPractitioner || p.id !== currentUserId
  );

  // Get selected practitioner names for display
  const selectedPractitioners = practitioners.filter((p) =>
    selectedPractitionerIds.includes(p.id)
  );

  // Calculate all practitioner IDs for color indexing
  // For practitioners: [currentUserId, ...selectedPractitionerIds]
  // For non-practitioners: selectedPractitionerIds (no primary, all use colors)
  const allPractitionerIds = useMemo(() => {
    return currentUserId && isPractitioner
      ? [currentUserId, ...selectedPractitionerIds]
      : selectedPractitionerIds;
  }, [currentUserId, isPractitioner, selectedPractitionerIds]);

  // Memoize color calculations for each selected practitioner
  const chipColors = useMemo(() => {
    const primaryId = (currentUserId && isPractitioner) ? currentUserId : -1;
    
    return selectedPractitioners.map((p) => {
      const color = getPractitionerColor(p.id, primaryId, allPractitionerIds);
      
      if (!color) {
        // Primary practitioner (only for practitioners) - use blue
        return {
          id: p.id,
          bg: 'bg-blue-100',
          text: 'text-blue-800',
          border: 'border-blue-200',
          practitionerColor: null
        };
      }

      // Use the practitioner's color for the chip
      return {
        id: p.id,
        bg: '', // Will use inline style
        text: 'text-white',
        border: '', // Will use inline style
        practitionerColor: color
      };
    });
  }, [selectedPractitioners, currentUserId, isPractitioner, allPractitionerIds]);

  // Get color for a specific practitioner (for use in render)
  const getChipColor = (practitionerId: number): { bg: string; text: string; border: string; practitionerColor: string | null } => {
    const chipColor = chipColors.find(c => c.id === practitionerId);
    if (!chipColor) {
      // Fallback (shouldn't happen)
      return {
        bg: 'bg-gray-100',
        text: 'text-gray-800',
        border: 'border-gray-200',
        practitionerColor: null
      };
    }
    return chipColor;
  };

  const handleTogglePractitioner = (practitionerId: number) => {
    if (selectedPractitionerIds.includes(practitionerId)) {
      // Remove practitioner
      onChange(selectedPractitionerIds.filter((id) => id !== practitionerId));
      setErrorMessage(null); // Clear error when removing
    } else {
      // Check if we've reached the limit
      if (selectedPractitionerIds.length >= maxSelectable) {
        setErrorMessage(`最多只能選擇 ${maxSelectable} 位治療師，請先移除其他治療師`);
        // Auto-clear error after 3 seconds
        setTimeout(() => setErrorMessage(null), 3000);
        return;
      }
      // Add practitioner
      onChange([...selectedPractitionerIds, practitionerId]);
      setErrorMessage(null); // Clear error when adding successfully
    }
  };

  const handleRemovePractitioner = (practitionerId: number) => {
    onChange(selectedPractitionerIds.filter((id) => id !== practitionerId));
  };

  // Calculate dropdown position
  // All hooks must be called before any conditional returns
  useEffect(() => {
    if (isOpen && dropdownRef.current && dropdownMenuRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const dropdownHeight = 200; // Estimated max height
      
      // Position above if not enough space below
      if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
        dropdownMenuRef.current.style.bottom = '100%';
        dropdownMenuRef.current.style.top = 'auto';
        dropdownMenuRef.current.style.marginBottom = '0.5rem';
        dropdownMenuRef.current.style.marginTop = '0';
      } else {
        dropdownMenuRef.current.style.top = '100%';
        dropdownMenuRef.current.style.bottom = 'auto';
        dropdownMenuRef.current.style.marginTop = '0.5rem';
        dropdownMenuRef.current.style.marginBottom = '0';
      }
    }
  }, [isOpen]);

  if (availablePractitioners.length === 0) {
    return null;
  }

  // List view - show all practitioners directly
  if (showAsList) {
    return (
      <div className="w-full">
        <div className="flex flex-col gap-2">
          {/* Error message */}
          {errorMessage && (
            <div className="bg-red-50 border border-red-200 rounded-md p-2 text-sm text-red-800">
              {errorMessage}
            </div>
          )}
          
          {/* All practitioners as selectable items */}
          <div className="space-y-2">
            {availablePractitioners.map((practitioner) => {
              const isSelected = selectedPractitionerIds.includes(practitioner.id);
              const isDisabled = !isSelected && selectedPractitionerIds.length >= maxSelectable;
              
              return (
                <button
                  key={practitioner.id}
                  type="button"
                  onClick={() => handleTogglePractitioner(practitioner.id)}
                  disabled={isDisabled}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border-2 transition-colors ${
                    isSelected
                      ? 'bg-primary-50 border-primary-500 text-primary-900'
                      : isDisabled
                      ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-white border-gray-200 text-gray-700 hover:border-primary-300 hover:bg-gray-50'
                  } disabled:opacity-50`}
                >
                  <span className="font-medium">{practitioner.full_name}</span>
                  {isSelected && (
                    <svg
                      className="w-5 h-5 text-primary-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </button>
              );
            })}
            {selectedPractitionerIds.length >= maxSelectable && (
              <div className="px-4 py-2 text-xs text-gray-500 text-center">
                已達上限 ({maxSelectable} 位)
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Dropdown view - original implementation
  return (
    <div className="relative w-full" ref={dropdownRef}>
      <div className="flex flex-col gap-2">
        {/* Error message */}
        {errorMessage && (
          <div className="bg-red-50 border border-red-200 rounded-md p-2 text-sm text-red-800">
            {errorMessage}
          </div>
        )}
        
        <div className="flex flex-wrap gap-2 items-center w-full">
        {/* Selected practitioners as chips */}
        {selectedPractitioners.map((practitioner) => {
          const chipColor = getChipColor(practitioner.id);
          
          // Use inline style if we have a specific color, otherwise use classes
          const chipStyle = chipColor.practitionerColor && chipColor.bg === ''
            ? {
                backgroundColor: chipColor.practitionerColor,
                borderColor: chipColor.practitionerColor,
              }
            : undefined;
          
          const chipClassName = chipColor.bg
            ? `inline-flex items-center px-2 md:px-3 py-1 rounded-full text-xs md:text-sm font-medium ${chipColor.bg} ${chipColor.text} border ${chipColor.border}`
            : 'inline-flex items-center px-2 md:px-3 py-1 rounded-full text-xs md:text-sm font-medium border';
          
          return (
            <span
              key={practitioner.id}
              className={chipClassName}
              style={chipStyle}
            >
              {practitioner.full_name}
              <button
                type="button"
                onClick={() => handleRemovePractitioner(practitioner.id)}
                className={`ml-2 inline-flex items-center justify-center w-4 h-4 rounded-full ${
                  chipColor.practitionerColor
                    ? 'text-white hover:opacity-80'
                    : 'text-primary-600 hover:bg-primary-200'
                } focus:outline-none focus:ring-2 focus:ring-primary-500`}
                aria-label={`移除 ${practitioner.full_name}`}
              >
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </span>
          );
        })}

        {/* Dropdown button */}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex-1 md:flex-initial inline-flex items-center justify-center px-3 py-2 rounded-md text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          aria-expanded={isOpen}
          aria-haspopup="true"
        >
          <span className="mr-2 whitespace-nowrap">加入其他治療師</span>
          <svg
            className={`h-4 w-4 text-gray-500 transition-transform ${
              isOpen ? 'transform rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
        </div>
      </div>

      {/* Dropdown menu */}
      {isOpen && (
        <div 
          ref={dropdownMenuRef}
          className="absolute z-[60] w-full md:w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none"
        >
          <div className="py-1 max-h-64 overflow-y-auto" role="menu">
            {availablePractitioners.map((practitioner) => {
              const isSelected = selectedPractitionerIds.includes(practitioner.id);
              const isDisabled = !isSelected && selectedPractitionerIds.length >= maxSelectable;
              return (
                <button
                  key={practitioner.id}
                  type="button"
                  onClick={() => handleTogglePractitioner(practitioner.id)}
                  disabled={isDisabled}
                  className={`${
                    isSelected
                      ? 'bg-primary-50 text-primary-900'
                      : isDisabled
                      ? 'text-gray-400 cursor-not-allowed'
                      : 'text-gray-700 hover:bg-gray-50'
                  } flex items-center px-4 py-2 text-sm w-full text-left disabled:opacity-50`}
                  role="menuitem"
                  title={isDisabled ? `最多只能選擇 ${maxSelectable} 位治療師` : undefined}
                >
                  <span>{practitioner.full_name}</span>
                </button>
              );
            })}
            {selectedPractitionerIds.length >= maxSelectable && (
              <div className="px-4 py-2 text-xs text-gray-500 border-t border-gray-200">
                已達上限 ({maxSelectable} 位)
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PractitionerSelector;


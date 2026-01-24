/**
 * PractitionerSelectionModal Component
 *
 * Modal for selecting practitioners with conflict checking support.
 * Replaces the dropdown PractitionerSelector with a modal interface.
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { BaseModal } from '../shared/BaseModal';
import { useDebounce } from '../../hooks/useDebounce';
import { useIsMobile } from '../../hooks/useIsMobile';
import { SchedulingConflictResponse } from '../../types';

// Simplified practitioner interface for selection modal
interface SimplePractitioner {
  id: number;
  full_name: string;
}
import { useTranslation } from 'react-i18next';

/**
 * Simple conflict type label for practitioner selection modal
 */
const PractitionerConflictLabel: React.FC<{ conflictInfo: any }> = ({ conflictInfo }) => {
  if (!conflictInfo || !conflictInfo.has_conflict) {
    return null;
  }

  const getConflictTypeLabel = () => {
    // Check in priority order: appointment > exception > availability
    if (conflictInfo.appointment_conflict) {
      return '時間衝突';
    }
    if (conflictInfo.exception_conflict) {
      return '不可用時間';
    }
    if (conflictInfo.conflict_type === 'practitioner_type_mismatch') {
      return '⚠️ 不提供此服務';
    }
    if (conflictInfo.default_availability && !conflictInfo.default_availability.is_within_hours) {
      return '非正常時間';
    }
    if (conflictInfo.selection_insufficient_warnings?.length || conflictInfo.resource_conflict_warnings?.length) {
      return '資源衝突';
    }
    return '有衝突';
  };

  return (
    <span className="text-xs text-red-600 font-medium ml-2">
      {getConflictTypeLabel()}
    </span>
  );
};

export interface PractitionerSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (practitionerId: number | null) => void;
  practitioners: SimplePractitioner[];
  selectedPractitionerId?: number | null;
  originalPractitionerId?: number | null; // For editing scenarios
  assignedPractitionerIds?: Set<number> | number[]; // IDs of assigned practitioners for the selected patient
  practitionerConflicts?: Record<number, SchedulingConflictResponse>; // Conflict data keyed by practitioner ID
  isLoadingConflicts?: boolean;
  title?: string;
}

export const PractitionerSelectionModal: React.FC<PractitionerSelectionModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  practitioners,
  selectedPractitionerId,
  originalPractitionerId,
  assignedPractitionerIds,
  practitionerConflicts = {},
  isLoadingConflicts = false,
  title = '選擇治療師',
}) => {
  const { t } = useTranslation();
  const isMobile = useIsMobile(1024);
  const [searchQuery, setSearchQuery] = useState('');

  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Convert assignedPractitionerIds to Set for easy lookup
  const assignedIdsSet = useMemo(() => {
    if (!assignedPractitionerIds) return new Set<number>();
    if (assignedPractitionerIds instanceof Set) return assignedPractitionerIds;
    return new Set(assignedPractitionerIds);
  }, [assignedPractitionerIds]);

  // Reset search when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Filter practitioners by search query
  const filteredPractitioners = useMemo(() => {
    if (!debouncedSearchQuery.trim()) {
      return practitioners;
    }

    const queryLower = debouncedSearchQuery.toLowerCase().trim();
    return practitioners.filter(practitioner =>
      practitioner.full_name.toLowerCase().includes(queryLower)
    );
  }, [practitioners, debouncedSearchQuery]);

  // Handle practitioner selection
  const handlePractitionerSelect = useCallback((practitionerId: number | null) => {
    onSelect(practitionerId);
    onClose();
  }, [onSelect, onClose]);

  // Check if practitioner is assigned
  const isAssigned = useCallback((practitioner: SimplePractitioner) => {
    return assignedIdsSet.has(practitioner.id);
  }, [assignedIdsSet]);

  // Check if practitioner is original selection (for editing)
  const isOriginal = useCallback((practitioner: SimplePractitioner) => {
    return practitioner.id === originalPractitionerId;
  }, [originalPractitionerId]);

  // Check if practitioner is currently selected
  const isSelected = useCallback((practitioner: SimplePractitioner) => {
    return practitioner.id === selectedPractitionerId;
  }, [selectedPractitionerId]);

  if (!isOpen) return null;

  return (
    <BaseModal
      onClose={onClose}
      fullScreen={isMobile}
      className={isMobile ? '!p-0' : '!p-0 max-w-md'}
      aria-label={title}
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="pt-6 pb-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900 px-6">{title}</h2>
        </div>

        {/* Search Bar - Removed as per requirements */}
        {/* Content will be added here if search is needed later */}

        {/* Content */}
        <div className="flex-1 overflow-y-auto py-2">
          {!isLoadingConflicts && filteredPractitioners.length === 0 && debouncedSearchQuery.trim() ? (
            <div className="py-16 text-center text-gray-500 text-sm">
              找不到符合的治療師
            </div>
          ) : !isLoadingConflicts && filteredPractitioners.length === 0 ? (
            <div className="py-16 text-center text-gray-500 text-sm">
              目前沒有可用的治療師
            </div>
          ) : (
            <div className="py-2">
              {filteredPractitioners.map((practitioner) => (
                <button
                  key={practitioner.id}
                  type="button"
                  onClick={() => handlePractitionerSelect(practitioner.id)}
                  className={`w-full py-3.5 text-left hover:bg-gray-50 border-b border-gray-100 transition-colors px-6 ${isSelected(practitioner) ? 'bg-blue-50 border-blue-200' : ''
                    }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-gray-900">{practitioner.full_name}</span>
                      {isAssigned(practitioner) && (
                        <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">
                          {t('practitioner.assignedPractitioner')}
                        </span>
                      )}
                      {isOriginal(practitioner) && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                          原
                        </span>
                      )}
                      {isSelected(practitioner) && (
                        <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded font-medium ml-2">
                          已選擇
                        </span>
                      )}
                    </div>
                    {/* Conflict type label */}
                    {!isLoadingConflicts && practitionerConflicts[practitioner.id] && (
                      <PractitionerConflictLabel
                        conflictInfo={practitionerConflicts[practitioner.id]}
                      />
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </BaseModal>
  );
};
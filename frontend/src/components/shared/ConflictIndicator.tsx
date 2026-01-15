import React from 'react';
import { ConflictPopover } from './ConflictPopover';
import { SchedulingConflictResponse } from '../../types';

interface ConflictIndicatorProps {
  conflictInfo: SchedulingConflictResponse | null;
  className?: string;
  compact?: boolean;
  filterTypes?: string[] | undefined;
}

/**
 * ConflictIndicator Component
 *
 * Displays a compact conflict indicator (warning icon) that shows conflict details in a popover when clicked.
 * Used in conflict resolution and confirmation steps for appointments.
 */
export const ConflictIndicator: React.FC<ConflictIndicatorProps> = ({
  conflictInfo,
  className = '',
  compact = true,
  filterTypes,
}) => {
  if (!conflictInfo || !conflictInfo.has_conflict) {
    return null;
  }

  const getIcon = () => {
    switch (conflictInfo.conflict_type) {
      case 'past_appointment':
        return '⚠️';
      case 'appointment':
        return '⚠️';
      case 'exception':
        return '⚠️';
      case 'availability':
        return '⚠️';
      case 'resource':
        return '⚠️';
      default:
        return '⚠️';
    }
  };

  return (
    <ConflictPopover conflictInfo={conflictInfo} className={className} filterTypes={filterTypes}>
      <span className="inline-flex items-center text-sm text-amber-600 hover:text-amber-700 cursor-pointer">
        <span className="mr-1">{getIcon()}</span>
        {!compact && <span className="underline">有衝突</span>}
      </span>
    </ConflictPopover>
  );
};


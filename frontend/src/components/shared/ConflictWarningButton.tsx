import React from 'react';
import { ConflictIndicator } from './ConflictIndicator';
import { SchedulingConflictResponse } from '../../types';

interface ConflictWarningButtonProps {
  conflictInfo: SchedulingConflictResponse | null;
  className?: string;
}

/**
 * ConflictWarningButton Component
 *
 * Displays a warning emoji next to buttons when there are scheduling conflicts.
 * Clicking the emoji shows a popover with conflict details.
 * Reuses ConflictIndicator for consistency with conflict resolution page.
 */
export const ConflictWarningButton: React.FC<ConflictWarningButtonProps> = ({
  conflictInfo,
  className = '',
}) => {
  if (!conflictInfo?.has_conflict) {
    return null;
  }

  return (
    <div className={`inline-flex items-center ${className}`}>
      <ConflictIndicator conflictInfo={conflictInfo} compact={true} />
    </div>
  );
};

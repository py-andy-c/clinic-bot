import React from 'react';
import { SchedulingConflictResponse } from '../../types';

interface ConflictDisplayProps {
  conflictInfo: SchedulingConflictResponse | null;
  className?: string;
  ariaLive?: 'off' | 'polite' | 'assertive';
  filterTypes?: string[] | undefined; // Optional filter for specific conflict types
}

/**
 * ConflictDisplay Component
 *
 * Displays scheduling conflict information with appropriate styling based on conflict type.
 * Shows ALL conflicts found, not just the highest priority one.
 * Conflicts are displayed in priority order: past_appointment > appointment > exception > availability > resource.
 */
export const ConflictDisplay: React.FC<ConflictDisplayProps> = ({
  conflictInfo,
  className = '',
  ariaLive = 'polite',
  filterTypes,
}) => {
  if (!conflictInfo || !conflictInfo.has_conflict) {
    return null;
  }

  const getWarningText = (conflictType: string): string | null => {
    switch (conflictType) {
      case 'past_appointment':
        return '時間在過去';

      case 'appointment':
        if (!conflictInfo.appointment_conflict) return null;
        const appt = conflictInfo.appointment_conflict;
        return `與現有預約重疊：${appt.patient_name} | ${appt.start_time}-${appt.end_time} | ${appt.appointment_type}`;

      case 'exception':
        if (!conflictInfo.exception_conflict) return null;
        const exc = conflictInfo.exception_conflict;
        const reasonText = exc.reason ? ` (${exc.reason})` : '';
        return `治療師休診：${exc.start_time}-${exc.end_time}${reasonText}`;

      case 'availability':
        const normalHours = conflictInfo.default_availability?.normal_hours;
        return normalHours
          ? `非治療師正常時間（${normalHours}）`
          : '非治療師正常時間（未設定可用時間）';

      case 'resource':
        if (!conflictInfo.resource_conflicts || conflictInfo.resource_conflicts.length === 0) return null;
        const resourceTexts = conflictInfo.resource_conflicts.map((conflict: any) => {
          if ('total_resources' in conflict && 'allocated_count' in conflict) {
            return `資源不足：${conflict.resource_type_name}（需要：${conflict.required_quantity}，總數：${conflict.total_resources}，已用：${conflict.allocated_count}）`;
          } else {
            return `資源不足：${conflict.resource_type_name}（需要：${conflict.required_quantity}，可用：${conflict.available_quantity}）`;
          }
        });
        return resourceTexts.join('；');

      case 'practitioner_type_mismatch':
        return '治療師不提供此類型';

      default:
        return null;
    }
  };

  const warnings: string[] = [];

  // Show all conflicts by default, or filter if filterTypes is specified
  const shouldShowConflict = (conflictType: string) => {
    return !filterTypes || filterTypes.includes(conflictType);
  };

  // Check for past appointment conflict (highest priority)
  if (shouldShowConflict('past_appointment')) {
    if (conflictInfo.conflict_type === 'past_appointment') {
      const text = getWarningText('past_appointment');
      if (text) warnings.push(text);
    }
  }

  // Check for appointment conflict
  if (shouldShowConflict('appointment')) {
    if (conflictInfo.appointment_conflict) {
      const text = getWarningText('appointment');
      if (text) warnings.push(text);
    }
  }

  // Check for exception conflict
  if (shouldShowConflict('exception')) {
    if (conflictInfo.exception_conflict) {
      const text = getWarningText('exception');
      if (text) warnings.push(text);
    }
  }

  // Check for availability conflict
  if (shouldShowConflict('availability')) {
    if (conflictInfo.default_availability && !conflictInfo.default_availability.is_within_hours) {
      const text = getWarningText('availability');
      if (text) warnings.push(text);
    }
  }

  // Check for resource conflict
  if (shouldShowConflict('resource')) {
    if (conflictInfo.resource_conflicts && conflictInfo.resource_conflicts.length > 0) {
      const text = getWarningText('resource');
      if (text) warnings.push(text);
    }
  }

  // Check for practitioner-type mismatch conflict
  if (shouldShowConflict('practitioner_type_mismatch')) {
    if (conflictInfo.conflict_type === 'practitioner_type_mismatch' || (conflictInfo as any).is_type_mismatch) {
      const text = getWarningText('practitioner_type_mismatch');
      if (text) warnings.push(text);
    }
  }

  if (warnings.length === 0) {
    return null;
  }

  return (
    <div
      className={`rounded border border-amber-300 bg-amber-50 px-2 py-1.5 ${className}`}
      aria-live={ariaLive}
      aria-atomic="true"
      role="alert"
      aria-label="預約警告"
    >
      <div className="text-amber-800 text-xs space-y-1">
        {warnings.map((warning, index) => (
          <div key={index} className="flex items-start gap-1">
            <span className="flex-shrink-0 leading-tight">•</span>
            <span className="leading-tight">{warning}</span>
          </div>
        ))}
      </div>
    </div>
  );
};


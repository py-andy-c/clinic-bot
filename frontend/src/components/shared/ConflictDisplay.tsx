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

  // Check for standard conflicts
  ['past_appointment', 'appointment', 'exception', 'availability', 'practitioner_type_mismatch'].forEach(type => {
    if (shouldShowConflict(type)) {
      let isMatch = false;
      if (type === 'past_appointment') isMatch = conflictInfo.conflict_type === 'past_appointment';
      else if (type === 'appointment') isMatch = !!conflictInfo.appointment_conflict;
      else if (type === 'exception') isMatch = !!conflictInfo.exception_conflict;
      else if (type === 'availability') isMatch = conflictInfo.default_availability && !conflictInfo.default_availability.is_within_hours;
      else if (type === 'practitioner_type_mismatch') isMatch = conflictInfo.conflict_type === 'practitioner_type_mismatch' || (conflictInfo as any).is_type_mismatch;

      if (isMatch) {
        const text = getWarningText(type);
        if (text) warnings.push(text);
      }
    }
  });

  // Resource warnings (hierarchical)
  const resourceWarnings: string[] = [];
  if (shouldShowConflict('resource')) {
    // 1. Group warnings by resource type
    const warningsByType: Record<string, string[]> = {};
    const typeOrder: string[] = []; // To maintain order of appearance

    // Helper to add warning
    const addWarning = (typeName: string, text: string) => {
      if (!warningsByType[typeName]) {
        warningsByType[typeName] = [];
        typeOrder.push(typeName);
      }
      warningsByType[typeName].push(text);
    };

    // 2. Selection insufficient
    if (conflictInfo.selection_insufficient_warnings?.length) {
      conflictInfo.selection_insufficient_warnings.forEach(w => {
        addWarning(w.resource_type_name, `${w.resource_type_name}（需要 ${w.required_quantity} 個，只選了 ${w.selected_quantity} 個）`);
      });
    }

    // 3. Resource conflicts
    if (conflictInfo.resource_conflict_warnings?.length) {
      conflictInfo.resource_conflict_warnings.forEach(w => {
        addWarning(w.resource_type_name, `${w.resource_name} 已被 ${w.conflicting_appointment.practitioner_name} 使用 (${w.conflicting_appointment.start_time}-${w.conflicting_appointment.end_time})`);
      });
    }

    // Flatten to list
    typeOrder.forEach(typeName => {
      resourceWarnings.push(...(warningsByType[typeName] ?? []));
    });
  }

  if (warnings.length === 0 && resourceWarnings.length === 0) {
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
        {/* Standard Warnings */}
        {warnings.map((warning, index) => (
          <div key={index} className="flex items-start gap-1">
            <span className="flex-shrink-0 leading-tight">•</span>
            <span className="leading-tight">{warning}</span>
          </div>
        ))}

        {/* Hierarchical Resource Warnings */}
        {resourceWarnings.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-start gap-1">
              <span className="flex-shrink-0 leading-tight">•</span>
              <span className="leading-tight font-medium">資源選擇</span>
            </div>
            <div className="pl-4 space-y-1">
              {resourceWarnings.map((rw, index) => (
                <div key={index} className="flex items-start gap-1">
                  <span className="flex-shrink-0 leading-tight">•</span>
                  <span className="leading-tight">{rw}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};


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
 * Conflicts are displayed in priority order: past_appointment > practitioner_type_mismatch > appointment > exception > availability > resource.
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

  // Show all conflicts by default, or filter if filterTypes is specified
  const shouldShowConflict = (conflictType: string) => {
    return !filterTypes || filterTypes.includes(conflictType);
  };

  const standardWarnings: { title: string; items?: string[] }[] = [];

  // 1. Time in past
  if (shouldShowConflict('past_appointment') && conflictInfo.conflict_type === 'past_appointment') {
    standardWarnings.push({ title: '時間在過去' });
  }

  // 2. Type mismatch
  if (shouldShowConflict('practitioner_type_mismatch') && (conflictInfo.conflict_type === 'practitioner_type_mismatch' || conflictInfo.is_type_mismatch)) {
    standardWarnings.push({ title: '治療師不提供此類型預約' });
  }

  // 3. Appointment conflicts
  if (shouldShowConflict('appointment')) {
    const appts = conflictInfo.appointment_conflicts || (conflictInfo.appointment_conflict ? [conflictInfo.appointment_conflict] : []);
    if (appts.length > 1) {
      standardWarnings.push({
        title: '與現有預約重疊',
        items: appts.map(appt => `${appt.patient_name} | ${appt.start_time}-${appt.end_time} | ${appt.appointment_type}`)
      });
    } else if (appts.length === 1) {
      const appt = appts[0];
      if (appt) {
        standardWarnings.push({ title: `與現有預約重疊：${appt.patient_name} | ${appt.start_time}-${appt.end_time} | ${appt.appointment_type}` });
      }
    }
  }

  // 4. Exception conflicts
  if (shouldShowConflict('exception')) {
    const exceptions = conflictInfo.exception_conflicts || (conflictInfo.exception_conflict ? [conflictInfo.exception_conflict] : []);
    if (exceptions.length > 1) {
      standardWarnings.push({
        title: '與治療師休診時段重疊',
        items: exceptions.map(exc => exc ? `${exc.start_time}-${exc.end_time}${exc.reason ? ` (${exc.reason})` : ''}` : '')
      });
    } else if (exceptions.length === 1) {
      const exc = exceptions[0];
      if (exc) {
        const reasonText = exc.reason ? ` (${exc.reason})` : '';
        standardWarnings.push({ title: `與治療師休診時段重疊：${exc.start_time}-${exc.end_time}${reasonText}` });
      }
    }
  }

  // 5. Default availability
  if (shouldShowConflict('availability') && conflictInfo.default_availability && !conflictInfo.default_availability.is_within_hours) {
    const normalHours = conflictInfo.default_availability.normal_hours;
    standardWarnings.push({
      title: normalHours
        ? `非治療師正常時間（${normalHours}）`
        : '非治療師正常時間（未設定可用時間）'
    });
  }

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

  if (standardWarnings.length === 0 && resourceWarnings.length === 0) {
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
        {/* Standard and Hierarchical Warnings */}
        {standardWarnings.map((warning, index) => (
          <div key={index} className="space-y-1">
            <div className="flex items-start gap-1">
              <span className="flex-shrink-0 leading-tight">•</span>
              <span className={`leading-tight ${warning.items ? 'font-medium' : ''}`}>{warning.title}</span>
            </div>
            {warning.items && (
              <div className="pl-4 space-y-1">
                {warning.items.map((item, i) => (
                  <div key={i} className="flex items-start gap-1">
                    <span className="flex-shrink-0 leading-tight">•</span>
                    <span className="leading-tight">{item}</span>
                  </div>
                ))}
              </div>
            )}
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

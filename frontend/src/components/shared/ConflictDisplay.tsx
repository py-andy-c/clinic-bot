import React from 'react';
import { SchedulingConflictResponse } from '../../types';

interface ConflictDisplayProps {
  conflictInfo: SchedulingConflictResponse | null;
  className?: string;
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
}) => {
  if (!conflictInfo || !conflictInfo.has_conflict) {
    return null;
  }

  const getConflictDisplay = (conflictType: string) => {
    switch (conflictType) {
      case 'past_appointment':
        return {
          icon: '⚠️',
          title: '此預約時間在過去',
          details: [],
          borderClass: 'border-amber-300 bg-amber-50',
          textClass: 'text-amber-800',
        };

      case 'appointment': {
        if (!conflictInfo.appointment_conflict) return null;
        const appt = conflictInfo.appointment_conflict;
        return {
          icon: '⚠️',
          title: '時間衝突：與現有預約重疊',
          details: [
            `病患：${appt.patient_name}`,
            `預約時間：${appt.start_time}-${appt.end_time}`,
            `預約類型：${appt.appointment_type}`,
          ],
          borderClass: 'border-red-300 bg-red-50',
          textClass: 'text-red-800',
        };
      }

      case 'exception': {
        if (!conflictInfo.exception_conflict) return null;
        const exc = conflictInfo.exception_conflict;
        return {
          icon: '⚠️',
          title: '與治療師不可用時間衝突',
          details: [
            `不可用時間：${exc.start_time}-${exc.end_time}`,
            exc.reason ? `原因：${exc.reason}` : null,
          ].filter((d): d is string => d !== null),
          borderClass: 'border-orange-300 bg-orange-50',
          textClass: 'text-orange-800',
        };
      }

      case 'availability': {
        // Show warning even if practitioner has no default availability set
        const normalHours = conflictInfo.default_availability?.normal_hours;
        return {
          icon: 'ℹ️',
          title: '非正常可用時間',
          details: normalHours
            ? [`正常可用時間：${normalHours}`]
            : ['此治療師尚未設定可用時間'],
          borderClass: 'border-blue-300 bg-blue-50',
          textClass: 'text-blue-800',
        };
      }

      case 'resource': {
        if (!conflictInfo.resource_conflicts || conflictInfo.resource_conflicts.length === 0) return null;
        const resourceDetails = conflictInfo.resource_conflicts.map((conflict: {
          resource_type_name: string;
          required_quantity: number;
          total_resources?: number;
          allocated_count?: number;
          available_quantity?: number;
        }) => {
          // Format: ⚠️ 資源不足：{ResourceTypeName}
          //   需要數量：{RequiredQuantity}
          //   總數：{TotalResources} 個，已分配：{AllocatedCount} 個
          // Note: Date/time is not in conflictInfo, but is shown in the context where this is displayed
          // Support both old format (available_quantity) and new format (total_resources, allocated_count)
          if ('total_resources' in conflict && 'allocated_count' in conflict) {
            return `資源不足：${conflict.resource_type_name}\n   需要數量：${conflict.required_quantity}\n   總數：${conflict.total_resources} 個，已分配：${conflict.allocated_count} 個`;
          } else {
            // Fallback for old format (backward compatibility)
            return `資源不足：${conflict.resource_type_name}\n   需要數量：${conflict.required_quantity}\n   可用數量：${conflict.available_quantity}`;
          }
        });
        return {
          icon: '⚠️',
          title: '資源不足',
          details: resourceDetails,
          borderClass: 'border-yellow-300 bg-yellow-50',
          textClass: 'text-yellow-800',
        };
      }

      default:
        return null;
    }
  };

  // Collect all conflicts in priority order
  type ConflictDisplay = {
    icon: string;
    title: string;
    details: string[];
    borderClass: string;
    textClass: string;
  };
  
  const conflicts: Array<{ type: string; display: ConflictDisplay }> = [];
  
  // Check for past appointment conflict (highest priority)
  // Backend sets conflict_type to "past_appointment" when appointment is in the past
  if (conflictInfo.conflict_type === 'past_appointment') {
    const display = getConflictDisplay('past_appointment');
    if (display) {
      conflicts.push({ type: 'past_appointment', display });
    }
  }
  
  // Check for appointment conflict
  if (conflictInfo.appointment_conflict) {
    const display = getConflictDisplay('appointment');
    if (display) {
      conflicts.push({ type: 'appointment', display });
    }
  }
  
  // Check for exception conflict
  if (conflictInfo.exception_conflict) {
    const display = getConflictDisplay('exception');
    if (display) {
      conflicts.push({ type: 'exception', display });
    }
  }
  
  // Check for availability conflict
  if (conflictInfo.default_availability && !conflictInfo.default_availability.is_within_hours) {
    const display = getConflictDisplay('availability');
    if (display) {
      conflicts.push({ type: 'availability', display });
    }
  }
  
  // Check for resource conflict
  if (conflictInfo.resource_conflicts && conflictInfo.resource_conflicts.length > 0) {
    const display = getConflictDisplay('resource');
    if (display) {
      conflicts.push({ type: 'resource', display });
    }
  }

  if (conflicts.length === 0) {
    return null;
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {conflicts.map((conflict, index) => (
        <div key={index} className={`rounded-md border p-3 ${conflict.display.borderClass}`}>
          <div className={`flex items-start gap-2 ${conflict.display.textClass}`}>
            <span className="text-lg flex-shrink-0">{conflict.display.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm mb-1">
                {conflict.display.title}
              </div>
              {conflict.display.details.map((detail, detailIndex) => (
                <div key={detailIndex} className="text-xs leading-relaxed whitespace-pre-line">
                  {detail}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};


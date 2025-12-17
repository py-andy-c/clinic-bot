import React from 'react';
import { SchedulingConflictResponse } from '../../types';

interface ConflictDisplayProps {
  conflictInfo: SchedulingConflictResponse | null;
  isLoading?: boolean;
  className?: string;
}

/**
 * ConflictDisplay Component
 *
 * Displays scheduling conflict information with appropriate styling based on conflict type.
 * Shows conflicts in priority order: past_appointment > appointment > exception > availability.
 */
export const ConflictDisplay: React.FC<ConflictDisplayProps> = ({
  conflictInfo,
  isLoading = false,
  className = '',
}) => {
  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 text-sm text-gray-500 ${className}`}>
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
        檢查時間衝突中...
      </div>
    );
  }

  if (!conflictInfo || !conflictInfo.has_conflict) {
    return null;
  }

  const getConflictDisplay = () => {
    switch (conflictInfo.conflict_type) {
      case 'past_appointment':
        return {
          icon: '⚠️',
          title: '此預約時間在過去',
          details: [],
          borderClass: 'border-amber-300 bg-amber-50',
          textClass: 'text-amber-800',
        };

      case 'appointment':
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

      case 'exception':
        if (!conflictInfo.exception_conflict) return null;
        const exc = conflictInfo.exception_conflict;
        return {
          icon: '⚠️',
          title: '與治療師不可用時間衝突',
          details: [
            `不可用時間：${exc.start_time}-${exc.end_time}`,
            exc.reason ? `原因：${exc.reason}` : null,
          ].filter(Boolean),
          borderClass: 'border-orange-300 bg-orange-50',
          textClass: 'text-orange-800',
        };

      case 'availability':
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

      default:
        return null;
    }
  };

  const display = getConflictDisplay();
  if (!display) return null;

  return (
    <div className={`rounded-md border p-3 ${display.borderClass} ${className}`}>
      <div className={`flex items-start gap-2 ${display.textClass}`}>
        <span className="text-lg flex-shrink-0">{display.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm mb-1">
            {display.title}
          </div>
          {display.details.map((detail, index) => (
            <div key={index} className="text-xs leading-relaxed">
              {detail}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};


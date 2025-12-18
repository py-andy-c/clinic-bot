import React from 'react';
import { formatAppointmentDateTime } from '../../../utils/calendarUtils';

interface AppointmentReferenceHeaderProps {
  referenceDateTime: Date | null;
  label?: string;
}

export const AppointmentReferenceHeader: React.FC<AppointmentReferenceHeaderProps> = ({ 
  referenceDateTime,
  label = '原預約時間'
}) => {
  if (!referenceDateTime) return null;

  return (
    <div className="mb-4 bg-blue-50 border border-blue-200 rounded-md p-3">
      <p className="text-sm font-medium text-blue-900">
        <span className="font-semibold">{label}：</span>
        {formatAppointmentDateTime(referenceDateTime)}
      </p>
    </div>
  );
};


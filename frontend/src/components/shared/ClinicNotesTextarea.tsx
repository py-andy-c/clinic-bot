import React from 'react';

export interface ClinicNotesTextareaProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  className?: string;
}

/**
 * Shared textarea component for clinic notes (診所備注).
 * Used consistently across CreateAppointmentModal, EditAppointmentModal, and EventModal.
 */
export const ClinicNotesTextarea: React.FC<ClinicNotesTextareaProps> = ({
  value,
  onChange,
  placeholder = '診所內部備注（僅診所人員可見）',
  rows = 4,
  disabled = false,
  className = '',
}) => {
  return (
    <textarea
      value={value}
      onChange={onChange}
      className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 resize-y ${className}`}
      placeholder={placeholder}
      rows={rows}
      maxLength={1000}
      disabled={disabled}
    />
  );
};


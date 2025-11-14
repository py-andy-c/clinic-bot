import React, { useRef, useEffect } from 'react';

interface DateInputProps {
  value: string; // Format: YYYY/MM/DD or empty
  onChange: (value: string) => void;
  className?: string;
  required?: boolean;
  id?: string;
}

/**
 * Date input component with separate fields for year, month, and day.
 * Auto-advances to the next field when the current field is filled.
 * Format: YYYY/MM/DD
 */
export const DateInput: React.FC<DateInputProps> = ({
  value,
  onChange,
  className = '',
  required = false,
  id,
}) => {
  const yearRef = useRef<HTMLInputElement>(null);
  const monthRef = useRef<HTMLInputElement>(null);
  const dayRef = useRef<HTMLInputElement>(null);

  // Parse value into year, month, day
  const parseValue = (val: string): { year: string; month: string; day: string } => {
    if (!val) return { year: '', month: '', day: '' };
    const parts = val.split('/');
    return {
      year: parts[0] || '',
      month: parts[1] || '',
      day: parts[2] || '',
    };
  };

  const { year, month, day } = parseValue(value);

  // Format values into YYYY/MM/DD
  const formatValue = (y: string, m: string, d: string): string => {
    const parts = [y, m, d].filter(p => p.length > 0);
    return parts.length > 0 ? parts.join('/') : '';
  };

  const handleYearChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newYear = e.target.value.replace(/\D/g, '').slice(0, 4);
    const newValue = formatValue(newYear, month, day);
    onChange(newValue);

    // Auto-advance to month when year is complete
    if (newYear.length === 4 && monthRef.current) {
      monthRef.current.focus();
    }
  };

  const handleMonthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newMonth = e.target.value.replace(/\D/g, '').slice(0, 2);
    // Allow any input while typing, only validate when complete (2 digits)
    let validMonth = newMonth;
    if (newMonth.length === 2) {
      const monthNum = parseInt(newMonth, 10);
      // If invalid month (00, >12), keep previous value
      if (monthNum < 1 || monthNum > 12) {
        validMonth = month;
      }
    }
    const newValue = formatValue(year, validMonth, day);
    onChange(newValue);

    // Auto-advance to day when month is complete and valid
    if (validMonth.length === 2 && dayRef.current) {
      const monthNum = parseInt(validMonth, 10);
      if (monthNum >= 1 && monthNum <= 12) {
        dayRef.current.focus();
      }
    }
  };

  const handleDayChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDay = e.target.value.replace(/\D/g, '').slice(0, 2);
    // Allow any input while typing, only validate when complete (2 digits)
    let validDay = newDay;
    if (newDay.length === 2) {
      const dayNum = parseInt(newDay, 10);
      // If invalid day (00, >31), keep previous value
      if (dayNum < 1 || dayNum > 31) {
        validDay = day;
      }
    }
    const newValue = formatValue(year, month, validDay);
    onChange(newValue);
  };

  // Handle backspace to go back to previous field
  const handleYearKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && year.length === 0 && monthRef.current) {
      monthRef.current.focus();
    }
  };

  const handleMonthKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && month.length === 0 && yearRef.current) {
      yearRef.current.focus();
    }
  };

  const handleDayKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && day.length === 0 && monthRef.current) {
      monthRef.current.focus();
    }
  };

  // Validate date when all fields are filled and clear invalid dates
  // Note: onChange is expected to be a stable reference (e.g., useState setter or useCallback)
  useEffect(() => {
    if (year.length === 4 && month.length === 2 && day.length === 2) {
      const yearNum = parseInt(year, 10);
      const monthNum = parseInt(month, 10);
      const dayNum = parseInt(day, 10);
      const date = new Date(yearNum, monthNum - 1, dayNum);
      
      // Check if date is valid
      if (
        date.getFullYear() !== yearNum ||
        date.getMonth() !== monthNum - 1 ||
        date.getDate() !== dayNum
      ) {
        // Invalid date (e.g., 2024/02/30) - clear the day field
        onChange(formatValue(year, month, ''));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, day]); // onChange is intentionally omitted - it should be stable

  const baseInputClass = 'px-2 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-center';

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <input
        ref={yearRef}
        type="text"
        id={id ? `${id}-year` : undefined}
        value={year}
        onChange={handleYearChange}
        onKeyDown={handleYearKeyDown}
        placeholder="YYYY"
        maxLength={4}
        className={baseInputClass}
        style={{ width: '4.5rem' }}
        required={required && !value}
        pattern="\d{4}"
      />
      <span className="text-gray-500 text-lg">/</span>
      <input
        ref={monthRef}
        type="text"
        id={id ? `${id}-month` : undefined}
        value={month}
        onChange={handleMonthChange}
        onKeyDown={handleMonthKeyDown}
        placeholder="MM"
        maxLength={2}
        className={baseInputClass}
        style={{ width: '3rem' }}
        required={required && year.length === 4 && !month}
        pattern="\d{2}"
      />
      <span className="text-gray-500 text-lg">/</span>
      <input
        ref={dayRef}
        type="text"
        id={id ? `${id}-day` : undefined}
        value={day}
        onChange={handleDayChange}
        onKeyDown={handleDayKeyDown}
        placeholder="DD"
        maxLength={2}
        className={baseInputClass}
        style={{ width: '3rem' }}
        required={required && year.length === 4 && month.length === 2 && !day}
        pattern="\d{2}"
      />
    </div>
  );
};


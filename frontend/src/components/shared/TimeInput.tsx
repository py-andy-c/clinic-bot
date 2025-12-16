import React, { useState, useEffect, useRef } from 'react';
import { parseTime12hTo24h, formatTo12Hour } from '../../utils/calendarUtils';

interface TimeInputProps {
  value: string; // HH:MM format (24-hour)
  onChange: (value: string) => void; // HH:MM format (24-hour)
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  error?: string | null;
}

/**
 * TimeInput Component
 *
 * A time input component that accepts 12-hour format (H:MM AM/PM) and converts to 24-hour format (HH:MM).
 * Features:
 * - Auto-advances between hour/minute/period fields
 * - Validates time format
 * - Shows error state
 * - Keyboard navigation support
 */
export const TimeInput: React.FC<TimeInputProps> = ({
  value,
  onChange,
    placeholder = 'H:MM AM/PM 或 HH:MM',
  required = false,
  disabled = false,
  className = '',
  error = null,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isValid, setIsValid] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // Parse 24-hour time to 12-hour display
  useEffect(() => {
    if (value) {
      try {
        const formatted = formatTo12Hour(value);
        setInputValue(formatted.display);
        setIsValid(true);
      } catch (error) {
        // If parsing fails, keep the current input value
        setIsValid(false);
      }
    } else {
      setInputValue('');
      setIsValid(true);
    }
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);

    // Try to parse as 12-hour format first
    try {
      const parsed24Hour = parseTime12hTo24h(newValue);
      onChange(parsed24Hour);
      setIsValid(true);
      return;
    } catch (error) {
      // Not 12-hour format, try 24-hour format
    }

    // Try to parse as 24-hour format (HH:MM)
    const time24Regex = /^(\d{1,2}):(\d{2})$/;
    const match = newValue.trim().match(time24Regex);
    if (match && match[1] && match[2]) {
      const hour = parseInt(match[1], 10);
      const minute = parseInt(match[2], 10);
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        const formatted24Hour = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        onChange(formatted24Hour);
        setIsValid(true);
        return;
      }
    }

    // Invalid format
    setIsValid(false);
  };

  const handleBlur = () => {
    // On blur, if the input is invalid and not empty, try to format it properly
    if (!isValid && inputValue.trim()) {
      // Try 12-hour format first
      try {
        const parsed24Hour = parseTime12hTo24h(inputValue);
        const formatted = formatTo12Hour(parsed24Hour);
        setInputValue(formatted.display);
        setIsValid(true);
        return;
      } catch (error) {
        // Try 24-hour format
        const time24Regex = /^(\d{1,2}):(\d{2})$/;
        const match = inputValue.trim().match(time24Regex);
        if (match && match[1] && match[2]) {
          const hour = parseInt(match[1], 10);
          const minute = parseInt(match[2], 10);
          if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
            const formatted24Hour = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
            const formatted = formatTo12Hour(formatted24Hour);
            setInputValue(formatted.display);
            setIsValid(true);
            return;
          }
        }
        // Keep the invalid input but mark as error
        setIsValid(false);
      }
    }
  };

  const baseInputClass = 'px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-center text-sm font-medium';
  const errorClass = error || !isValid ? 'border-red-300 bg-red-50' : 'border-gray-300 bg-white';

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className={`${baseInputClass} ${errorClass} ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'hover:border-gray-400'}`}
        maxLength={8} // Max length for "12:59 PM"
      />
      {(error || !isValid) && (
        <p className="mt-1 text-sm text-red-600">
          {error || '請輸入有效的時間格式 (H:MM AM/PM 或 HH:MM)'}
        </p>
      )}
    </div>
  );
};

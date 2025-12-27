import React, { useState, useEffect, useRef } from 'react';

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
 * A time input component that accepts only 24-hour format (HH:MM).
 * Features:
 * - Validates 24-hour time format
 * - Shows error state
 * - Keyboard navigation support
 */
export const TimeInput: React.FC<TimeInputProps> = ({
  value,
  onChange,
  placeholder = 'HH:MM',
  required = false,
  disabled = false,
  className = '',
  error = null,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isValid, setIsValid] = useState(true);
  const [isTouched, setIsTouched] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Display 24-hour format directly
  useEffect(() => {
    if (value) {
      // Validate and format the value
      const time24Regex = /^(\d{1,2}):(\d{2})$/;
      const match = value.trim().match(time24Regex);
      if (match && match[1] && match[2]) {
        const hour = parseInt(match[1], 10);
        const minute = parseInt(match[2], 10);
        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
          const formatted = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
          setInputValue(formatted);
          setIsValid(true);
        } else {
          setInputValue(value);
          setIsValid(false);
        }
      } else {
        setInputValue(value);
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

    // Parse as 24-hour format (HH:MM)
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
    setIsTouched(true);
    setIsFocused(false);
    // On blur, if the input is invalid and not empty, try to format it properly
    if (!isValid && inputValue.trim()) {
      // Try 24-hour format
      const time24Regex = /^(\d{1,2}):(\d{2})$/;
      const match = inputValue.trim().match(time24Regex);
      if (match && match[1] && match[2]) {
        const hour = parseInt(match[1], 10);
        const minute = parseInt(match[2], 10);
        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
          const formatted24Hour = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
          setInputValue(formatted24Hour);
          onChange(formatted24Hour);
          setIsValid(true);
          return;
        }
      }
      // Keep the invalid input but mark as error
      setIsValid(false);
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  const baseInputClass = 'px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-center text-sm font-medium';
  // Show error only if it's external or if the internal validation failed AND we are not currently typing (blurred)
  const hasError = error || (!isValid && isTouched && !isFocused);
  const errorClass = hasError ? 'border-red-300 bg-red-50' : 'border-gray-300 bg-white';

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onBlur={handleBlur}
        onFocus={handleFocus}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className={`${baseInputClass} ${errorClass} ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'hover:border-gray-400'}`}
        maxLength={5} // Max length for "23:59"
      />
      {hasError && (
        <p className="mt-1 text-sm text-red-600">
          {error || '請輸入有效的時間格式 (HH:MM)'}
        </p>
      )}
    </div>
  );
};

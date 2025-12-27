import React, { useState, useEffect, useRef } from 'react';

interface TimeInputProps {
  value: string; // HH:MM format (24-hour)
  onChange: (value: string) => void; // HH:MM format (24-hour)
  required?: boolean;
  disabled?: boolean;
  className?: string;
  error?: string | null;
  id?: string;
  'aria-label'?: string;
}

/**
 * TimeInput Component
 *
 * A time input component that accepts only 24-hour format (HH:MM).
 * Features:
 * - Separate hour and minute fields for better UX
 * - Auto-advances between fields when complete
 * - Arrow keys to increment/decrement values
 * - Validates 24-hour time format
 * - Shows error state with helpful messages
 * - Full keyboard navigation support
 * - Accessibility attributes
 */
export const TimeInput: React.FC<TimeInputProps> = ({
  value,
  onChange,
  required = false,
  disabled = false,
  className = '',
  error = null,
  id,
  'aria-label': ariaLabel,
}) => {
  const hourRef = useRef<HTMLInputElement>(null);
  const minuteRef = useRef<HTMLInputElement>(null);
  const [isTouched, setIsTouched] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [focusedField, setFocusedField] = useState<'hour' | 'minute' | null>(null);

  // Parse value into hour and minute
  const parseValue = (val: string): { hour: string; minute: string } => {
    if (!val) return { hour: '', minute: '' };
    const parts = val.split(':');
    return {
      hour: parts[0] || '',
      minute: parts[1] || '',
    };
  };

  // Use local state for input values to allow empty fields during editing
  const [localHour, setLocalHour] = useState('');
  const [localMinute, setLocalMinute] = useState('');

  // Sync local state with prop value when it changes externally
  // Initialize on mount, and update when value changes (but not while user is typing)
  useEffect(() => {
    const { hour: h, minute: m } = parseValue(value);
    // Only update if we're not currently focused (to avoid interrupting user input)
    if (!isFocused) {
      setLocalHour(h);
      setLocalMinute(m);
    }
  }, [value, isFocused]);

  const hour = localHour;
  const minute = localMinute;

  // Format values into HH:MM
  const formatValue = (h: string, m: string): string => {
    if (!h && !m) return '';
    // Only format if both values exist, or if we have at least one valid value
    const hourStr = h ? String(parseInt(h, 10)).padStart(2, '0') : '';
    const minuteStr = m ? String(parseInt(m, 10)).padStart(2, '0') : '';
    if (!hourStr && !minuteStr) return '';
    // If one is missing, use "00" as default
    return `${hourStr || '00'}:${minuteStr || '00'}`;
  };

  // Validate hour (0-23)
  const isValidHour = (h: string): boolean => {
    if (!h) return true; // Empty is valid while typing
    const hourNum = parseInt(h, 10);
    return !isNaN(hourNum) && hourNum >= 0 && hourNum <= 23;
  };

  // Validate minute (0-59)
  const isValidMinute = (m: string): boolean => {
    if (!m) return true; // Empty is valid while typing
    const minuteNum = parseInt(m, 10);
    return !isNaN(minuteNum) && minuteNum >= 0 && minuteNum <= 59;
  };

  // Check if time is valid
  const isValid = (h: string, m: string): boolean => {
    if (!h || !m) return true; // Allow partial input
    return isValidHour(h) && isValidMinute(m);
  };

  const handleHourChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newHour = e.target.value.replace(/\D/g, '').slice(0, 2);
    setLocalHour(newHour);
    
    // Only call onChange if hour is not empty (to allow deletion without reformatting)
    // If hour is empty, we'll format it on blur
    if (newHour) {
      const newValue = formatValue(newHour, minute);
      if (newValue) {
        onChange(newValue);
      }
    } else if (!minute) {
      // If both hour and minute are empty, clear the value
      onChange('');
    }
    // If hour is empty but minute exists, don't call onChange yet
    // This allows the user to delete "00" and enter a new value

    // Auto-advance to minute when hour is complete and valid
    if (newHour.length === 2 && minuteRef.current) {
      const hourNum = parseInt(newHour, 10);
      if (hourNum >= 0 && hourNum <= 23) {
        minuteRef.current.focus();
        setFocusedField('minute');
      }
    }
  };

  const handleMinuteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newMinute = e.target.value.replace(/\D/g, '').slice(0, 2);
    setLocalMinute(newMinute);
    
    // Format with current hour (or "00" if empty)
    const newValue = formatValue(hour || '00', newMinute);
    if (newValue) {
      onChange(newValue);
    }
  };

  // Handle arrow keys for increment/decrement
  const handleHourKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const currentHour = hour ? parseInt(hour, 10) : 0;
      const newHour = currentHour >= 23 ? 0 : currentHour + 1;
      const newHourStr = String(newHour);
      setLocalHour(newHourStr);
      const newValue = formatValue(newHourStr, minute);
      if (newValue) {
        onChange(newValue);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const currentHour = hour ? parseInt(hour, 10) : 0;
      const newHour = currentHour <= 0 ? 23 : currentHour - 1;
      const newHourStr = String(newHour);
      setLocalHour(newHourStr);
      const newValue = formatValue(newHourStr, minute);
      if (newValue) {
        onChange(newValue);
      }
    } else if (e.key === 'Backspace' && hour.length === 0 && minuteRef.current) {
      minuteRef.current.focus();
      setFocusedField('minute');
    } else if (e.key === 'ArrowRight' && minuteRef.current) {
      // Only move to minute field if cursor is at the end of hour field
      const input = e.currentTarget;
      const cursorPosition = input.selectionStart || 0;
      const textLength = input.value.length;
      
      // If cursor is at the end (or beyond), move to minute field
      if (cursorPosition >= textLength) {
        e.preventDefault();
        minuteRef.current.focus();
        setFocusedField('minute');
      }
      // Otherwise, let the default behavior move the cursor within the hour field
    }
  };

  const handleMinuteKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const currentMinute = minute ? parseInt(minute, 10) : 0;
      // Round up to next 5-minute interval
      // Examples: 12 -> 15, 13 -> 15, 15 -> 20, 55 -> 0 (wraps)
      const nextInterval = Math.ceil((currentMinute + 1) / 5) * 5;
      const newMinute = nextInterval >= 60 ? 0 : nextInterval;
      const newMinuteStr = String(newMinute).padStart(2, '0');
      setLocalMinute(newMinuteStr);
      const newValue = formatValue(hour || '00', newMinuteStr);
      if (newValue) {
        onChange(newValue);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const currentMinute = minute ? parseInt(minute, 10) : 0;
      // Round down to previous 5-minute interval
      // Examples: 12 -> 10, 13 -> 10, 15 -> 10, 0 -> 55 (wraps)
      let prevInterval = Math.floor(currentMinute / 5) * 5;
      // If we're already on a 5-minute interval, go to the previous one
      if (prevInterval === currentMinute) {
        prevInterval = prevInterval - 5;
      }
      // Handle wrapping: if negative, wrap to 55
      const newMinute = prevInterval < 0 ? 55 : prevInterval;
      const newMinuteStr = String(newMinute).padStart(2, '0');
      setLocalMinute(newMinuteStr);
      const newValue = formatValue(hour || '00', newMinuteStr);
      if (newValue) {
        onChange(newValue);
      }
    } else if (e.key === 'Backspace' && minute.length === 0 && hourRef.current) {
      hourRef.current.focus();
      setFocusedField('hour');
    } else if (e.key === 'ArrowLeft' && hourRef.current) {
      // Only move to hour field if cursor is at the start of minute field
      const input = e.currentTarget;
      const cursorPosition = input.selectionStart || 0;
      
      // If cursor is at the start (position 0), move to hour field
      if (cursorPosition === 0) {
        e.preventDefault();
        hourRef.current.focus();
        setFocusedField('hour');
      }
      // Otherwise, let the default behavior move the cursor within the minute field
    }
  };

  const handleHourFocus = () => {
    setIsFocused(true);
    setFocusedField('hour');
  };

  const handleMinuteFocus = () => {
    setIsFocused(true);
    setFocusedField('minute');
  };

  const handleBlur = () => {
    setIsTouched(true);
    setIsFocused(false);
    setFocusedField(null);
  };

  // Validate and format on blur if incomplete
  useEffect(() => {
    if (!isFocused && isTouched) {
      let formattedHour = hour;
      let formattedMinute = minute;

      // Format hour if present, otherwise use "00" if minute exists
      if (hour) {
        const hourNum = parseInt(hour, 10);
        if (!isNaN(hourNum) && hourNum >= 0 && hourNum <= 23) {
          formattedHour = String(hourNum).padStart(2, '0');
        }
      } else if (minute) {
        // If hour is empty but minute exists, default to "00"
        formattedHour = '00';
      }

      // Format minute if present
      if (minute) {
        const minuteNum = parseInt(minute, 10);
        if (!isNaN(minuteNum) && minuteNum >= 0 && minuteNum <= 59) {
          formattedMinute = String(minuteNum).padStart(2, '0');
        }
      } else if (hour) {
        // If minute is empty but hour exists, default to "00"
        formattedMinute = '00';
      }

      // Update if formatting changed
      if (formattedHour && formattedMinute) {
        const newValue = formatValue(formattedHour, formattedMinute);
        if (newValue && newValue !== value) {
          onChange(newValue);
        }
      }
    }
  }, [isFocused, isTouched, hour, minute, value, onChange]);

  const baseInputClass = 'px-2 py-2 border-0 focus:outline-none text-center text-sm font-medium bg-transparent';
  const hasError = Boolean(error || (!isValid(hour, minute) && isTouched && !isFocused));
  const containerErrorClass = hasError ? 'border-red-300 bg-red-50' : 'border-gray-300 bg-white';

  // Generate error message
  const getErrorMessage = (): string => {
    if (error) return error;
    if (!isTouched || isFocused) return '';
    
    if (hour && !isValidHour(hour)) {
      return '請輸入有效的小時 (0-23)，例如: 09, 14, 23';
    }
    if (minute && !isValidMinute(minute)) {
      return '請輸入有效的分鐘 (0-59)，例如: 00, 30, 59';
    }
    if ((hour || minute) && !isValid(hour, minute)) {
      return '請輸入有效的時間格式 (HH:MM)，例如: 09:30, 14:00';
    }
    return '';
  };

  const errorMessage = getErrorMessage();

  return (
    <div className={className}>
      <div 
        className={`flex items-center border rounded-md focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-transparent ${containerErrorClass} ${disabled ? 'bg-gray-100 cursor-not-allowed' : ''} ${focusedField ? 'ring-2 ring-primary-300' : ''} ${!/\bw-/.test(className || '') ? 'w-auto inline-flex' : ''}`}
      >
        <input
          ref={hourRef}
          type="text"
          id={id ? `${id}-hour` : undefined}
          value={hour}
          onChange={handleHourChange}
          onKeyDown={handleHourKeyDown}
          onFocus={handleHourFocus}
          onBlur={handleBlur}
          placeholder="HH"
          maxLength={2}
          required={required && !value}
          disabled={disabled}
          className={`${baseInputClass} ${disabled ? 'cursor-not-allowed' : ''}`}
          style={{ width: '2.5rem' }}
          pattern="\d{1,2}"
          inputMode="numeric"
          aria-label={ariaLabel ? `${ariaLabel} - 小時` : '小時 (0-23)'}
          aria-invalid={hasError}
          aria-describedby={errorMessage && id ? `${id}-error` : undefined}
        />
        <span className="text-gray-500 text-lg font-medium">:</span>
        <input
          ref={minuteRef}
          type="text"
          id={id ? `${id}-minute` : undefined}
          value={minute}
          onChange={handleMinuteChange}
          onKeyDown={handleMinuteKeyDown}
          onFocus={handleMinuteFocus}
          onBlur={handleBlur}
          placeholder="MM"
          maxLength={2}
          required={required && hour.length === 2 && !minute}
          disabled={disabled}
          className={`${baseInputClass} ${disabled ? 'cursor-not-allowed' : ''}`}
          style={{ width: '2.5rem' }}
          pattern="\d{1,2}"
          inputMode="numeric"
          aria-label={ariaLabel ? `${ariaLabel} - 分鐘` : '分鐘 (0-59)'}
          aria-invalid={hasError}
          aria-describedby={errorMessage ? (id ? `${id}-error` : undefined) : undefined}
        />
      </div>
      {errorMessage && (
        <p id={id ? `${id}-error` : undefined} className="mt-1 text-sm text-red-600" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
};

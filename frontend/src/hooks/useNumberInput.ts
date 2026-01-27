import { useState, useEffect } from 'react';

/**
 * Hook for number inputs that allow users to clear the field while typing,
 * then fall back to a default value when the field loses focus.
 * 
 * @param currentValue - The current numeric value
 * @param onChange - Callback to update the value (receives a number)
 * @param options - Configuration options
 * @returns Object with onChange and onBlur handlers, and displayValue for the input
 * 
 * @example
 * ```tsx
 * const { onChange, onBlur, displayValue } = useNumberInput(
 *   amount,
 *   (value) => setAmount(value),
 *   { fallback: 0, parseFn: 'parseFloat', round: true }
 * );
 * 
 * <input
 *   type="number"
 *   value={displayValue}
 *   onChange={onChange}
 *   onBlur={onBlur}
 *   ...
 * />
 * ```
 */
export const useNumberInput = (
  currentValue: number,
  onChange: (value: number) => void,
  options: {
    fallback: number;
    parseFn?: 'parseInt' | 'parseFloat';
    min?: number;
    max?: number;
    round?: boolean;
  }
): {
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur: (e: React.FocusEvent<HTMLInputElement>) => void;
  displayValue: string | number;
} => {
  const { fallback, parseFn = 'parseFloat', min, max, round = false } = options;
  const parse = (val: string) => parseFn === 'parseInt' ? parseInt(val, 10) : parseFloat(val);

  // Store display value as string to allow empty input while typing
  const [displayValue, setDisplayValue] = useState<string | number>(currentValue);

  // Update display value when currentValue changes externally
  useEffect(() => {
    setDisplayValue(currentValue);
  }, [currentValue]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;

    // Allow empty string while typing
    if (inputValue === '') {
      setDisplayValue('');
      return;
    }

    // Parse the value
    const parsed = parse(inputValue);

    // If valid number, update immediately
    if (!isNaN(parsed)) {
      let value = parsed;

      // Apply constraints
      if (min !== undefined && value < min) {
        value = min;
      }
      if (max !== undefined && value > max) {
        value = max;
      }

      // Apply rounding if requested
      if (round) {
        value = Math.round(value);
      }

      setDisplayValue(inputValue);
      onChange(value);
    } else {
      // Invalid input - allow it to be displayed but don't update parent state
      // This prevents React controlled/uncontrolled warnings
      // The value will be corrected on blur
      setDisplayValue(inputValue);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;

    // If empty or invalid, use fallback
    if (inputValue === '' || isNaN(parse(inputValue))) {
      setDisplayValue(fallback.toString());
      onChange(fallback);
    } else {
      // Validate and constrain on blur
      let value = parse(inputValue);

      if (min !== undefined && value < min) {
        value = min;
      }
      if (max !== undefined && value > max) {
        value = max;
      }

      if (round) {
        value = Math.round(value);
      }

      setDisplayValue(value.toString());
      onChange(value);
    }
  };

  return {
    onChange: handleChange,
    onBlur: handleBlur,
    displayValue,
  };
};

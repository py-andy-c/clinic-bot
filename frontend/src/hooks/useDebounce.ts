import { useState, useEffect } from 'react';

/**
 * Custom hook for debouncing a value.
 * 
 * Delays updating the value until the user stops typing/changing it.
 * 
 * @param value - Value to debounce
 * @param delay - Debounce delay in milliseconds (default: 400ms)
 * @returns Debounced value
 */
export function useDebounce<T>(value: T, delay: number = 400): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}



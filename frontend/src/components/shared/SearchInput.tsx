import { forwardRef, memo, useState, useRef, useEffect, useLayoutEffect } from 'react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
}

const SearchInputComponent = forwardRef<HTMLInputElement, SearchInputProps>(({
  value,
  onChange,
  placeholder = "搜尋...",
  className = "",
  onFocus,
  onBlur,
  onCompositionStart,
  onCompositionEnd
}, ref) => {
  const [isComposing, setIsComposing] = useState(false);
  const [localValue, setLocalValue] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wasFocusedRef = useRef(false);
  const cursorPositionRef = useRef<number | null>(null);

  // Check if there's a value to show the clear button
  // Use the displayed value (localValue during composition, value otherwise)
  const displayedValue = isComposing ? localValue : value;
  const hasValue = displayedValue.trim().length > 0;

  // Sync local value with prop value when not composing
  useEffect(() => {
    if (!isComposing) {
      setLocalValue(value);
    }
  }, [value, isComposing]);

  // Combine refs: both the forwarded ref and our internal ref
  const setRef = (node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref) {
      ref.current = node;
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    const input = e.target;
    
    // Save cursor position before state updates
    cursorPositionRef.current = input.selectionStart;
    
    // Always update local value so the input displays correctly
    setLocalValue(newValue);
    
    // During IME composition, don't update parent state to prevent re-renders
    // that could interrupt the composition process
    // For non-IME input (English, numbers), composition events won't fire,
    // so isComposing will be false and onChange will fire normally
    if (!isComposing) {
      // Normal input (non-IME) - update parent state immediately
      onChange(newValue);
    }
    // During composition, we'll update parent state when composition ends
  };

  const handleCompositionStart = () => {
    setIsComposing(true);
    onCompositionStart?.();
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    const finalValue = e.currentTarget.value;
    setIsComposing(false);
    // Update both local and parent state after composition ends
    setLocalValue(finalValue);
    onChange(finalValue);
    onCompositionEnd?.();
  };

  // Preserve focus and cursor position after re-renders
  // Use both useLayoutEffect (immediate) and useEffect (after paint) for maximum compatibility
  useLayoutEffect(() => {
    if (wasFocusedRef.current && inputRef.current) {
      const currentInput = inputRef.current;
      // Immediately check and restore focus synchronously
      if (document.activeElement !== currentInput) {
        currentInput.focus();
        // Restore cursor position if we have it saved
        if (cursorPositionRef.current !== null && cursorPositionRef.current <= currentInput.value.length) {
          currentInput.setSelectionRange(cursorPositionRef.current, cursorPositionRef.current);
        } else {
          // Otherwise, move cursor to end
          const length = currentInput.value.length;
          currentInput.setSelectionRange(length, length);
        }
      }
    }
  });

  // Also use useEffect as a fallback for cases where useLayoutEffect isn't enough
  useEffect(() => {
    if (wasFocusedRef.current && inputRef.current) {
      // Use a small timeout to ensure we're after all React updates
      const timeoutId = setTimeout(() => {
        if (wasFocusedRef.current && inputRef.current && document.activeElement !== inputRef.current) {
          const input = inputRef.current;
          input.focus();
          // Restore cursor position
          if (cursorPositionRef.current !== null && cursorPositionRef.current <= input.value.length) {
            input.setSelectionRange(cursorPositionRef.current, cursorPositionRef.current);
          } else {
            const length = input.value.length;
            input.setSelectionRange(length, length);
          }
        }
      }, 0);
      return () => clearTimeout(timeoutId);
    }
    return undefined;
  });

  // Fallback: if composition state gets stuck, reset it after a delay
  // This handles edge cases where compositionEnd might not fire
  useEffect(() => {
    if (isComposing) {
      const timeout = setTimeout(() => {
        // If still composing after 5 seconds, something went wrong - reset
        setIsComposing(false);
      }, 5000);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [isComposing]);

  return (
    <div className={`relative ${className}`}>
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none z-10">
        <svg
          className="h-5 w-5 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>
      <input
        ref={setRef}
        type="text"
        placeholder={placeholder}
        value={isComposing ? localValue : value}
        onChange={handleChange}
        onFocus={(e) => {
          wasFocusedRef.current = true;
          cursorPositionRef.current = e.target.selectionStart;
          onFocus?.();
        }}
        onBlur={() => {
          wasFocusedRef.current = false;
          cursorPositionRef.current = null;
          onBlur?.();
        }}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        className="w-full border border-gray-300 rounded-md pl-10 pr-10 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {hasValue && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none focus:text-gray-600"
          aria-label="清除搜尋"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
});

SearchInputComponent.displayName = 'SearchInput';

// Memoize to prevent unnecessary re-renders that could cause focus loss
// Use default shallow comparison - this will re-render when value changes
// which is what we want for controlled inputs
export const SearchInput = memo(SearchInputComponent);


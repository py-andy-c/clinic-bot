/**
 * Unit tests for useNumberInput hook
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNumberInput } from '../useNumberInput';
import React from 'react';

describe('useNumberInput', () => {
  let mockOnChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnChange = vi.fn();
  });

  describe('basic functionality', () => {
    it('should initialize with current value', () => {
      const { result } = renderHook(() =>
        useNumberInput(5, mockOnChange, { fallback: 0 })
      );

      expect(result.current.displayValue).toBe(5);
    });

    it('should update display value when currentValue changes externally', () => {
      const { result, rerender } = renderHook(
        ({ value }) => useNumberInput(value, mockOnChange, { fallback: 0 }),
        { initialProps: { value: 5 } }
      );

      expect(result.current.displayValue).toBe(5);

      rerender({ value: 10 });

      expect(result.current.displayValue).toBe(10);
    });
  });

  describe('empty input handling', () => {
    it('should allow empty string while typing', () => {
      const { result } = renderHook(() =>
        useNumberInput(5, mockOnChange, { fallback: 0 })
      );

      act(() => {
        result.current.onChange({
          target: { value: '' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      expect(result.current.displayValue).toBe('');
      expect(mockOnChange).not.toHaveBeenCalled();
    });

    it('should fall back to default value on blur when empty', () => {
      const { result } = renderHook(() =>
        useNumberInput(5, mockOnChange, { fallback: 0 })
      );

      // Clear the field
      act(() => {
        result.current.onChange({
          target: { value: '' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      // Blur the field
      act(() => {
        result.current.onBlur({
          target: { value: '' },
        } as React.FocusEvent<HTMLInputElement>);
      });

      expect(result.current.displayValue).toBe(0);
      expect(mockOnChange).toHaveBeenCalledWith(0);
    });
  });

  describe('parseInt vs parseFloat', () => {
    it('should use parseInt when specified', () => {
      const { result } = renderHook(() =>
        useNumberInput(0, mockOnChange, { fallback: 0, parseFn: 'parseInt' })
      );

      act(() => {
        result.current.onChange({
          target: { value: '5.7' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      expect(mockOnChange).toHaveBeenCalledWith(5);
      expect(result.current.displayValue).toBe(5);
    });

    it('should use parseFloat when specified', () => {
      const { result } = renderHook(() =>
        useNumberInput(0, mockOnChange, { fallback: 0, parseFn: 'parseFloat' })
      );

      act(() => {
        result.current.onChange({
          target: { value: '5.7' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      expect(mockOnChange).toHaveBeenCalledWith(5.7);
      expect(result.current.displayValue).toBe(5.7);
    });

    it('should default to parseFloat', () => {
      const { result } = renderHook(() =>
        useNumberInput(0, mockOnChange, { fallback: 0 })
      );

      act(() => {
        result.current.onChange({
          target: { value: '5.7' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      expect(mockOnChange).toHaveBeenCalledWith(5.7);
    });
  });

  describe('min/max constraints', () => {
    it('should enforce min constraint', () => {
      const { result } = renderHook(() =>
        useNumberInput(5, mockOnChange, { fallback: 0, min: 10 })
      );

      act(() => {
        result.current.onChange({
          target: { value: '5' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      expect(mockOnChange).toHaveBeenCalledWith(10);
      expect(result.current.displayValue).toBe(10);
    });

    it('should enforce max constraint', () => {
      const { result } = renderHook(() =>
        useNumberInput(5, mockOnChange, { fallback: 0, max: 10 })
      );

      act(() => {
        result.current.onChange({
          target: { value: '15' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      expect(mockOnChange).toHaveBeenCalledWith(10);
      expect(result.current.displayValue).toBe(10);
    });

    it('should enforce both min and max constraints', () => {
      const { result } = renderHook(() =>
        useNumberInput(5, mockOnChange, { fallback: 0, min: 5, max: 10 })
      );

      act(() => {
        result.current.onChange({
          target: { value: '15' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      expect(mockOnChange).toHaveBeenCalledWith(10);

      act(() => {
        result.current.onChange({
          target: { value: '2' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      expect(mockOnChange).toHaveBeenCalledWith(5);
    });

    it('should enforce constraints on blur', () => {
      const { result } = renderHook(() =>
        useNumberInput(5, mockOnChange, { fallback: 0, min: 10, max: 20 })
      );

      act(() => {
        result.current.onBlur({
          target: { value: '5' },
        } as React.FocusEvent<HTMLInputElement>);
      });

      expect(mockOnChange).toHaveBeenCalledWith(10);
      expect(result.current.displayValue).toBe(10);
    });
  });

  describe('rounding', () => {
    it('should round values when round option is true', () => {
      const { result } = renderHook(() =>
        useNumberInput(0, mockOnChange, { fallback: 0, round: true })
      );

      act(() => {
        result.current.onChange({
          target: { value: '5.7' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      expect(mockOnChange).toHaveBeenCalledWith(6);
      expect(result.current.displayValue).toBe(6);
    });

    it('should not round when round option is false', () => {
      const { result } = renderHook(() =>
        useNumberInput(0, mockOnChange, { fallback: 0, round: false })
      );

      act(() => {
        result.current.onChange({
          target: { value: '5.7' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      expect(mockOnChange).toHaveBeenCalledWith(5.7);
      expect(result.current.displayValue).toBe(5.7);
    });

    it('should default to not rounding', () => {
      const { result } = renderHook(() =>
        useNumberInput(0, mockOnChange, { fallback: 0 })
      );

      act(() => {
        result.current.onChange({
          target: { value: '5.7' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      expect(mockOnChange).toHaveBeenCalledWith(5.7);
    });
  });

  describe('invalid input handling', () => {
    it('should allow invalid input to display but not update parent state', () => {
      const { result } = renderHook(() =>
        useNumberInput(5, mockOnChange, { fallback: 0 })
      );

      // Simulate typing invalid characters (though number inputs typically prevent this)
      act(() => {
        result.current.onChange({
          target: { value: 'abc' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      // Display value should show what was typed
      expect(result.current.displayValue).toBe('abc');
      // But onChange should not be called
      expect(mockOnChange).not.toHaveBeenCalled();
    });

    it('should correct invalid input on blur', () => {
      const { result } = renderHook(() =>
        useNumberInput(5, mockOnChange, { fallback: 0 })
      );

      act(() => {
        result.current.onChange({
          target: { value: 'abc' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      act(() => {
        result.current.onBlur({
          target: { value: 'abc' },
        } as React.FocusEvent<HTMLInputElement>);
      });

      expect(result.current.displayValue).toBe(0);
      expect(mockOnChange).toHaveBeenCalledWith(0);
    });
  });

  describe('edge cases', () => {
    it('should handle negative numbers', () => {
      const { result } = renderHook(() =>
        useNumberInput(0, mockOnChange, { fallback: 0 })
      );

      act(() => {
        result.current.onChange({
          target: { value: '-5' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      expect(mockOnChange).toHaveBeenCalledWith(-5);
      expect(result.current.displayValue).toBe(-5);
    });

    it('should handle zero', () => {
      const { result } = renderHook(() =>
        useNumberInput(5, mockOnChange, { fallback: 0 })
      );

      act(() => {
        result.current.onChange({
          target: { value: '0' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      expect(mockOnChange).toHaveBeenCalledWith(0);
      expect(result.current.displayValue).toBe(0);
    });

    it('should handle very large numbers', () => {
      const { result } = renderHook(() =>
        useNumberInput(0, mockOnChange, { fallback: 0 })
      );

      act(() => {
        result.current.onChange({
          target: { value: '999999999' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      expect(mockOnChange).toHaveBeenCalledWith(999999999);
    });

    it('should handle decimal numbers with parseFloat', () => {
      const { result } = renderHook(() =>
        useNumberInput(0, mockOnChange, { fallback: 0, parseFn: 'parseFloat' })
      );

      act(() => {
        result.current.onChange({
          target: { value: '3.14159' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      expect(mockOnChange).toHaveBeenCalledWith(3.14159);
    });

    it('should handle fallback values correctly', () => {
      const { result } = renderHook(() =>
        useNumberInput(5, mockOnChange, { fallback: 42 })
      );

      act(() => {
        result.current.onBlur({
          target: { value: '' },
        } as React.FocusEvent<HTMLInputElement>);
      });

      expect(result.current.displayValue).toBe(42);
      expect(mockOnChange).toHaveBeenCalledWith(42);
    });
  });
});


import React from 'react';
import { useNumberInput } from '../../hooks/useNumberInput';
import { preventScrollWheelChange } from '../../utils/inputUtils';

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  fallback: number;
  parseFn?: 'parseInt' | 'parseFloat';
  min?: number;
  max?: number;
  round?: boolean;
  id?: string;
  className?: string;
  placeholder?: string;
  step?: string | number;
  disabled?: boolean;
  'aria-label'?: string;
}

/**
 * Number input component that allows users to clear the field while typing,
 * then falls back to a default value when the field loses focus.
 * 
 * @example
 * ```tsx
 * // Basic usage with fallback
 * <NumberInput
 *   value={amount}
 *   onChange={setAmount}
 *   fallback={0}
 * />
 * 
 * // With constraints and rounding
 * <NumberInput
 *   value={quantity}
 *   onChange={setQuantity}
 *   fallback={1}
 *   parseFn="parseInt"
 *   min={1}
 *   max={100}
 *   round={true}
 * />
 * 
 * // For currency amounts
 * <NumberInput
 *   value={price}
 *   onChange={setPrice}
 *   fallback={0}
 *   parseFn="parseFloat"
 *   min={0}
 *   round={true}
 *   placeholder="0"
 * />
 * ```
 */
export const NumberInput: React.FC<NumberInputProps> = ({
  value,
  onChange,
  fallback,
  parseFn = 'parseFloat',
  min,
  max,
  round = false,
  id,
  className = 'input',
  placeholder,
  step = '1',
  disabled = false,
  'aria-label': ariaLabel,
}) => {
  const { onChange: handleChange, onBlur, displayValue } = useNumberInput(
    value,
    onChange,
    {
      fallback,
      parseFn,
      min,
      max,
      round,
    }
  );

  return (
    <input
      id={id}
      type="number"
      value={displayValue}
      onChange={handleChange}
      onBlur={onBlur}
      onWheel={preventScrollWheelChange}
      className={className}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-label={ariaLabel}
    />
  );
};


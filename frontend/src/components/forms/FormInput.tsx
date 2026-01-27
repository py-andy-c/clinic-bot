import React from 'react';
import { useFormContext } from 'react-hook-form';
import { preventScrollWheelChange } from '../../utils/inputUtils';

interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  name: string;
}

export const FormInput: React.FC<FormInputProps> = ({
  name,
  className = '',
  onBlur,
  type,
  ...props
}) => {
  const { register } = useFormContext();
  const { onBlur: rhfOnBlur, ...registration } = register(name);

  return (
    <input
      {...registration}
      {...props}
      type={type}
      onBlur={(e) => {
        // Auto-correct number formatting on blur (e.g., 0345 -> 345)
        if (type === 'number' && e.target.value !== '') {
          const val = parseFloat(e.target.value);
          if (!isNaN(val)) {
            const normalized = val.toString();
            if (e.target.value !== normalized) {
              e.target.value = normalized;
            }
          }
        }
        rhfOnBlur(e);
        onBlur?.(e);
      }}
      onWheel={type === 'number' ? preventScrollWheelChange : undefined}
      className={`input ${className}`}
    />
  );
};


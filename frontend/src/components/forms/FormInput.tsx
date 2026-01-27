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
        rhfOnBlur(e);
        onBlur?.(e);
      }}
      onWheel={type === 'number' ? preventScrollWheelChange : undefined}
      className={`input ${className}`}
    />
  );
};


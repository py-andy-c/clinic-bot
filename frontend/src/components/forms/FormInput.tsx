import React from 'react';
import { useFormContext } from 'react-hook-form';

interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  name: string;
}

export const FormInput: React.FC<FormInputProps> = ({
  name,
  className = '',
  onBlur,
  ...props
}) => {
  const { register } = useFormContext();
  const { onBlur: rhfOnBlur, ...registration } = register(name);

  return (
    <input
      {...registration}
      {...props}
      onBlur={(e) => {
        rhfOnBlur(e);
        onBlur?.(e);
      }}
      className={`input ${className}`}
    />
  );
};


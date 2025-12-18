import React from 'react';
import { useFormContext } from 'react-hook-form';

interface FormTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  name: string;
}

export const FormTextarea: React.FC<FormTextareaProps> = ({
  name,
  className = '',
  onBlur,
  ...props
}) => {
  const { register } = useFormContext();
  const { onBlur: rhfOnBlur, ...registration } = register(name);

  return (
    <textarea
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


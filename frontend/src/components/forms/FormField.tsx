import React from 'react';
import { useFormContext, useFormState } from 'react-hook-form';

interface FormFieldProps {
  name: string;
  label?: string | React.ReactNode;
  children: React.ReactElement;
  description?: string;
  className?: string;
}

export const FormField: React.FC<FormFieldProps> = ({
  name,
  label,
  children,
  description,
  className = '',
}) => {
  const { control } = useFormContext();
  const { errors } = useFormState({ control, name });

  // Helper to get nested error
  const getNestedError = (obj: unknown, path: string): { message?: string } | undefined => {
    return path.split(/[.[\]]+/).filter(Boolean).reduce((acc, key) => acc?.[key], obj);
  };

  const error = getNestedError(errors, name);
  const errorMessage = error?.message as string | undefined;

  return (
    <div className={`space-y-1 ${className}`}>
      {label && (
        <label
          htmlFor={name}
          className="block text-sm font-medium text-gray-700"
        >
          {label}
        </label>
      )}
      
      {React.cloneElement(children, {
        id: name,
        'aria-invalid': error ? 'true' : 'false',
        'aria-describedby': errorMessage ? `${name}-error` : undefined,
      })}

      {description && !errorMessage && (
        <p className="text-xs text-gray-500">{description}</p>
      )}

      {errorMessage && (
        <p
          className="text-xs text-red-600"
          id={`${name}-error`}
          role="alert"
        >
          {errorMessage}
        </p>
      )}
    </div>
  );
};


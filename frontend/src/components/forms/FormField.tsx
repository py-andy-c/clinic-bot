import React from 'react';
import { useFormContext, useFormState } from 'react-hook-form';

interface FormFieldProps {
  name: string;
  label?: string | React.ReactNode;
  children: React.ReactElement;
  description?: string | undefined;
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

  // Get nested error if field name contains dots (e.g., "values.field_id")
  const getNestedError = (obj: any, path: string) => {
    return path.split('.').reduce((acc, part) => acc?.[part], obj);
  };

  const error = getNestedError(errors, name);
  const errorMessage = error?.message as string | undefined;

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <label htmlFor={name} className="block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}

      {description && (
        <p className="text-xs text-gray-500 -mt-1 mb-1.5">{description}</p>
      )}

      {React.cloneElement(children, {
        id: name,
        'aria-invalid': !!error,
        'aria-describedby': errorMessage ? `${name}-error` : undefined,
      })}

      {errorMessage && (
        <p
          className="text-xs text-red-600 font-medium"
          id={`${name}-error`}
          role="alert"
        >
          {errorMessage}
        </p>
      )}
    </div>
  );
};

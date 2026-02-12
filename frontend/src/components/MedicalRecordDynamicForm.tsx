import React from 'react';
import { useFormContext } from 'react-hook-form';
import { TemplateField } from '../types/medicalRecord';
import { FormField, FormInput, FormTextarea } from './forms';

interface MedicalRecordDynamicFormProps {
  fields: TemplateField[];
}

/**
 * Dynamic form component that generates form fields based on template structure
 * Supports validation for required fields
 */
export const MedicalRecordDynamicForm: React.FC<MedicalRecordDynamicFormProps> = ({ fields }) => {
  const { register } = useFormContext();

  const renderField = (field: TemplateField) => {
    const fieldName = `values.${field.id}`;
    const label = field.required ? (
      <>
        {field.label} <span className="text-red-500">*</span>
      </>
    ) : field.label;

    switch (field.type) {
      case 'text':
        return (
          <FormField key={field.id} name={fieldName} label={label} description={field.description}>
            <FormInput
              name={fieldName}
              placeholder=""
            />
          </FormField>
        );

      case 'textarea':
        return (
          <FormField key={field.id} name={fieldName} label={label} description={field.description}>
            <FormTextarea
              name={fieldName}
              placeholder=""
              rows={4}
            />
          </FormField>
        );

      case 'number':
        return (
          <FormField key={field.id} name={fieldName} label={label} description={field.description}>
            <FormInput
              name={fieldName}
              type="number"
              placeholder=""
            />
          </FormField>
        );

      case 'date':
        return (
          <FormField key={field.id} name={fieldName} label={label} description={field.description}>
            <FormInput
              name={fieldName}
              type="date"
              placeholder=""
            />
          </FormField>
        );

      case 'dropdown':
        return (
          <FormField key={field.id} name={fieldName} label={label} description={field.description}>
            <select
              {...register(fieldName)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">請選擇...</option>
              {field.options?.map((option, index) => (
                <option key={index} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </FormField>
        );

      case 'radio':
        return (
          <FormField key={field.id} name={fieldName} label={label} description={field.description}>
            <div className="space-y-2">
              {field.options?.map((option, index) => (
                <label key={index} className="flex items-center gap-2">
                  <input
                    type="radio"
                    {...register(fieldName)}
                    value={option}
                    className="rounded-full border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-700">{option}</span>
                </label>
              ))}
            </div>
          </FormField>
        );

      case 'checkbox':
        // Multiple checkboxes with same name and different values
        // automatically produce an array in react-hook-form
        return (
          <FormField key={field.id} name={fieldName} label={label} description={field.description}>
            <div className="space-y-2">
              {field.options?.map((option, index) => (
                <label key={index} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    {...register(fieldName)}
                    value={option}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-700">{option}</span>
                </label>
              ))}
            </div>
          </FormField>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {fields
        .sort((a, b) => a.order - b.order)
        .map((field) => renderField(field))}
    </div>
  );
};

import React, { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import type { MedicalRecordField } from '../../types';

interface MedicalRecordHeaderProps {
  headerStructure: MedicalRecordField[];
  headerValues: Record<string, string | string[] | number | boolean>;
  onUpdate: (values: Record<string, string | string[] | number | boolean>, isToggle?: boolean) => Promise<void>;
  onDirtyStateChange?: (isDirty: boolean) => void;
}

export const MedicalRecordHeader: React.FC<MedicalRecordHeaderProps> = ({
  headerStructure,
  headerValues,
  onUpdate,
  onDirtyStateChange,
}) => {
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
    watch,
  } = useForm({
    defaultValues: headerValues,
  });

  const lastReportedValuesRef = useRef<string>(JSON.stringify(headerValues));

  // Reset form when headerValues change (e.g., after save)
  useEffect(() => {
    reset(headerValues);
    lastReportedValuesRef.current = JSON.stringify(headerValues);
  }, [headerValues, reset]);

  // Notify parent of dirty state changes
  useEffect(() => {
    if (onDirtyStateChange) {
      onDirtyStateChange(isDirty);
    }
  }, [isDirty, onDirtyStateChange]);

  // Auto-save on blur or after inactivity
  const watchedValues = watch();
  useEffect(() => {
    if (!isDirty) return;

    const currentValuesJson = JSON.stringify(watchedValues);
    if (currentValuesJson === lastReportedValuesRef.current) return;

    lastReportedValuesRef.current = currentValuesJson;

    // Determine if the current change is a toggle field
    const isToggleField = headerStructure.some(f =>
      ['select', 'checkbox', 'radio'].includes(f.type) &&
      JSON.stringify(watchedValues[f.id]) !== JSON.stringify(headerValues[f.id])
    );

    // Call onUpdate immediately; parent handles debouncing
    onUpdate(watchedValues, isToggleField);
  }, [watchedValues, isDirty, onUpdate, headerStructure, headerValues]);

  const onSubmit = async (data: Record<string, string | string[] | number | boolean>) => {
    await onUpdate(data);
  };

  const renderField = (field: MedicalRecordField) => {
    const fieldId = field.id;
    const hasError = !!errors[fieldId];
    const errorMessage = errors[fieldId]?.message as string | undefined;

    const baseInputClasses = `w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${hasError ? 'border-red-500' : 'border-gray-300'
      }`;

    switch (field.type) {
      case 'text':
        return (
          <div key={fieldId} className="mb-4">
            <label htmlFor={fieldId} className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
              {field.unit && <span className="text-gray-500 ml-1">({field.unit})</span>}
            </label>
            <input
              id={fieldId}
              type="text"
              placeholder={field.placeholder}
              className={baseInputClasses}
              {...register(fieldId, {
                required: field.required ? `${field.label}為必填欄位` : false,
              })}
              onBlur={handleSubmit(onSubmit)}
            />
            {hasError && <p className="mt-1 text-sm text-red-600">{errorMessage}</p>}
          </div>
        );

      case 'textarea':
        return (
          <div key={fieldId} className="mb-4">
            <label htmlFor={fieldId} className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <textarea
              id={fieldId}
              placeholder={field.placeholder}
              rows={4}
              className={baseInputClasses}
              {...register(fieldId, {
                required: field.required ? `${field.label}為必填欄位` : false,
              })}
              onBlur={handleSubmit(onSubmit)}
            />
            {hasError && <p className="mt-1 text-sm text-red-600">{errorMessage}</p>}
          </div>
        );

      case 'number':
        return (
          <div key={fieldId} className="mb-4">
            <label htmlFor={fieldId} className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
              {field.unit && <span className="text-gray-500 ml-1">({field.unit})</span>}
            </label>
            <input
              id={fieldId}
              type="number"
              step="any"
              placeholder={field.placeholder}
              className={baseInputClasses}
              {...register(fieldId, {
                required: field.required ? `${field.label}為必填欄位` : false,
                valueAsNumber: true,
              })}
              onBlur={handleSubmit(onSubmit)}
            />
            {hasError && <p className="mt-1 text-sm text-red-600">{errorMessage}</p>}
          </div>
        );

      case 'date':
        return (
          <div key={fieldId} className="mb-4">
            <label htmlFor={fieldId} className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
              id={fieldId}
              type="date"
              className={baseInputClasses}
              {...register(fieldId, {
                required: field.required ? `${field.label}為必填欄位` : false,
              })}
              onBlur={handleSubmit(onSubmit)}
            />
            {hasError && <p className="mt-1 text-sm text-red-600">{errorMessage}</p>}
          </div>
        );

      case 'select':
        return (
          <div key={fieldId} className="mb-4">
            <label htmlFor={fieldId} className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <select
              id={fieldId}
              className={baseInputClasses}
              {...register(fieldId, {
                required: field.required ? `${field.label}為必填欄位` : false,
              })}
            >
              <option value="">請選擇...</option>
              {field.options?.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {hasError && <p className="mt-1 text-sm text-red-600">{errorMessage}</p>}
          </div>
        );

      case 'checkbox':
        return (
          <div key={fieldId} className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <div className="space-y-2">
              {field.options?.map((option) => (
                <label key={option} className="flex items-center">
                  <input
                    type="checkbox"
                    value={option}
                    className="mr-2 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    {...register(fieldId, {
                      required: field.required ? `${field.label}為必填欄位` : false,
                    })}
                  />
                  <span className="text-sm text-gray-700">{option}</span>
                </label>
              ))}
            </div>
            {hasError && <p className="mt-1 text-sm text-red-600">{errorMessage}</p>}
          </div>
        );

      case 'radio':
        return (
          <div key={fieldId} className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <div className="space-y-2">
              {field.options?.map((option) => (
                <label key={option} className="flex items-center">
                  <input
                    type="radio"
                    value={option}
                    className="mr-2 border-gray-300 text-blue-600 focus:ring-blue-500"
                    {...register(fieldId, {
                      required: field.required ? `${field.label}為必填欄位` : false,
                    })}
                  />
                  <span className="text-sm text-gray-700">{option}</span>
                </label>
              ))}
            </div>
            {hasError && <p className="mt-1 text-sm text-red-600">{errorMessage}</p>}
          </div>
        );

      default:
        return null;
    }
  };

  if (!headerStructure || headerStructure.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">病歷資料</h2>
        <p className="text-gray-500 text-sm">此範本沒有定義任何欄位</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4">病歷資料</h2>
      <form onSubmit={handleSubmit(onSubmit)}>
        {headerStructure.map((field) => renderField(field))}
      </form>
    </div>
  );
};

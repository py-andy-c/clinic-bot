import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { logger } from '../../utils/logger';
import { NameWarning, DateInput } from '../../components/shared';
import { validateLiffPatientForm } from '../../utils/patientFormValidation';
import { formatDateForApi, convertApiDateToDisplay } from '../../utils/dateFormat';
import { liffApiService } from '../../services/liffApi';

export interface PatientFormData {
  full_name: string;
  phone_number: string;
  birthday?: string;
}

export interface PatientFormProps {
  clinicId: number | null;
  requireBirthday?: boolean;
  onSubmit: (data: PatientFormData) => Promise<void>;
  onCancel?: () => void;
  initialData?: Partial<PatientFormData>;
  submitButtonText?: string;
  cancelButtonText?: string;
  showCancelButton?: boolean;
  error?: string | null;
  isLoading?: boolean;
}

export const PatientForm: React.FC<PatientFormProps> = ({
  clinicId,
  requireBirthday: requireBirthdayProp,
  onSubmit,
  onCancel,
  initialData,
  submitButtonText,
  cancelButtonText,
  showCancelButton = true,
  error: externalError,
  isLoading = false,
}) => {
  const { t } = useTranslation();
  const [fullName, setFullName] = useState(initialData?.full_name || '');
  const [phoneNumber, setPhoneNumber] = useState(initialData?.phone_number || '');
  const [birthday, setBirthday] = useState(initialData?.birthday || '');
  const [requireBirthday, setRequireBirthday] = useState(requireBirthdayProp || false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const defaultSubmitText = submitButtonText || t('common.confirm');
  const defaultCancelText = cancelButtonText || t('common.cancel');

  // Fetch clinic settings if requireBirthday is not provided
  useEffect(() => {
    const fetchClinicSettings = async () => {
      if (requireBirthdayProp !== undefined || !clinicId) return;
      try {
        const clinicInfo = await liffApiService.getClinicInfo();
        setRequireBirthday(clinicInfo.require_birthday || false);
      } catch (err) {
        logger.error('Failed to fetch clinic settings:', err);
        // Don't block if we can't fetch settings
      }
    };
    fetchClinicSettings();
  }, [clinicId, requireBirthdayProp]);

  // Update form when initialData changes
  useEffect(() => {
    if (initialData) {
      if (initialData.full_name !== undefined) setFullName(initialData.full_name);
      if (initialData.phone_number !== undefined) setPhoneNumber(initialData.phone_number);
      if (initialData.birthday !== undefined) {
        // Convert API format (YYYY-MM-DD) to display format (YYYY/MM/DD) for DateInput
        setBirthday(convertApiDateToDisplay(initialData.birthday));
      }
    }
  }, [initialData]);

  const handleSubmit = async () => {
    if (!fullName.trim() || !clinicId) return;

    // Validate using shared validation utility
    const validation = validateLiffPatientForm(fullName, phoneNumber, birthday, requireBirthday);
    if (!validation.isValid) {
      setError(validation.error || t('patient.form.error.generic'));
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const formData: PatientFormData = {
        full_name: validation.normalizedData!.full_name,
        phone_number: validation.normalizedData!.phone_number!,
      };
      if (validation.normalizedData!.birthday) {
        formData.birthday = formatDateForApi(validation.normalizedData!.birthday);
      }
      await onSubmit(formData);
    } catch (err) {
      logger.error('Failed to submit patient form:', err);
      // Error handling is done by parent component
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setFullName('');
    setPhoneNumber('');
    setBirthday('');
    setError(null);
    onCancel?.();
  };

  const displayError = externalError || error;
  const isDisabled = isLoading || isSubmitting || !fullName.trim() || !phoneNumber.trim() || (requireBirthday && !birthday.trim());

  return (
    <div>
      <input
        type="text"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        placeholder={t('patient.form.name.placeholder')}
        className="w-full px-3 py-2 border border-gray-300 rounded-md mb-2"
      />
      <div className="mb-3">
        <NameWarning />
      </div>
      <input
        type="tel"
        value={phoneNumber}
        onChange={(e) => setPhoneNumber(e.target.value)}
        placeholder={t('patient.form.phone.placeholder')}
        className="w-full px-3 py-2 border border-gray-300 rounded-md mb-3"
      />
      {requireBirthday && (
        <div className="mb-3">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('patient.form.birthday.label')}
          </label>
          <DateInput
            value={birthday}
            onChange={setBirthday}
            className="w-full"
          />
        </div>
      )}
      {displayError && (
        <div className="bg-red-50 border border-red-200 rounded-md p-2 mb-3">
          <p className="text-sm text-red-600">{displayError}</p>
        </div>
      )}
      <div className="flex space-x-2">
        <button
          onClick={handleSubmit}
          disabled={isDisabled}
          className="flex-1 bg-primary-600 text-white py-2 px-4 rounded-md hover:bg-primary-700 disabled:opacity-50"
        >
          {isSubmitting ? t('common.processing') : defaultSubmitText}
        </button>
        {showCancelButton && (
          <button
            onClick={handleCancel}
            className="flex-1 bg-gray-100 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-200"
          >
            {defaultCancelText}
          </button>
        )}
      </div>
    </div>
  );
};


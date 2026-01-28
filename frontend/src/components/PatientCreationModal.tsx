import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseModal } from './shared/BaseModal';
import { Button } from './shared/Button';
import { DateInput } from './shared';
import { ModalHeader, ModalBody, ModalFooter } from './shared/ModalParts';
import { validateClinicPatientForm } from '../utils/patientFormValidation';
import { formatDateForApi } from '../utils/dateFormat';
import { apiService } from '../services/api';
import { useDebounce } from '../hooks/useDebounce';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../types/api';
import { GENDER_OPTIONS } from '../utils/genderUtils';

export interface PatientCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (patientId: number, patientName: string, phoneNumber: string | null, birthday: string | null) => void;
}

export const PatientCreationModal: React.FC<PatientCreationModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [birthday, setBirthday] = useState('');
  const [gender, setGender] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [duplicateCount, setDuplicateCount] = useState<number | null>(null);

  // Debounce name for duplicate checking (400ms delay)
  const debouncedName = useDebounce(fullName.trim(), 400);

  // Check for duplicates when name changes
  useEffect(() => {
    const checkDuplicate = async () => {
      const trimmedName = debouncedName.trim();

      // Only check if name has 2+ characters
      if (trimmedName.length < 2) {
        setDuplicateCount(null);
        return;
      }

      try {
        const result = await apiService.checkDuplicatePatientName(trimmedName);
        setDuplicateCount(result.count);
      } catch (err) {
        // Silently fail duplicate check - don't block user
        logger.error('Failed to check duplicate:', err);
        setDuplicateCount(null);
      }
    };

    if (isOpen && debouncedName) {
      checkDuplicate();
    } else {
      setDuplicateCount(null);
    }
  }, [debouncedName, isOpen]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setFullName('');
      setPhoneNumber('');
      setBirthday('');
      setGender('');
      setError(null);
      setDuplicateCount(null);
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    // Validate using shared validation utility
    // Note: All fields except name are optional for clinic-created patients
    const validation = validateClinicPatientForm(fullName, phoneNumber, birthday, gender);
    if (!validation.isValid) {
      setError(validation.error || '驗證失敗');
      return;
    }

    // Defensive check: ensure normalizedData exists (should always be present when isValid is true)
    if (!validation.normalizedData) {
      setError('驗證失敗');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const { full_name, phone_number, birthday: normalizedBirthday, gender: normalizedGender } = validation.normalizedData;
      const response = await apiService.createPatient({
        full_name,
        phone_number,
        ...(normalizedBirthday ? { birthday: formatDateForApi(normalizedBirthday) } : {}),
        ...(normalizedGender ? { gender: normalizedGender } : {}),
      });

      // Success - call onSuccess callback with all form data
      onSuccess(
        response.patient_id,
        response.full_name,
        phone_number,
        normalizedBirthday || null
      );
    } catch (err: any) {
      logger.error('Failed to create patient:', err);

      // Extract error message using shared utility (strips "Value error, " prefix)
      const errorMessage = getErrorMessage(err) || '建立病患失敗';
      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <BaseModal onClose={onClose} aria-label="新增病患" className="max-w-lg">
      <ModalHeader title="新增病患" showClose onClose={onClose} />
      <ModalBody>
        <div className="space-y-4">
          {/* Name Field */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              姓名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t('patient.form.name.placeholder')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              maxLength={255}
            />

            {/* Duplicate Warning */}
            {duplicateCount !== null && duplicateCount > 0 && (
              <div className="mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md p-2">
                <svg className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 24 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <p className="text-sm text-amber-800">
                  發現 {duplicateCount} 位同名病患，請確認是否為重複建立
                </p>
              </div>
            )}
          </div>

          {/* Phone Field */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              手機號碼
            </label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder={t('patient.form.phone.placeholder')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Birthday Field */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              生日
            </label>
            <DateInput
              value={birthday}
              onChange={setBirthday}
              className="w-full"
            />
          </div>

          {/* Gender Field */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              生理性別
            </label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">請選擇</option>
              {GENDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="secondary"
          onClick={onClose}
          disabled={isSubmitting}
        >
          取消
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          loading={isSubmitting}
          disabled={!fullName.trim() || isSubmitting}
        >
          建立
        </Button>
      </ModalFooter>
    </BaseModal>
  );
};


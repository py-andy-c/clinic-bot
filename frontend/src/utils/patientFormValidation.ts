/**
 * Shared validation utilities for patient forms (LIFF and clinic-side).
 */

import { validatePhoneNumber, validateOptionalPhoneNumber } from './phoneValidation';
import { validateAndNormalizeDate } from './dateFormat';

export interface PatientFormValidationResult {
  isValid: boolean;
  error?: string | undefined;
  normalizedData?: {
    full_name: string;
    phone_number: string | null;
    birthday?: string | undefined;
  } | undefined;
}

/**
 * Validate patient form data for clinic-side creation (optional phone/birthday).
 */
export const validateClinicPatientForm = (
  fullName: string,
  phoneNumber: string,
  birthday: string
): PatientFormValidationResult => {
  // Validate name
  const trimmedName = fullName.trim();
  if (!trimmedName) {
    return { isValid: false, error: '請輸入病患姓名' };
  }
  
  if (trimmedName.length > 255) {
    return { isValid: false, error: '姓名長度過長' };
  }
  
  // Validate phone if provided
  let normalizedPhone: string | null = null;
  if (phoneNumber.trim()) {
    const phoneValidation = validateOptionalPhoneNumber(phoneNumber);
    if (!phoneValidation.isValid) {
      return { isValid: false, error: phoneValidation.error || '手機號碼格式錯誤' };
    }
    normalizedPhone = phoneNumber.trim().replace(/[\s\-\(\)]/g, '');
  }
  
  // Validate and normalize birthday if provided
  let normalizedBirthday: string | undefined;
  if (birthday.trim()) {
    const dateValidation = validateAndNormalizeDate(birthday);
    if (!dateValidation.isValid) {
      return { isValid: false, error: dateValidation.error };
    }
    normalizedBirthday = dateValidation.normalized;
  }
  
  const normalizedData: {
    full_name: string;
    phone_number: string | null;
    birthday?: string;
  } = {
    full_name: trimmedName,
    phone_number: normalizedPhone,
  };
  
  if (normalizedBirthday) {
    normalizedData.birthday = normalizedBirthday;
  }
  
  return {
    isValid: true,
    normalizedData,
  };
};

/**
 * Validate patient form data for LIFF creation (required phone, optional birthday).
 */
export const validateLiffPatientForm = (
  fullName: string,
  phoneNumber: string,
  birthday: string,
  requireBirthday: boolean
): PatientFormValidationResult => {
  // Validate name
  const trimmedName = fullName.trim();
  if (!trimmedName) {
    return { isValid: false, error: '請輸入病患姓名' };
  }
  
  // Validate phone (required for LIFF)
  if (!phoneNumber.trim()) {
    return { isValid: false, error: '請輸入手機號碼' };
  }
  
  const phoneValidation = validatePhoneNumber(phoneNumber);
  if (!phoneValidation.isValid) {
    return { isValid: false, error: phoneValidation.error || '手機號碼格式錯誤' };
  }
  
  // Validate required birthday
  if (requireBirthday && !birthday.trim()) {
    return { isValid: false, error: '請輸入生日' };
  }
  
  // Validate and normalize birthday if provided
  let normalizedBirthday: string | undefined;
  if (birthday.trim()) {
    const dateValidation = validateAndNormalizeDate(birthday);
    if (!dateValidation.isValid) {
      return { isValid: false, error: dateValidation.error };
    }
    normalizedBirthday = dateValidation.normalized;
  }
  
  const normalizedData: {
    full_name: string;
    phone_number: string;
    birthday?: string;
  } = {
    full_name: trimmedName,
    phone_number: phoneNumber.replace(/[\s\-\(\)]/g, ''),
  };
  
  if (normalizedBirthday) {
    normalizedData.birthday = normalizedBirthday;
  }
  
  return {
    isValid: true,
    normalizedData: normalizedData as {
      full_name: string;
      phone_number: string | null;
      birthday?: string;
    },
  };
};


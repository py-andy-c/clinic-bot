/**
 * Shared validation utilities for patient profile forms (LIFF and clinic-side).
 * 
 * These utilities validate patient registration/profile data (name, phone, birthday, gender).
 * 
 * Note: This is distinct from "patient forms" (medical record templates sent to patients).
 */

import { validatePhoneNumber, validateOptionalPhoneNumber } from './phoneValidation';
import { validateAndNormalizeDate } from './dateFormat';
import { isValidGenderValue, GenderValue } from './genderUtils';

export interface PatientProfileFormValidationResult {
  isValid: boolean;
  error?: string | undefined;
  normalizedData?: {
    full_name: string;
    phone_number: string | null;
    birthday?: string | undefined;
    gender?: string | undefined;
  } | undefined;
}

/**
 * Validate patient profile form data for clinic-side creation (optional phone/birthday/gender).
 * All fields except name are optional for clinic-created patients.
 */
export const validateClinicPatientProfileForm = (
  fullName: string,
  phoneNumber: string,
  birthday: string,
  gender?: string
): PatientProfileFormValidationResult => {
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
  
  // Validate gender value if provided (gender is optional for clinic-created patients)
  let normalizedGender: string | undefined;
  if (gender && gender.trim()) {
    if (!isValidGenderValue(gender)) {
      return { isValid: false, error: '性別值無效' };
    }
    normalizedGender = gender.trim().toLowerCase() as GenderValue;
  }
  
  const normalizedData: {
    full_name: string;
    phone_number: string | null;
    birthday?: string;
    gender?: string;
  } = {
    full_name: trimmedName,
    phone_number: normalizedPhone,
  };
  
  if (normalizedBirthday) {
    normalizedData.birthday = normalizedBirthday;
  }
  
  if (normalizedGender) {
    normalizedData.gender = normalizedGender;
  }
  
  return {
    isValid: true,
    normalizedData,
  };
};

/**
 * Validate patient profile form data for LIFF creation (required phone, optional birthday/gender).
 */
export const validateLiffPatientProfileForm = (
  fullName: string,
  phoneNumber: string,
  birthday: string,
  requireBirthday: boolean,
  gender?: string,
  requireGender?: boolean
): PatientProfileFormValidationResult => {
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
  
  // Validate required gender
  if (requireGender && (!gender || !gender.trim())) {
    return { isValid: false, error: '請選擇生理性別' };
  }
  
  // Validate gender value if provided
  let normalizedGender: string | undefined;
  if (gender && gender.trim()) {
    if (!isValidGenderValue(gender)) {
      return { isValid: false, error: '性別值無效' };
    }
    normalizedGender = gender.trim().toLowerCase() as GenderValue;
  }
  
  const normalizedData: {
    full_name: string;
    phone_number: string;
    birthday?: string;
    gender?: string;
  } = {
    full_name: trimmedName,
    phone_number: phoneNumber.replace(/[\s\-\(\)]/g, ''),
  };
  
  if (normalizedBirthday) {
    normalizedData.birthday = normalizedBirthday;
  }
  
  if (normalizedGender) {
    normalizedData.gender = normalizedGender;
  }
  
  return {
    isValid: true,
    // Note: phone_number is string (not null) for LIFF validation since it's required.
    // The cast to string | null is for interface compatibility with clinic validation.
    normalizedData: normalizedData as {
      full_name: string;
      phone_number: string | null;
      birthday?: string;
      gender?: string;
    },
  };
};


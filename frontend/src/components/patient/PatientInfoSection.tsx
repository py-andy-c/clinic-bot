import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Patient } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useApiData } from '../../hooks/useApiData';
import { apiService } from '../../services/api';
import { DateInput } from '../shared/DateInput';
import { formatDateForApi, convertApiDateToDisplay } from '../../utils/dateFormat';
import { validateClinicPatientForm } from '../../utils/patientFormValidation';
import { formatDateOnly } from '../../utils/calendarUtils';
import { GENDER_OPTIONS, getGenderLabel } from '../../utils/genderUtils';

interface PatientInfoSectionProps {
  patient: Patient;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onUpdate: (data: {
    full_name?: string;
    phone_number?: string | null;
    birthday?: string;
    gender?: string;
  }) => Promise<void>;
  canEdit: boolean;
}

export const PatientInfoSection: React.FC<PatientInfoSectionProps> = ({
  patient,
  isEditing,
  onEdit,
  onCancel,
  onUpdate,
  canEdit,
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [fullName, setFullName] = useState(patient.full_name);
  const [phoneNumber, setPhoneNumber] = useState(patient.phone_number || '');
  const [birthday, setBirthday] = useState(patient.birthday || '');
  const [gender, setGender] = useState(patient.gender || '');
  const [requireBirthday, setRequireBirthday] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch clinic settings to check if birthday is required
  const fetchClinicSettings = useCallback(() => apiService.getClinicSettings(), []);
  const { data: clinicSettings } = useApiData(
    fetchClinicSettings,
    {
      enabled: !!user?.active_clinic_id,
      dependencies: [user?.active_clinic_id],
    }
  );

  useEffect(() => {
    if (clinicSettings) {
      setRequireBirthday(clinicSettings.clinic_info_settings?.require_birthday || false);
    }
  }, [clinicSettings]);

  // Update form when patient changes
  useEffect(() => {
    setFullName(patient.full_name);
    setPhoneNumber(patient.phone_number || '');
    // Convert API format (YYYY-MM-DD) to display format (YYYY/MM/DD) for DateInput
    setBirthday(convertApiDateToDisplay(patient.birthday));
    setGender(patient.gender || '');
  }, [patient]);

  const handleSave = async () => {
    setError(null);

    // Validate using shared validation utility (same as patient creation modal)
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
      setIsSaving(true);
      const { full_name, phone_number, birthday: normalizedBirthday, gender: normalizedGender } = validation.normalizedData;
      await onUpdate({
        full_name,
        phone_number,
        ...(normalizedBirthday ? { birthday: formatDateForApi(normalizedBirthday) } : {}),
        ...(normalizedGender ? { gender: normalizedGender } : {}),
      });
    } catch (err) {
      // Error is handled by parent component
    } finally {
      setIsSaving(false);
    }
  };

  if (isEditing) {
    return (
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">病患資訊</h2>
        
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              姓名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="請輸入姓名"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              電話
            </label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="請輸入電話號碼"
            />
          </div>

          {requireBirthday && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                生日
              </label>
              <DateInput
                value={birthday}
                onChange={setBirthday}
                className="w-full"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              生理性別
            </label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">請選擇</option>
              {GENDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex space-x-3 pt-4">
            <button
              onClick={handleSave}
              disabled={isSaving || !fullName.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? '儲存中...' : '儲存'}
            </button>
            <button
              onClick={onCancel}
              disabled={isSaving}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-gray-900">病患資訊</h2>
        {canEdit && (
          <button
            onClick={onEdit}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            編輯
          </button>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-medium text-gray-500">姓名</dt>
          <dd className="mt-1 text-sm text-gray-900">{patient.full_name}</dd>
        </div>

        <div>
          <dt className="text-sm font-medium text-gray-500">電話</dt>
          <dd className="mt-1 text-sm text-gray-900">
            {patient.phone_number || '-'}
          </dd>
        </div>

        {requireBirthday && (
          <div>
            <dt className="text-sm font-medium text-gray-500">生日</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {patient.birthday
                ? formatDateOnly(patient.birthday)
                : '-'}
            </dd>
          </div>
        )}

        {patient.gender && (
          <div>
            <dt className="text-sm font-medium text-gray-500">生理性別</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {getGenderLabel(patient.gender)}
            </dd>
          </div>
        )}

        <div>
          <dt className="text-sm font-medium text-gray-500">LINE 使用者</dt>
          <dd className="mt-1 text-sm text-gray-900">
            {patient.line_user_id ? (
              <button
                onClick={() => {
                  navigate(`/admin/clinic/line-users?lineUserId=${encodeURIComponent(patient.line_user_id!)}`);
                }}
                className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
              >
                {patient.line_user_display_name || '未設定名稱'}
              </button>
            ) : (
              '-'
            )}
          </dd>
        </div>

        <div>
          <dt className="text-sm font-medium text-gray-500">建立日期</dt>
          <dd className="mt-1 text-sm text-gray-900">
            {formatDateOnly(patient.created_at)}
          </dd>
        </div>
      </dl>
    </div>
  );
};


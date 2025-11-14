import React, { useState, useEffect } from 'react';
import { logger } from '../../utils/logger';
import { validatePhoneNumber } from '../../utils/phoneValidation';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { liffApiService } from '../../services/liffApi';
import { preserveQueryParams } from '../../utils/urlUtils';
import { formatDateForApi } from '../../utils/dateFormat';
import { NameWarning, DateInput } from '../../components/shared';

const FirstTimeRegister: React.FC = () => {
  const { clinicId } = useAppointmentStore();
  // For first-time registration, we don't have a display name from LINE yet
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [birthday, setBirthday] = useState('');
  const [requireBirthday, setRequireBirthday] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch clinic settings to check if birthday is required
  useEffect(() => {
    const fetchClinicSettings = async () => {
      if (!clinicId) return;
      try {
        const clinicInfo = await liffApiService.getClinicInfo();
        setRequireBirthday(clinicInfo.require_birthday || false);
      } catch (err) {
        logger.error('Failed to fetch clinic settings:', err);
        // Don't block registration if we can't fetch settings
      }
    };
    fetchClinicSettings();
  }, [clinicId]);


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fullName.trim()) {
      setError('請輸入您的姓名');
      return;
    }

    if (!phoneNumber.trim()) {
      setError('請輸入您的手機號碼');
      return;
    }

    const phoneValidation = validatePhoneNumber(phoneNumber);
    if (!phoneValidation.isValid && phoneValidation.error) {
      setError(phoneValidation.error);
      return;
    }

    if (requireBirthday && !birthday.trim()) {
      setError('請輸入您的生日');
      return;
    }

    if (!clinicId) {
      setError('診所資訊無效，請重新整理頁面');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const patientData: { full_name: string; phone_number: string; birthday?: string } = {
        full_name: fullName.trim(),
        phone_number: phoneNumber.replace(/[\s\-\(\)]/g, ''),
      };
      if (birthday.trim()) {
        patientData.birthday = formatDateForApi(birthday.trim());
      }
      await liffApiService.createPrimaryPatient(patientData);

      // Registration successful - update URL and trigger auth refresh
      // Preserve clinic_id and other query parameters while updating mode
      const newUrl = preserveQueryParams(window.location.pathname, { mode: 'book' });
      window.history.replaceState(null, '', newUrl);
      logger.log('📝 Registration successful - updated URL to:', newUrl);

      // Dispatch custom event to trigger authentication refresh
      logger.log('📡 Dispatching auth-refresh event');
      window.dispatchEvent(new CustomEvent('auth-refresh'));
    } catch (err) {
      logger.error('Registration failed:', err);
      setError(err instanceof Error ? err.message : '註冊失敗，請稍後再試');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            請填寫基本資料以完成註冊
          </h1>
        </div>

        {/* Registration Form */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Name Field */}
            <div>
              <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 mb-2">
                姓名 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="請輸入您的姓名"
                required
              />
              <NameWarning />
            </div>

            {/* Phone Number Field */}
            <div>
              <label htmlFor="phoneNumber" className="block text-sm font-medium text-gray-700 mb-2">
                手機號碼 <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                id="phoneNumber"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="0912345678"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                請輸入您的手機號碼 (09開頭的10位數字)
              </p>
            </div>

            {/* Birthday Field - Only show when required */}
            {requireBirthday && (
              <div>
                <label htmlFor="birthday" className="block text-sm font-medium text-gray-700 mb-2">
                  生日 <span className="text-red-500">*</span>
                </label>
                <DateInput
                  id="birthday"
                  value={birthday}
                  onChange={setBirthday}
                  className="w-full"
                  required={requireBirthday}
                />
                <p className="text-xs text-gray-500 mt-1">
                  請輸入您的生日，格式：YYYY/MM/DD (例如：1990/05/15)
                </p>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-primary-600 text-white py-3 px-4 rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                  註冊中...
                </div>
              ) : (
                '下一步'
              )}
            </button>
          </form>
        </div>

      </div>
    </div>
  );
};

export default FirstTimeRegister;

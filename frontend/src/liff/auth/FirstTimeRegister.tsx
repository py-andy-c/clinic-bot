import React, { useState } from 'react';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { liffApiService } from '../../services/liffApi';
import { preserveQueryParams } from '../../utils/urlUtils';

const FirstTimeRegister: React.FC = () => {
  const { clinicId } = useAppointmentStore();
  // For first-time registration, we don't have a display name from LINE yet
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validatePhoneNumber = (phone: string): boolean => {
    // Taiwanese phone number format: 09xxxxxxxx (10 digits)
    const phoneRegex = /^09\d{8}$/;
    return phoneRegex.test(phone.replace(/[\s\-\(\)]/g, ''));
  };

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

    if (!validatePhoneNumber(phoneNumber)) {
      setError('手機號碼格式不正確，請輸入09開頭的10位數字');
      return;
    }

    if (!clinicId) {
      setError('診所資訊無效，請重新整理頁面');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await liffApiService.createPrimaryPatient({
        full_name: fullName.trim(),
        phone_number: phoneNumber.replace(/[\s\-\(\)]/g, ''),
      });

      // Registration successful - update URL and trigger auth refresh
      // Preserve clinic_id and other query parameters while updating mode
      const newUrl = preserveQueryParams(window.location.pathname, { mode: 'book' });
      window.history.replaceState(null, '', newUrl);
      console.log('📝 Registration successful - updated URL to:', newUrl);

      // Dispatch custom event to trigger authentication refresh
      console.log('📡 Dispatching auth-refresh event');
      window.dispatchEvent(new CustomEvent('auth-refresh'));
    } catch (err) {
      console.error('Registration failed:', err);
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
            歡迎使用線上預約系統
          </h1>
          <p className="text-gray-600">
            請填寫基本資料以完成註冊
          </p>
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
              <p className="text-xs text-gray-500 mt-1">
                此為您健保卡上的姓名
              </p>
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

        {/* Footer */}
        <div className="text-center mt-6">
          <p className="text-xs text-gray-500">
            您的個人資料將用於預約管理和通知服務
          </p>
        </div>
      </div>
    </div>
  );
};

export default FirstTimeRegister;

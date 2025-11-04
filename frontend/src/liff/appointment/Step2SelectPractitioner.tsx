import React, { useState, useEffect } from 'react';
import { useAppointmentStore, Practitioner } from '../../stores/appointmentStore';
import { liffApiService } from '../../services/liffApi';

const Step2SelectPractitioner: React.FC = () => {
  const { appointmentTypeId, setPractitioner, clinicId, step, setStep } = useAppointmentStore();
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadPractitioners = async () => {
      if (!clinicId || !appointmentTypeId) return;

      try {
        setIsLoading(true);
        setError(null);
        const response = await liffApiService.getPractitioners(clinicId, appointmentTypeId);
        setPractitioners(response.practitioners);
      } catch (err) {
        console.error('Failed to load practitioners:', err);
        setError('無法載入治療師列表，請稍後再試');
      } finally {
        setIsLoading(false);
      }
    };

    loadPractitioners();
  }, [clinicId, appointmentTypeId]);

  const handlePractitionerSelect = (practitionerId: number | null, practitioner?: Practitioner) => {
    setPractitioner(practitionerId, practitioner, false); // false because user explicitly selected
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4 text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700"
          >
            重試
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          選擇治療師
        </h2>
      </div>

      <div className="space-y-3">
        {/* 不指定治療師 option - only show when there are multiple practitioners */}
        {practitioners.length > 1 && (
          <button
            onClick={() => handlePractitionerSelect(null)}
            className="w-full bg-white border border-gray-200 rounded-lg p-4 hover:border-primary-300 hover:shadow-md transition-all duration-200 text-left"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">不指定治療師</h3>
                <p className="text-sm text-gray-500">
                  系統將自動安排最適合的治療師
                </p>
              </div>
              <div className="text-primary-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </button>
        )}

        {/* Practitioner options */}
        {practitioners.map((practitioner) => (
          <button
            key={practitioner.id}
            onClick={() => handlePractitionerSelect(practitioner.id, practitioner)}
            className="w-full bg-white border border-gray-200 rounded-lg p-4 hover:border-primary-300 hover:shadow-md transition-all duration-200 text-left"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                {practitioner.picture_url ? (
                  <img
                    src={practitioner.picture_url}
                    alt={practitioner.full_name}
                    className="w-10 h-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                    <span className="text-gray-600 font-medium">
                      {practitioner.full_name.charAt(0)}
                    </span>
                  </div>
                )}
                <div>
                  <h3 className="font-medium text-gray-900">{practitioner.full_name}</h3>
                </div>
              </div>
              <div className="text-primary-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </button>
        ))}

        {practitioners.length === 0 && (
          <div className="text-center py-8">
            <p className="text-gray-500">目前沒有治療師提供此服務</p>
            <p className="text-sm text-gray-400 mt-2">
              請返回重新選擇預約類型
            </p>
          </div>
        )}
      </div>

      {/* Back button */}
      <div className="mt-6">
        <button
          onClick={() => setStep(step - 1)}
          className="w-full bg-white border-2 border-gray-300 text-gray-700 py-3 px-4 rounded-md hover:border-gray-400 hover:bg-gray-50 active:bg-gray-100 transition-all duration-200 font-medium"
        >
          返回上一步
        </button>
      </div>
    </div>
  );
};

export default Step2SelectPractitioner;

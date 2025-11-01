import React, { useState, useEffect } from 'react';
import { useAppointmentStore, AppointmentType } from '../../stores/appointmentStore';
import { liffApiService } from '../../services/liffApi';

const Step1SelectType: React.FC = () => {
  const { setAppointmentType, clinicId } = useAppointmentStore();
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadAppointmentTypes = async () => {
      if (!clinicId) return;

      try {
        setIsLoading(true);
        setError(null);
        const response = await liffApiService.getAppointmentTypes(clinicId);
        setAppointmentTypes(response.appointment_types);
      } catch (err) {
        console.error('Failed to load appointment types:', err);
        setError('無法載入預約類型，請稍後再試');
      } finally {
        setIsLoading(false);
      }
    };

    loadAppointmentTypes();
  }, [clinicId]);

  const handleTypeSelect = (type: AppointmentType) => {
    setAppointmentType(type.id, type);
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
          選擇預約類型
        </h2>
      </div>

      <div className="space-y-3">
        {appointmentTypes.map((type) => (
          <button
            key={type.id}
            onClick={() => handleTypeSelect(type)}
            className="w-full bg-white border border-gray-200 rounded-lg p-4 hover:border-primary-300 hover:shadow-md transition-all duration-200 text-left"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">{type.name}</h3>
                <p className="text-sm text-gray-500">
                  約 {type.duration_minutes} 分鐘
                </p>
              </div>
              <div className="text-primary-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </button>
        ))}

        {appointmentTypes.length === 0 && (
          <div className="text-center py-8">
            <p className="text-gray-500">目前沒有可用的預約類型</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Step1SelectType;

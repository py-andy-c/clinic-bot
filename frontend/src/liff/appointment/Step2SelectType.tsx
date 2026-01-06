import React from 'react';
import { useTranslation } from 'react-i18next';
import { LoadingSpinner, ErrorMessage } from '../../components/shared';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { AppointmentType } from '../../types';
import { useAppointmentTypesQuery } from '../../hooks/useAppointmentTypes';

const Step2SelectType: React.FC = () => {
  const { setAppointmentType, setAppointmentTypeInstructions, appointmentTypeInstructions, patient } = useAppointmentStore();
  const { t } = useTranslation();

  // For Step2SelectType (Flow 2), we use the selected patient's ID for filtering
  const { data, isLoading, error } = useAppointmentTypesQuery(patient?.id);

  // Update store with appointment type instructions when data loads
  React.useEffect(() => {
    if (data?.appointmentTypeInstructions !== undefined) {
      setAppointmentTypeInstructions(data.appointmentTypeInstructions);
    }
  }, [data?.appointmentTypeInstructions, setAppointmentTypeInstructions]);

  const handleTypeSelect = (type: AppointmentType) => {
    setAppointmentType(type.id, type);
  };

  // Use appointment types from React Query (already filtered by backend based on patient status)
  const activeAppointmentTypes = data?.appointmentTypes || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return <ErrorMessage message={t('appointment.errors.loadTypes')} onRetry={() => window.location.reload()} />;
  }

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          {t('appointment.selectType.title')}
        </h2>
        {patient && (
          <div className="bg-gray-50 rounded-md p-4 mb-4">
            <span className="text-sm font-medium text-gray-700">{t('patient.label')}：</span>
            <span className="text-sm text-gray-900">{patient.full_name}</span>
          </div>
        )}
        {appointmentTypeInstructions && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-blue-700 whitespace-pre-line">
                  {appointmentTypeInstructions}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {activeAppointmentTypes.map((type: AppointmentType) => (
          <button
            key={type.id}
            onClick={() => handleTypeSelect(type)}
            className="w-full bg-white border border-gray-200 rounded-lg p-4 hover:border-primary-300 hover:shadow-md transition-all duration-200 text-left"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">{type.name}</h3>
                <p className="text-sm text-gray-500">
                  {t('appointment.selectType.duration', { minutes: type.duration_minutes || 0 })}
                </p>
                {type.description && (
                  <p className="text-sm text-gray-600 mt-1">{type.description}</p>
                )}
              </div>
              <div className="text-primary-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </button>
        ))}

        {activeAppointmentTypes.length === 0 && (
          <div className="text-center py-8">
            <p className="text-gray-500">{t('appointment.selectType.noTypesAvailable')}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Step2SelectType;

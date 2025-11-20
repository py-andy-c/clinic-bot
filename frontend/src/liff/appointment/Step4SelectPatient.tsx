import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { logger } from '../../utils/logger';
import { LoadingSpinner } from '../../components/shared';
import { ApiErrorType, getErrorMessage } from '../../types';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { PatientSummary } from '../../services/liffApi';
import { liffApiService } from '../../services/liffApi';
import { PatientForm, PatientFormData } from '../components/PatientForm';

const Step4SelectPatient: React.FC = () => {
  const { t } = useTranslation();
  const { setPatient, clinicId } = useAppointmentStore();
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [requireBirthday, setRequireBirthday] = useState(false);

  useEffect(() => {
    loadPatients();
  }, [clinicId]);

  // Automatically show add form if no patients exist (for first-time users)
  useEffect(() => {
    if (!isLoading && patients.length === 0 && !showAddForm) {
      setShowAddForm(true);
    }
  }, [isLoading, patients.length, showAddForm]);

  // Fetch clinic settings to check if birthday is required
  useEffect(() => {
    const fetchClinicSettings = async () => {
      if (!clinicId) return;
      try {
        const clinicInfo = await liffApiService.getClinicInfo();
        setRequireBirthday(clinicInfo.require_birthday || false);
      } catch (err) {
        logger.error('Failed to fetch clinic settings:', err);
        // Don't block if we can't fetch settings
      }
    };
    fetchClinicSettings();
  }, [clinicId]);

  const loadPatients = async () => {
    try {
      setIsLoading(true);
      const response = await liffApiService.getPatients();
      setPatients(response.patients);
    } catch (err) {
      logger.error('Failed to load patients:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePatientSelect = (patient: PatientSummary) => {
    // Clear any previous errors
    setError(null);
    
    // Check if patient has reached the appointment limit
    const futureCount = patient.future_appointments_count ?? 0;
    const maxAllowed = patient.max_future_appointments ?? 0;
    
    if (maxAllowed > 0 && futureCount >= maxAllowed) {
      // Don't allow selection - show error message
      setError(t('patient.errors.maxAppointmentsReached', { count: futureCount, max: maxAllowed }));
      return;
    }
    
    setPatient(patient.id, {
      id: patient.id,
      full_name: patient.full_name,
      created_at: patient.created_at,
    });
  };


  const handleAddPatient = async (formData: PatientFormData) => {
    try {
      setIsAdding(true);
      setError(null);
      const response = await liffApiService.createPatient(formData);

      // Reload patients to get updated appointment counts and the new patient
      const responseAfterReload = await liffApiService.getPatients();
      setPatients(responseAfterReload.patients);
      setShowAddForm(false);
      
      // Find the newly created patient from the updated list
      const createdPatient = responseAfterReload.patients.find(p => p.id === response.patient_id);
      
      if (createdPatient) {
        setPatient(createdPatient.id, {
          id: createdPatient.id,
          full_name: createdPatient.full_name,
          created_at: createdPatient.created_at,
        });
      }
    } catch (err: ApiErrorType) {
      logger.error('Failed to add patient:', err);
      setError(getErrorMessage(err));
      throw err; // Re-throw so PatientForm can handle it
    } finally {
      setIsAdding(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          {t('appointment.steps.selectPatient')}
        </h2>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <div className="space-y-3">
        {patients.map((patient) => {
          const futureCount = patient.future_appointments_count ?? 0;
          const maxAllowed = patient.max_future_appointments ?? 0;
          const isAtLimit = maxAllowed > 0 && futureCount >= maxAllowed;
          
          return (
            <button
              key={patient.id}
              onClick={() => handlePatientSelect(patient)}
              disabled={isAtLimit}
              className={`w-full bg-white border rounded-lg p-4 text-left transition-all duration-200 ${
                isAtLimit
                  ? 'border-gray-300 opacity-60 cursor-not-allowed'
                  : 'border-gray-200 hover:border-primary-300 hover:shadow-md'
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className={`font-medium ${isAtLimit ? 'text-gray-500' : 'text-gray-900'}`}>
                  {patient.full_name}
                </h3>
                {isAtLimit && (
                  <span className="text-xs text-red-600">
                    {t('patient.errors.appointmentLimit', { current: futureCount, max: maxAllowed })}
                  </span>
                )}
              </div>
            </button>
          );
        })}

        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-4 hover:border-primary-300 hover:bg-primary-50 transition-all duration-200"
          >
            <div className="flex items-center justify-center text-primary-600">
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {t('patient.management.addPatient')}
            </div>
          </button>
        )}

        {showAddForm && (
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="font-medium text-gray-900 mb-3">{t('patient.management.addPatient')}</h3>
            <PatientForm
              clinicId={clinicId}
              requireBirthday={requireBirthday}
              onSubmit={handleAddPatient}
              onCancel={() => {
                  setShowAddForm(false);
                  setError(null);
                }}
              error={error}
              isLoading={isAdding}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default Step4SelectPatient;

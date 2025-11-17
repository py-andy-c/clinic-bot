import React, { useState, useEffect } from 'react';
import { logger } from '../../utils/logger';
import { LoadingSpinner } from '../../components/shared';
import { ApiErrorType, getErrorMessage } from '../../types';
import { useAppointmentStore, Patient } from '../../stores/appointmentStore';
import { liffApiService } from '../../services/liffApi';
import { PatientForm, PatientFormData } from '../components/PatientForm';

const Step4SelectPatient: React.FC = () => {
  const { setPatient, clinicId } = useAppointmentStore();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [requireBirthday, setRequireBirthday] = useState(false);

  useEffect(() => {
    loadPatients();
  }, [clinicId]);

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

  const handlePatientSelect = (patient: Patient) => {
    setPatient(patient.id, patient);
  };


  const handleAddPatient = async (formData: PatientFormData) => {
    try {
      setIsAdding(true);
      setError(null);
      const response = await liffApiService.createPatient(formData);

      const newPatient: Patient = {
        id: response.patient_id,
        full_name: response.full_name,
        created_at: new Date().toISOString(),
      };

      setPatients(prev => [...prev, newPatient]);
      setShowAddForm(false);
      setPatient(newPatient.id, newPatient);
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
          選擇就診人
        </h2>
      </div>

      <div className="space-y-3">
        {patients.map((patient) => (
          <button
            key={patient.id}
            onClick={() => handlePatientSelect(patient)}
            className="w-full bg-white border border-gray-200 rounded-lg p-4 hover:border-primary-300 hover:shadow-md transition-all duration-200 text-left"
          >
            <h3 className="font-medium text-gray-900">{patient.full_name}</h3>
          </button>
        ))}

        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-4 hover:border-primary-300 hover:bg-primary-50 transition-all duration-200"
          >
            <div className="flex items-center justify-center text-primary-600">
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              新增就診人
            </div>
          </button>
        )}

        {showAddForm && (
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="font-medium text-gray-900 mb-3">新增就診人</h3>
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

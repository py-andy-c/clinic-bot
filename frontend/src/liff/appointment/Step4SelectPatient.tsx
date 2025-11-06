import React, { useState, useEffect } from 'react';
import { logger } from '../../utils/logger';
import { LoadingSpinner } from '../../components/shared';
import { validatePhoneNumber } from '../../utils/phoneValidation';
import { ApiErrorType, getErrorMessage } from '../../types';
import { useAppointmentStore, Patient } from '../../stores/appointmentStore';
import { liffApiService } from '../../services/liffApi';

const Step4SelectPatient: React.FC = () => {
  const { setPatient, clinicId, step, setStep } = useAppointmentStore();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientPhone, setNewPatientPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    loadPatients();
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


  const handleAddPatient = async () => {
    if (!newPatientName.trim() || !clinicId) return;

    // Validate phone number
    if (!newPatientPhone.trim()) {
      setError('請輸入手機號碼');
      return;
    }

    const phoneValidation = validatePhoneNumber(newPatientPhone);
    if (!phoneValidation.isValid && phoneValidation.error) {
      setError(phoneValidation.error);
      return;
    }

    try {
      setIsAdding(true);
      setError(null);
      const response = await liffApiService.createPatient({
        full_name: newPatientName.trim(),
        phone_number: newPatientPhone.replace(/[\s\-\(\)]/g, ''),
      });

      const newPatient: Patient = {
        id: response.patient_id,
        full_name: response.full_name,
        created_at: new Date().toISOString(),
      };

      setPatients(prev => [...prev, newPatient]);
      setNewPatientName('');
      setNewPatientPhone('');
      setShowAddForm(false);
      setPatient(newPatient.id, newPatient);
    } catch (err: ApiErrorType) {
      logger.error('Failed to add patient:', err);
      
      setError(getErrorMessage(err));
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
            <input
              type="text"
              value={newPatientName}
              onChange={(e) => setNewPatientName(e.target.value)}
              placeholder="請輸入姓名"
              className="w-full px-3 py-2 border border-gray-300 rounded-md mb-3"
            />
            <input
              type="tel"
              value={newPatientPhone}
              onChange={(e) => setNewPatientPhone(e.target.value)}
              placeholder="請輸入手機號碼 (0912345678)"
              className="w-full px-3 py-2 border border-gray-300 rounded-md mb-3"
            />
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-2 mb-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}
            <div className="flex space-x-2">
              <button
                onClick={handleAddPatient}
                disabled={isAdding || !newPatientName.trim() || !newPatientPhone.trim()}
                className="flex-1 bg-primary-600 text-white py-2 px-4 rounded-md hover:bg-primary-700 disabled:opacity-50"
              >
                {isAdding ? '新增中...' : '確認'}
              </button>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setNewPatientName('');
                  setNewPatientPhone('');
                  setError(null);
                }}
                className="flex-1 bg-gray-100 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-200"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>

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

export default Step4SelectPatient;

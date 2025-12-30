import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import moment from 'moment-timezone';
import { logger } from '../../utils/logger';
import { LoadingSpinner, ErrorMessage, DateInput } from '../../components/shared';
import { formatDateForApi, convertApiDateToDisplay } from '../../utils/dateFormat';
import { validatePhoneNumber } from '../../utils/phoneValidation';
import { ApiErrorType, getErrorMessage, AxiosErrorResponse } from '../../types';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { liffApiService } from '../../services/liffApi';
import { useModal } from '../../contexts/ModalContext';
import { PatientForm, PatientFormData } from '../components/PatientForm';
import { useLiffBackButton } from '../../hooks/useLiffBackButton';
import { LanguageSelector } from '../components/LanguageSelector';
import { GENDER_OPTIONS, getGenderLabel } from '../../utils/genderUtils';
import { PatientSummary } from '../../services/liffApi';

const PatientManagement: React.FC = () => {
  const { t } = useTranslation();
  const { clinicId } = useAppointmentStore();
  const { alert: showAlert, confirm: showConfirm } = useModal();
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [editingPatientId, setEditingPatientId] = useState<number | null>(null);
  const [editPatientName, setEditPatientName] = useState('');
  const [editPatientPhone, setEditPatientPhone] = useState('');
  const [editPatientBirthday, setEditPatientBirthday] = useState('');
  const [editPatientGender, setEditPatientGender] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [requireBirthday, setRequireBirthday] = useState(false);
  const [requireGender, setRequireGender] = useState(false);

  // Enable back button navigation - always goes back to home
  useLiffBackButton('settings');

  useEffect(() => {
    loadPatients();
  }, [clinicId]);

  // Fetch clinic settings to check if birthday or gender is required
  useEffect(() => {
    const fetchClinicSettings = async () => {
      if (!clinicId) return;
      try {
        const clinicInfo = await liffApiService.getClinicInfo();
        setRequireBirthday(clinicInfo.require_birthday || false);
        setRequireGender(clinicInfo.require_gender || false);
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
      setError(null);
      const response = await liffApiService.getPatients();
      setPatients(response.patients);
    } catch (err) {
      logger.error('Failed to load patients:', err);
      setError(t('patient.errors.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };


  const handleAddPatient = async (formData: PatientFormData) => {
    try {
      setIsAdding(true);
      setError(null);
      await liffApiService.createPatient(formData);

      // Reload patients to get the full data including phone number
      await loadPatients();
      setShowAddForm(false);
    } catch (err: ApiErrorType) {
      logger.error('Failed to add patient:', err);
      setError(getErrorMessage(err));
      throw err; // Re-throw so PatientForm can handle it
    } finally {
      setIsAdding(false);
    }
  };

  const handleStartEdit = (patient: PatientSummary) => {
    setEditingPatientId(patient.id);
    setEditPatientName(patient.full_name);
    setEditPatientPhone(patient.phone_number || '');
    // Convert API format (YYYY-MM-DD) to display format (YYYY/MM/DD) for DateInput
    setEditPatientBirthday(convertApiDateToDisplay(patient.birthday));
    setEditPatientGender(patient.gender || '');
    setError(null);
  };

  const handleCancelEdit = () => {
    setEditingPatientId(null);
    setEditPatientName('');
    setEditPatientPhone('');
    setEditPatientBirthday('');
    setEditPatientGender('');
    setError(null);
  };

  const handleUpdatePatient = async (patientId: number) => {
    if (!editPatientName.trim()) {
      setError(t('patient.form.name.error.required'));
      return;
    }

    if (!editPatientPhone.trim()) {
      setError(t('patient.form.phone.error.required'));
      return;
    }

    const phoneValidation = validatePhoneNumber(editPatientPhone);
    if (!phoneValidation.isValid && phoneValidation.error) {
      setError(phoneValidation.error);
      return;
    }

    try {
      setIsUpdating(true);
      setError(null);
      const updateData: { full_name?: string; phone_number?: string; birthday?: string; gender?: string } = {
        full_name: editPatientName.trim(),
        phone_number: editPatientPhone.replace(/[\s\-\(\)]/g, ''),
      };
      if (editPatientBirthday.trim()) {
        updateData.birthday = formatDateForApi(editPatientBirthday.trim());
      }
      if (editPatientGender.trim()) {
        updateData.gender = editPatientGender.trim().toLowerCase();
      }
      await liffApiService.updatePatient(patientId, updateData);

      // Reload patients to get updated data
      await loadPatients();
      setEditingPatientId(null);
    } catch (err: ApiErrorType) {
      logger.error('Failed to update patient:', err);
      
      setError(getErrorMessage(err));
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeletePatient = async (patientId: number, patientName: string) => {
    // Check if this is the last patient
    if (patients.length <= 1) {
      await showAlert(t('patient.errors.cannotDeleteLast'), t('status.error'));
      return;
    }

    const confirmed = await showConfirm(
      t('patient.management.confirmDelete', { name: patientName }),
      t('patient.management.confirmDeleteTitle')
    );

    if (!confirmed) return;

    try {
      await liffApiService.deletePatient(patientId);
      setPatients(prev => prev.filter(p => p.id !== patientId));
    } catch (err: ApiErrorType) {
      logger.error('Failed to delete patient:', err);

      // Handle specific error cases - use type guard for Axios error with response
      if (typeof err === 'object' && err && 'response' in err) {
        const axiosError = err as AxiosErrorResponse;
        if (axiosError.response?.status === 409) {
          const errorDetail = axiosError.response.data?.detail;
          // Check for known error messages (both English and Chinese versions from backend)
          // TODO: Consider using error codes instead of string matching for better maintainability
          if (errorDetail === "Cannot delete patient with future appointments" ||
              errorDetail === "無法刪除此就診人，因為該就診人尚有未來的預約記錄。\n\n請先刪除或取消相關預約後再試。") {
            await showAlert(t('patient.errors.cannotDeleteWithAppointments'), t('status.error'));
          } else if (errorDetail === "至少需保留一位就診人" ||
                     errorDetail === "Cannot delete the last patient") {
            await showAlert(t('patient.errors.cannotDeleteLast'), t('status.error'));
          } else {
            await showAlert(t('patient.errors.deleteFailed'), t('status.error'));
          }
        } else {
          await showAlert(t('patient.errors.deleteFailed'), t('status.error'));
        }
      } else {
        await showAlert(t('patient.errors.deleteFailed'), t('status.error'));
      }
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-md mx-auto">
          {/* Title with language selector inline */}
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-bold text-gray-900">
              {t('patient.management.title')}
            </h1>
            <LanguageSelector />
          </div>
          <p className="text-sm text-gray-500 mb-6">
            {t('home.managePatientsDesc')}
          </p>
          
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-md mx-auto">
          {/* Title with language selector inline */}
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-bold text-gray-900">
              {t('patient.management.title')}
            </h1>
            <LanguageSelector />
          </div>
          <p className="text-sm text-gray-500 mb-6">
            {t('home.managePatientsDesc')}
          </p>
          
          <div className="my-8">
            <ErrorMessage message={error} onRetry={loadPatients} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-md mx-auto">
        {/* Title with language selector inline */}
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold text-gray-900">
            {t('patient.management.title')}
          </h1>
          <LanguageSelector />
        </div>
        <p className="text-sm text-gray-500 mb-6">
          {t('home.managePatientsDesc')}
        </p>

        <div className="bg-white rounded-lg shadow-md p-6">

          <div className="space-y-3 mb-6">
            {patients.map((patient) => (
              <div key={patient.id}>
                {editingPatientId === patient.id ? (
                  <div className="border border-gray-200 rounded-md p-4 bg-white">
                    <h3 className="font-medium text-gray-900 mb-3">{t('patient.management.editPatient')}</h3>
                    <div className="mb-3">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('patient.form.name.label')}
                      </label>
                      <input
                        type="text"
                        value={editPatientName}
                        onChange={(e) => setEditPatientName(e.target.value)}
                        placeholder={t('patient.form.name.placeholder')}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      />
                    </div>
                    <div className="mb-3">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('patient.form.phone.label')}
                      </label>
                      <input
                        type="tel"
                        value={editPatientPhone}
                        onChange={(e) => setEditPatientPhone(e.target.value)}
                        placeholder={t('patient.form.phone.placeholder')}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      />
                    </div>
                    {requireBirthday && (
                      <div className="mb-3">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {t('patient.form.birthday.label')}
                        </label>
                        <DateInput
                          value={editPatientBirthday}
                          onChange={setEditPatientBirthday}
                          className="w-full"
                        />
                      </div>
                    )}
                    {requireGender && (
                      <div className="mb-3">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {t('patient.form.gender.label')}
                        </label>
                        <select
                          value={editPatientGender}
                          onChange={(e) => setEditPatientGender(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        >
                          <option value="">{t('patient.form.gender.placeholder')}</option>
                          {GENDER_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {error && (
                      <div className="bg-red-50 border border-red-200 rounded-md p-2 mb-3">
                        <p className="text-sm text-red-600">{error}</p>
                      </div>
                    )}
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleUpdatePatient(patient.id)}
                        disabled={isUpdating || !editPatientName.trim() || !editPatientPhone.trim()}
                        className="flex-1 bg-primary-600 text-white py-2 px-4 rounded-md hover:bg-primary-700 disabled:opacity-50"
                      >
                        {isUpdating ? t('common.updating') : t('common.confirm')}
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="flex-1 bg-gray-100 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-200"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">{patient.full_name}</div>
                      <div className="text-sm text-gray-600 mt-1">{patient.phone_number}</div>
                      {patient.birthday && (
                        <div className="text-sm text-gray-500 mt-1">
                          {t('patient.management.birthday', { date: moment(patient.birthday).format('YYYY/MM/DD') })}
                        </div>
                      )}
                      {patient.gender && (
                        <div className="text-sm text-gray-500 mt-1">
                          {t('patient.form.gender.display')}: {getGenderLabel(patient.gender)}
                        </div>
                      )}
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleStartEdit(patient)}
                        className="text-primary-600 hover:text-primary-800 text-sm font-medium"
                      >
                        {t('patient.management.edit')}
                      </button>
                      {patients.length > 1 && (
                        <button
                          onClick={() => handleDeletePatient(patient.id, patient.full_name)}
                          className="text-red-600 hover:text-red-800 text-sm font-medium"
                        >
                          {t('patient.management.deletePatient')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="w-full bg-primary-50 text-primary-600 border-2 border-dashed border-primary-200 rounded-md py-3 px-4 hover:bg-primary-100 transition-colors flex items-center justify-center"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {t('patient.management.addPatient')}
            </button>
          )}

          {showAddForm && (
            <div className="border border-gray-200 rounded-md p-4">
              <h3 className="font-medium text-gray-900 mb-3">{t('patient.management.addPatient')}</h3>
              <PatientForm
                clinicId={clinicId}
                requireBirthday={requireBirthday}
                requireGender={requireGender}
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
    </div>
  );
};

export default PatientManagement;

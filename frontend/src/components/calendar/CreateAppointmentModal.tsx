/**
 * CreateAppointmentModal Component
 * 
 * Modal for creating new appointments on behalf of patients.
 * Multi-step flow: Patient → Appointment Type → Practitioner → Date/Time → Confirm
 * Auto-advances on selection, similar to LIFF appointment flow.
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { BaseModal } from './BaseModal';
import { DateTimePicker } from './DateTimePicker';
import { apiService } from '../../services/api';
import { getErrorMessage } from '../../types/api';
import { logger } from '../../utils/logger';
import { LoadingSpinner, SearchInput } from '../shared';
import { Patient } from '../../types';
import moment from 'moment-timezone';
import { formatTo12Hour } from '../../utils/calendarUtils';
import { useApiData } from '../../hooks/useApiData';
import { useAuth } from '../../hooks/useAuth';

type CreateStep = 'patient' | 'appointmentType' | 'practitioner' | 'datetime' | 'confirm';

const STEP_ORDER: CreateStep[] = ['patient', 'appointmentType', 'practitioner', 'datetime', 'confirm'];
const STEP_TITLES: Record<CreateStep, string> = {
  patient: '選擇病患',
  appointmentType: '選擇預約類型',
  practitioner: '選擇治療師',
  datetime: '選擇日期與時間',
  confirm: '確認預約',
};

export interface CreateAppointmentModalProps {
  preSelectedPatientId?: number;
  initialDate?: string | null; // Initial date in YYYY-MM-DD format
  practitioners: { id: number; full_name: string }[];
  appointmentTypes: { id: number; name: string; duration_minutes: number }[];
  onClose: () => void;
  onConfirm: (formData: {
    patient_id: number;
    appointment_type_id: number;
    practitioner_id: number;
    start_time: string;
    notes: string;
  }) => Promise<void>;
}

export const CreateAppointmentModal: React.FC<CreateAppointmentModalProps> = React.memo(({
  preSelectedPatientId,
  initialDate,
  practitioners,
  appointmentTypes,
  onClose,
  onConfirm,
}) => {
  const [step, setStep] = useState<CreateStep>(preSelectedPatientId ? 'appointmentType' : 'patient');
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(preSelectedPatientId || null);
  const [selectedAppointmentTypeId, setSelectedAppointmentTypeId] = useState<number | null>(null);
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(initialDate || null);
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const isNavigatingBack = useRef(false);
  
  // Use useApiData for patients with caching and request deduplication
  // This shares cache with PatientsPage, reducing redundant API calls
  const { isLoading: authLoading, isAuthenticated } = useAuth();
  const fetchPatientsFn = useCallback(() => apiService.getPatients(), []);
  const shouldFetchPatients = step === 'patient' || !!preSelectedPatientId;
  
  const { 
    data: patientsData, 
    loading: isLoadingPatients,
    error: patientsError 
  } = useApiData<Patient[]>(
    fetchPatientsFn,
    {
      enabled: !authLoading && isAuthenticated && shouldFetchPatients,
      dependencies: [authLoading, isAuthenticated, step, preSelectedPatientId],
      cacheTTL: 5 * 60 * 1000, // 5 minutes cache - shares with PatientsPage
      defaultErrorMessage: '無法載入病患列表',
      initialData: [],
    }
  );
  
  // Ensure patients is always an array (never null)
  const patients = patientsData || [];
  
  // Update error state when patients fetch fails
  useEffect(() => {
    if (patientsError) {
      setError(patientsError);
    }
  }, [patientsError]);

  // Derived values
  const selectedPatient = useMemo(() => 
    patients.find(p => p.id === selectedPatientId) || null,
    [patients, selectedPatientId]
  );
  const selectedAppointmentType = useMemo(() =>
    appointmentTypes.find(at => at.id === selectedAppointmentTypeId) || null,
    [appointmentTypes, selectedAppointmentTypeId]
  );
  const selectedPractitioner = useMemo(() =>
    practitioners.find(p => p.id === selectedPractitionerId) || null,
    [practitioners, selectedPractitionerId]
  );
  const filteredPatients = useMemo(() => {
    if (!searchQuery.trim()) return patients;
    const query = searchQuery.toLowerCase();
    return patients.filter(p =>
      p.full_name.toLowerCase().includes(query) ||
      p.phone_number?.toLowerCase().includes(query) ||
      p.line_user_display_name?.toLowerCase().includes(query)
    );
  }, [patients, searchQuery]);

  // Auto-advance on patient selection (only if not navigating back)
  useEffect(() => {
    if (isNavigatingBack.current) {
      isNavigatingBack.current = false;
      return;
    }
    if (selectedPatientId && step === 'patient') {
      const nextStepIndex = STEP_ORDER.indexOf(step) + 1;
      if (nextStepIndex < STEP_ORDER.length) {
        setStep(STEP_ORDER[nextStepIndex] as CreateStep);
      }
    }
  }, [selectedPatientId, step]);

  // Auto-advance on appointment type selection (only if not navigating back)
  useEffect(() => {
    if (isNavigatingBack.current) {
      isNavigatingBack.current = false;
      return;
    }
    if (selectedAppointmentTypeId && step === 'appointmentType') {
      const nextStepIndex = STEP_ORDER.indexOf(step) + 1;
      if (nextStepIndex < STEP_ORDER.length) {
        setStep(STEP_ORDER[nextStepIndex] as CreateStep);
      }
    }
  }, [selectedAppointmentTypeId, step]);

  // Auto-advance on practitioner selection (only if not navigating back)
  useEffect(() => {
    if (isNavigatingBack.current) {
      isNavigatingBack.current = false;
      return;
    }
    if (selectedPractitionerId && step === 'practitioner') {
      const nextStepIndex = STEP_ORDER.indexOf(step) + 1;
      if (nextStepIndex < STEP_ORDER.length) {
        setStep(STEP_ORDER[nextStepIndex] as CreateStep);
      }
    }
  }, [selectedPractitionerId, step]);

  // Auto-advance on time selection (only if not navigating back)
  useEffect(() => {
    if (isNavigatingBack.current) {
      isNavigatingBack.current = false;
      return;
    }
    if (selectedTime && step === 'datetime') {
      const nextStepIndex = STEP_ORDER.indexOf(step) + 1;
      if (nextStepIndex < STEP_ORDER.length) {
        setStep(STEP_ORDER[nextStepIndex] as CreateStep);
      }
    }
  }, [selectedTime, step]);

  // Patients are now loaded via useApiData hook above
  // This provides caching and request deduplication, sharing cache with PatientsPage


  // Reset all state function
  const resetState = useCallback(() => {
    setSelectedPatientId(null);
    setSelectedAppointmentTypeId(null);
    setSelectedPractitionerId(null);
    setSelectedDate(initialDate || null); // Preserve initialDate if provided
      setSelectedTime('');
      setSearchQuery('');
      setStep('patient');
      setError(null);
  }, [initialDate]);

  // Reset state when preSelectedPatientId changes
  useEffect(() => {
    if (preSelectedPatientId === undefined) {
      // Modal opened without pre-selected patient - reset all state
      resetState();
    } else {
      // Pre-selected patient provided - set patient and reset other selections
      setSelectedPatientId(preSelectedPatientId);
      setSelectedAppointmentTypeId(null);
      setSelectedPractitionerId(null);
      setSelectedDate(initialDate || null); // Preserve initialDate if provided
      setSelectedTime('');
      setSearchQuery('');
      setStep('appointmentType');
        setError(null);
    }
  }, [preSelectedPatientId, resetState, initialDate]);

  // Navigation
  const currentStepIndex = STEP_ORDER.indexOf(step);

  const handleBack = () => {
    setError(null);
    if (currentStepIndex > 0) {
      isNavigatingBack.current = true;
      const prevStep = STEP_ORDER[currentStepIndex - 1];
      if (prevStep) {
        // Clear selections when going back to allow re-selection
        if (prevStep === 'datetime') {
          setSelectedTime('');
        } else if (prevStep === 'practitioner') {
          setSelectedPractitionerId(null);
        } else if (prevStep === 'appointmentType') {
          setSelectedAppointmentTypeId(null);
        } else if (prevStep === 'patient') {
          setSelectedPatientId(null);
        }
        setStep(prevStep);
      }
    } else if (preSelectedPatientId) {
      // Close modal and reset state when going back from first step with pre-selected patient
      resetState();
      onClose();
    }
  };

  const handleSave = async () => {
    if (!selectedPatientId || !selectedAppointmentTypeId || !selectedPractitionerId || !selectedDate || !selectedTime) {
      setError('請填寫所有必填欄位');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const startTime = moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei').toISOString();
      await onConfirm({
        patient_id: selectedPatientId,
        appointment_type_id: selectedAppointmentTypeId,
        practitioner_id: selectedPractitionerId,
        start_time: startTime,
        notes: '', // Clinic users cannot add notes during appointment creation
      });
      // Reset state after successful creation
      setSelectedPatientId(null);
      setSelectedAppointmentTypeId(null);
      setSelectedPractitionerId(null);
      setSelectedDate(null);
      setSelectedTime('');
      setSearchQuery('');
      setStep('patient');
    } catch (err) {
      logger.error('Error creating appointment:', err);
      setError(getErrorMessage(err));
      setStep('datetime');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDateSelect = (dateString: string) => {
      setSelectedDate(dateString);
      setSelectedTime('');
  };

  const handleTimeSelect = (time: string) => {
    setSelectedTime(time);
  };

  // Render step content
  const renderStepContent = () => {
    switch (step) {
      case 'patient':
        return (
          <div className="space-y-4">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="搜尋病患姓名、電話或LINE..."
            />
            {isLoadingPatients ? (
              <div className="flex items-center justify-center py-8">
                <LoadingSpinner size="sm" />
              </div>
            ) : !searchQuery.trim() ? (
              <div className="text-center py-8 text-gray-500">請輸入搜尋關鍵字以尋找病患</div>
            ) : filteredPatients.length === 0 ? (
              <div className="text-center py-8 text-gray-500">找不到符合的病患</div>
            ) : (
              <div className="space-y-3">
                {filteredPatients.map((patient) => (
                  <button
                    key={patient.id}
                    onClick={() => setSelectedPatientId(patient.id)}
                    className="w-full bg-white border border-gray-200 rounded-lg p-4 hover:border-primary-300 hover:shadow-md transition-all duration-200 text-left"
                  >
                    <h3 className="font-medium text-gray-900">{patient.full_name}</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      {patient.phone_number}
                      {patient.line_user_display_name && ` • ${patient.line_user_display_name}`}
                    </p>
                    {!patient.line_user_id && (
                      <p className="text-xs text-yellow-600 mt-1">⚠️ 無LINE帳號，將不會發送通知</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        );

      case 'appointmentType':
        return (
          <div className="space-y-3">
            {appointmentTypes.length === 0 ? (
              <div className="text-center py-8 text-gray-500">目前沒有可用的預約類型</div>
            ) : (
              appointmentTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => setSelectedAppointmentTypeId(type.id)}
                  className="w-full bg-white border border-gray-200 rounded-lg p-4 hover:border-primary-300 hover:shadow-md transition-all duration-200 text-left"
                >
                    <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-gray-900">
                        {type.name} {type.duration_minutes}分鐘
                      </h3>
                    </div>
                    <div className="text-primary-600">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        );

      case 'practitioner':
        return (
          <div className="space-y-3">
            {practitioners.length === 0 ? (
              <div className="text-center py-8 text-gray-500">目前沒有可用的治療師</div>
            ) : (
              practitioners.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPractitionerId(p.id)}
                  className="w-full bg-white border border-gray-200 rounded-lg p-4 hover:border-primary-300 hover:shadow-md transition-all duration-200 text-left"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-gray-900">{p.full_name}</h3>
                    <div className="text-primary-600">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        );

      case 'datetime':
        return (
          <DateTimePicker
            selectedDate={selectedDate}
            selectedTime={selectedTime}
            selectedPractitionerId={selectedPractitionerId}
            appointmentTypeId={selectedAppointmentTypeId}
            onDateSelect={handleDateSelect}
            onTimeSelect={handleTimeSelect}
            error={error}
          />
        );

      case 'confirm':
        return (
          <div className="space-y-4">
            <div className="space-y-3 bg-gray-50 rounded-md p-4 mb-4">
              <div>
                <span className="text-sm font-medium text-gray-700">病患：</span>
                <span className="text-sm text-gray-900 ml-2">{selectedPatient?.full_name}</span>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-700">預約類型：</span>
                <span className="text-sm text-gray-900 ml-2">{selectedAppointmentType?.name}</span>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-700">治療師：</span>
                <span className="text-sm text-gray-900 ml-2">{selectedPractitioner?.full_name || '未知'}</span>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-700">日期時間：</span>
                <span className="text-sm text-gray-900 ml-2">
                  {selectedDate && selectedTime && (() => {
                    const dateTime = moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei');
                    const dateStr = dateTime.format('YYYY年MM月DD日');
                    const timeFormatted = formatTo12Hour(selectedTime);
                    return `${dateStr} ${timeFormatted.display}`;
                  })()}
                </span>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  // Handle modal close with state reset
  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  return (
    <BaseModal onClose={handleClose} aria-label="建立預約">
      <div className="space-y-4 pb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{STEP_TITLES[step]}</h2>
            {preSelectedPatientId && selectedPatient && (
              <p className="text-sm text-gray-500 mt-1">病患：{selectedPatient.full_name}</p>
            )}
          </div>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600" aria-label="關閉">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {renderStepContent()}

        <div className="flex justify-between pt-4 border-t">
          <button
            onClick={handleBack}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
          >
            {currentStepIndex === 0 && preSelectedPatientId ? '取消' : '上一步'}
          </button>
          {step === 'confirm' ? (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? '建立中...' : '確認建立'}
            </button>
          ) : null}
        </div>
      </div>
    </BaseModal>
  );
});

CreateAppointmentModal.displayName = 'CreateAppointmentModal';

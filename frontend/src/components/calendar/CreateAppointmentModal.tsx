/**
 * CreateAppointmentModal Component
 * 
 * Modal for creating new appointments on behalf of patients.
 * Multi-step flow: Patient → Appointment Type → Practitioner → Date/Time → Confirm
 * Auto-advances on selection, similar to LIFF appointment flow.
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { BaseModal } from './BaseModal';
import { DateTimePicker } from './DateTimePicker';
import { apiService } from '../../services/api';
import { getErrorMessage } from '../../types/api';
import { logger } from '../../utils/logger';
import { SearchInput } from '../shared';
import { Patient } from '../../types';
import moment from 'moment-timezone';
import { formatTo12Hour } from '../../utils/calendarUtils';
import { useApiData } from '../../hooks/useApiData';
import { useAuth } from '../../hooks/useAuth';
import { useDebouncedSearch, shouldTriggerSearch } from '../../utils/searchUtils';
import { PatientCreationModal } from '../PatientCreationModal';
import { PatientCreationSuccessModal } from '../PatientCreationSuccessModal';

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
  
  // Try to get patient data from sessionStorage if preSelectedPatientId is set
  const [preSelectedPatientData, setPreSelectedPatientData] = useState<Patient | null>(() => {
    if (preSelectedPatientId) {
      try {
        const stored = sessionStorage.getItem('preSelectedPatientData');
        if (stored) {
          const data = JSON.parse(stored);
          // Only use if it matches the preSelectedPatientId
          if (data.id === preSelectedPatientId) {
            return data as Patient;
          }
        }
      } catch (err) {
        // Log warning for debugging, but don't block functionality
        logger.warn('Failed to read preSelectedPatientData from sessionStorage:', err);
      }
    }
    return null;
  });
  
  const [selectedAppointmentTypeId, setSelectedAppointmentTypeId] = useState<number | null>(null);
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(initialDate || null);
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [searchInput, setSearchInput] = useState<string>('');
  const [isComposing, setIsComposing] = useState(false);
  const isNavigatingBack = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isCreatingPatientFromModal = useRef(false);
  
  // Patient creation modal state
  const [isCreatePatientModalOpen, setIsCreatePatientModalOpen] = useState(false);
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
  const [createdPatientId, setCreatedPatientId] = useState<number | null>(null);
  const [createdPatientName, setCreatedPatientName] = useState<string>('');
  const [createdPatientPhone, setCreatedPatientPhone] = useState<string | null>(null);
  const [createdPatientBirthday, setCreatedPatientBirthday] = useState<string | null>(null);

  // Focus preservation is now handled inside SearchInput component
  // No need for additional focus logic here
  
  // Use debounced search for server-side search
  const debouncedSearchQuery = useDebouncedSearch(searchInput, 400, isComposing);
  
  // Only fetch when there's a valid search query (3+ digits, 1+ letter, or 1+ Chinese char)
  // This prevents fetching all patients on modal open, which could be slow for large clinics
  // Exception: if preSelectedPatientId is set, we need to fetch the patient even without search
  const hasValidSearch = debouncedSearchQuery.trim().length > 0 && shouldTriggerSearch(debouncedSearchQuery);
  const shouldFetchForPreSelected = !!preSelectedPatientId && !hasValidSearch;
  
  // Use useApiData for patients with caching and request deduplication
  // This shares cache with PatientsPage, reducing redundant API calls
  const { isLoading: authLoading, isAuthenticated } = useAuth();
  // Fetch patients with server-side search
  // Limit to top 100 results for modal (no pagination)
  // Only fetch when hasValidSearch is true OR when preSelectedPatientId is set
  // Pass pageSize: 100 to limit results at backend for better performance
  const fetchPatientsFn = useCallback(
    () => {
      // If we have a preSelectedPatientId but no search, fetch without search
      // This will get the first 100 patients, which should include the pre-selected one
      // (assuming it was recently created or is in the first page)
      if (shouldFetchForPreSelected) {
        return apiService.getPatients(
          1, // page 1
          100, // pageSize: limit to 100 results at backend
          undefined, // no signal
          undefined // no search - get first 100 patients
        );
      }
      return apiService.getPatients(
        1, // page 1
        100, // pageSize: limit to 100 results at backend
        undefined, // no signal
        debouncedSearchQuery // search parameter
      );
    },
    [debouncedSearchQuery, shouldFetchForPreSelected]
  );
  const shouldFetchPatients = step === 'patient' || !!preSelectedPatientId;
  
  const { 
    data: patientsData, 
    loading: isLoadingPatients,
    error: patientsError,
    refetch: refetchPatients
  } = useApiData<{
    patients: Patient[];
    total: number;
    page: number;
    page_size: number;
  }>(
    fetchPatientsFn,
    {
      enabled: !authLoading && isAuthenticated && shouldFetchPatients && (hasValidSearch || shouldFetchForPreSelected),
      dependencies: [authLoading, isAuthenticated, step, preSelectedPatientId, debouncedSearchQuery, hasValidSearch, shouldFetchForPreSelected],
      cacheTTL: 5 * 60 * 1000, // 5 minutes cache - shares with PatientsPage
      defaultErrorMessage: '無法載入病患列表',
      initialData: { patients: [], total: 0, page: 1, page_size: 1 },
    }
  );
  
  // Keep previous data visible during loading to prevent flicker
  // Clear previous data when search becomes invalid (user deletes all search text)
  const [previousPatientsData, setPreviousPatientsData] = useState<{
    patients: Patient[];
    total: number;
    page: number;
    page_size: number;
  } | null>(null);

  // Update previous data when new data arrives (not during loading)
  // Clear previous data when search is invalid (unless we're fetching for preSelectedPatientId)
  useEffect(() => {
    if (!hasValidSearch && !shouldFetchForPreSelected) {
      // Clear previous data when search is invalid (no search query and not fetching for pre-selected)
      setPreviousPatientsData(null);
    } else if (!isLoadingPatients && patientsData) {
      // Update previous data when new data arrives
      setPreviousPatientsData(patientsData);
    }
  }, [isLoadingPatients, patientsData, hasValidSearch, shouldFetchForPreSelected]);

  // Use previous data if currently loading, otherwise use current data
  // If no valid search and not fetching for pre-selected, always show empty (no previous data)
  const displayData = (hasValidSearch || shouldFetchForPreSelected) && isLoadingPatients && previousPatientsData 
    ? previousPatientsData 
    : (hasValidSearch || shouldFetchForPreSelected)
      ? patientsData 
      : null;
  const patients = displayData?.patients || [];
  const totalPatients = displayData?.total || 0;
  
  // Results are already limited to 100 at backend, no need to slice
  const displayPatients = patients;
  
  // Update error state when patients fetch fails
  useEffect(() => {
    if (patientsError) {
      setError(patientsError);
    }
  }, [patientsError]);

  // Derived values
  // Use preSelectedPatientData if available, otherwise find from patients array
  const selectedPatient = useMemo(() => {
    if (preSelectedPatientData && preSelectedPatientData.id === selectedPatientId) {
      return preSelectedPatientData;
    }
    return patients.find(p => p.id === selectedPatientId) || null;
  }, [patients, selectedPatientId, preSelectedPatientData]);
  
  // Clear sessionStorage when patient is found in the patients array
  useEffect(() => {
    if (preSelectedPatientData && selectedPatient && selectedPatient.id === preSelectedPatientData.id && patients.length > 0) {
      // Patient found in fetched data, clear sessionStorage
      try {
        sessionStorage.removeItem('preSelectedPatientData');
        setPreSelectedPatientData(null);
      } catch (err) {
        // Ignore errors
      }
    }
  }, [selectedPatient, preSelectedPatientData, patients]);
  const selectedAppointmentType = useMemo(() =>
    appointmentTypes.find(at => at.id === selectedAppointmentTypeId) || null,
    [appointmentTypes, selectedAppointmentTypeId]
  );
  const selectedPractitioner = useMemo(() =>
    practitioners.find(p => p.id === selectedPractitionerId) || null,
    [practitioners, selectedPractitionerId]
  );

  // Auto-advance on patient selection (only if not navigating back)
  useEffect(() => {
    if (isNavigatingBack.current) {
      isNavigatingBack.current = false;
      return;
    }
    // Only auto-advance if we have both selectedPatientId and selectedPatient available
    // This ensures the patient data is ready before advancing
    if (selectedPatientId && selectedPatient && step === 'patient') {
      const nextStepIndex = STEP_ORDER.indexOf(step) + 1;
      if (nextStepIndex < STEP_ORDER.length) {
        setStep(STEP_ORDER[nextStepIndex] as CreateStep);
      }
    }
  }, [selectedPatientId, selectedPatient, step]);
  
  // Handle advancing step after patient creation from within modal
  useEffect(() => {
    if (isCreatingPatientFromModal.current && selectedPatientId && selectedPatient && step === 'patient') {
      // Patient was created from within modal and is now selected
      // Advance to appointment type step
      setStep('appointmentType');
      isCreatingPatientFromModal.current = false;
    }
  }, [selectedPatientId, selectedPatient, step]);

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
    setSearchInput('');
    setStep('patient');
    setError(null);
  }, [initialDate]);

  // Reset state when preSelectedPatientId changes
  useEffect(() => {
    // Don't reset state if we're in the process of creating a patient from within the modal
    if (isCreatingPatientFromModal.current) {
      return;
    }
    
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
      setSearchInput('');
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
      setSearchInput('');
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
              ref={searchInputRef}
              value={searchInput}
              onChange={setSearchInput}
              onCompositionStart={() => { setIsComposing(true); }}
              onCompositionEnd={() => { setIsComposing(false); }}
              placeholder="搜尋病患姓名、電話或LINE..."
            />
            {!isLoadingPatients && !searchInput.trim() ? (
              <div className="space-y-4">
                <div className="text-center py-8 text-gray-500">請輸入搜尋關鍵字以尋找病患</div>
                <div className="pt-4">
                  <button
                    onClick={() => setIsCreatePatientModalOpen(true)}
                    className="w-full btn btn-primary flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    新增病患
                  </button>
                </div>
              </div>
            ) : !isLoadingPatients && displayPatients.length === 0 ? (
              <div className="text-center py-8 text-gray-500">找不到符合的病患</div>
            ) : displayPatients.length > 0 ? (
              <div className="space-y-3">
                {displayPatients.map((patient) => (
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
                  </button>
                ))}
                {totalPatients > 100 && (
                  <div className="text-center py-2 text-sm text-gray-500">
                    找到 {totalPatients} 筆結果
                  </div>
                )}
              </div>
            ) : null}
          </div>
        );

      case 'appointmentType':
        return (
          <div className="space-y-3">
            {selectedPatient && (
              <div className="bg-gray-50 rounded-md p-4 mb-4">
                <span className="text-sm font-medium text-gray-700">病患：</span>
                <span className="text-sm text-gray-900">
                  {selectedPatient.full_name}
                  {!selectedPatient.line_user_id && <span className="text-gray-500"> (無LINE帳號)</span>}
                </span>
              </div>
            )}
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

  // Handle patient creation success
  const handlePatientCreated = useCallback((
    patientId: number,
    patientName: string,
    phoneNumber: string | null,
    birthday: string | null
  ) => {
    setCreatedPatientId(patientId);
    setCreatedPatientName(patientName);
    setCreatedPatientPhone(phoneNumber);
    setCreatedPatientBirthday(birthday);
    setIsCreatePatientModalOpen(false);
    setIsSuccessModalOpen(true);
  }, []);

  // Handle success modal close - user chose to close without creating appointment
  const handleSuccessModalClose = useCallback(() => {
    setIsSuccessModalOpen(false);
    setCreatedPatientId(null);
    setCreatedPatientName('');
    setCreatedPatientPhone(null);
    setCreatedPatientBirthday(null);
    // Close appointment modal and return to calendar
    onClose();
  }, [onClose]);

  // Handle "新增預約" button in success modal - select patient and continue appointment creation
  const handleCreateAppointmentFromSuccess = useCallback(() => {
    if (createdPatientId) {
      // Set flag to prevent resetState from interfering
      isCreatingPatientFromModal.current = true;
      
      // Store patient data in sessionStorage for immediate use
      try {
        sessionStorage.setItem('preSelectedPatientData', JSON.stringify({
          id: createdPatientId,
          full_name: createdPatientName,
          phone_number: createdPatientPhone,
          birthday: createdPatientBirthday,
        }));
      } catch (err) {
        // Ignore sessionStorage errors
        logger.warn('Failed to store patient data in sessionStorage:', err);
      }
      
      // Create fallback patient data immediately (synchronously)
      // This ensures the patient is available right away
      const fallbackPatient: Patient = {
        id: createdPatientId,
        clinic_id: 0, // Will be set by backend
        full_name: createdPatientName,
        phone_number: createdPatientPhone,
        created_at: new Date().toISOString(),
      };
      if (createdPatientBirthday) {
        fallbackPatient.birthday = createdPatientBirthday;
      }
      
      // Close success modal and set patient data using flushSync to ensure immediate re-render
      // flushSync forces React to synchronously apply state updates and trigger a re-render before
      // the next event. This is necessary here because we need the patient to be immediately
      // available in the appointment modal before the success modal closes, ensuring smooth UX.
      flushSync(() => {
        setIsSuccessModalOpen(false);
        setPreSelectedPatientData(fallbackPatient);
        setSelectedPatientId(createdPatientId);
      });
      
      // Clear created patient state (can be batched, doesn't need to be immediate)
      setCreatedPatientId(null);
      setCreatedPatientName('');
      setCreatedPatientPhone(null);
      setCreatedPatientBirthday(null);
      
      // Fetch full patient data asynchronously in the background
      // This updates the patient data with complete information (e.g., line_user_id)
      // but doesn't block the UI
      (async () => {
        try {
          const response = await apiService.getPatients(1, 100);
          const fullPatientData = response.patients.find(p => p.id === createdPatientId);
          
          if (fullPatientData) {
            // Update with full patient data from the API
            setPreSelectedPatientData(fullPatientData);
          }
          
          // Refetch patients list to update the cache and ensure new patient appears
          refetchPatients();
        } catch (err) {
          // If fetch fails, we already have the fallback data, so just log the error
          logger.warn('Failed to fetch full patient data, using fallback data:', err);
        }
      })();
    }
  }, [createdPatientId, createdPatientName, createdPatientPhone, createdPatientBirthday, refetchPatients]);

  // Handle modal close with state reset
  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  return (
    <>
      <BaseModal onClose={handleClose} aria-label="建立預約">
      <div className="space-y-4 pb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{STEP_TITLES[step]}</h2>
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
    
    {/* Patient Creation Modal */}
    <PatientCreationModal
      isOpen={isCreatePatientModalOpen}
      onClose={() => setIsCreatePatientModalOpen(false)}
      onSuccess={handlePatientCreated}
    />
    
    {/* Patient Creation Success Modal */}
    {createdPatientId && (
      <PatientCreationSuccessModal
        isOpen={isSuccessModalOpen}
        onClose={handleSuccessModalClose}
        patientId={createdPatientId}
        patientName={createdPatientName}
        phoneNumber={createdPatientPhone}
        birthday={createdPatientBirthday}
        onCreateAppointment={handleCreateAppointmentFromSuccess}
      />
    )}
    </>
  );
});

CreateAppointmentModal.displayName = 'CreateAppointmentModal';

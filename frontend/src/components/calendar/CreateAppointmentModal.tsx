/**
 * CreateAppointmentModal Component
 * 
 * Modal for creating new appointments on behalf of patients.
 * Single-page form with confirmation step, similar to EditAppointmentModal.
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
import { ClinicNotesTextarea } from '../shared/ClinicNotesTextarea';

type CreateStep = 'form' | 'confirm';

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
    clinic_notes?: string;
  }) => Promise<void>;
}

export const CreateAppointmentModal: React.FC<CreateAppointmentModalProps> = React.memo(({
  preSelectedPatientId,
  initialDate,
  practitioners: initialPractitioners,
  appointmentTypes,
  onClose,
  onConfirm,
}) => {
  const [step, setStep] = useState<CreateStep>('form');
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
  const [clinicNotes, setClinicNotes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [searchInput, setSearchInput] = useState<string>('');
  const [isComposing, setIsComposing] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isCreatingPatientFromModal = useRef(false);
  
  // Patient creation modal state
  const [isCreatePatientModalOpen, setIsCreatePatientModalOpen] = useState(false);
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
  const [createdPatientId, setCreatedPatientId] = useState<number | null>(null);
  const [createdPatientName, setCreatedPatientName] = useState<string>('');
  const [createdPatientPhone, setCreatedPatientPhone] = useState<string | null>(null);
  const [createdPatientBirthday, setCreatedPatientBirthday] = useState<string | null>(null);

  // Conditional practitioner fetching
  const [availablePractitioners, setAvailablePractitioners] = useState<{ id: number; full_name: string }[]>(initialPractitioners);
  const [isLoadingPractitioners, setIsLoadingPractitioners] = useState(false);

  // Fetch practitioners when appointment type is selected
  useEffect(() => {
    const fetchPractitioners = async () => {
      if (!selectedAppointmentTypeId) {
        // No appointment type selected - use all practitioners
        setAvailablePractitioners(initialPractitioners);
        return;
      }

      setIsLoadingPractitioners(true);
      try {
        const practitioners = await apiService.getPractitioners(selectedAppointmentTypeId);
        // Sort alphabetically by name (supports Chinese)
        const sorted = [...practitioners].sort((a, b) => a.full_name.localeCompare(b.full_name, 'zh-TW'));
        setAvailablePractitioners(sorted);
        
        // Auto-deselect practitioner if current selection is not in the filtered list
        if (selectedPractitionerId && !sorted.find(p => p.id === selectedPractitionerId)) {
          setSelectedPractitionerId(null);
          setSelectedDate(null);
          setSelectedTime('');
        }
      } catch (err) {
        logger.error('Failed to fetch practitioners:', err);
        setError('無法載入治療師列表，請稍後再試');
        setAvailablePractitioners([]);
        // Clear selections
        setSelectedPractitionerId(null);
        setSelectedDate(null);
        setSelectedTime('');
      } finally {
        setIsLoadingPractitioners(false);
      }
    };

    fetchPractitioners();
  }, [selectedAppointmentTypeId, initialPractitioners, selectedPractitionerId]);

  // Auto-deselection: When appointment type changes, clear practitioner, date, time
  useEffect(() => {
    if (selectedAppointmentTypeId === null && (selectedPractitionerId !== null || selectedDate !== null || selectedTime !== '')) {
      // Appointment type was cleared - clear dependent fields
      setSelectedPractitionerId(null);
      setSelectedDate(null);
      setSelectedTime('');
    }
  }, [selectedAppointmentTypeId, selectedPractitionerId, selectedDate, selectedTime]);

  // Auto-deselection: When practitioner changes, clear date, time
  useEffect(() => {
    if (selectedPractitionerId === null && (selectedDate !== null || selectedTime !== '')) {
      // Practitioner was cleared - clear dependent fields
      setSelectedDate(null);
      setSelectedTime('');
    }
  }, [selectedPractitionerId, selectedDate, selectedTime]);

  // Use debounced search for server-side search
  const debouncedSearchQuery = useDebouncedSearch(searchInput, 400, isComposing);
  
  // Only fetch when there's a valid search query (3+ digits, 1+ letter, or 1+ Chinese char)
  // Exception: if preSelectedPatientId is set, we need to fetch the patient even without search
  const hasValidSearch = debouncedSearchQuery.trim().length > 0 && shouldTriggerSearch(debouncedSearchQuery);
  const shouldFetchForPreSelected = !!preSelectedPatientId && !hasValidSearch;
  
  // Use useApiData for patients with caching and request deduplication
  const { isLoading: authLoading, isAuthenticated } = useAuth();
  const fetchPatientsFn = useCallback(
    () => {
      if (shouldFetchForPreSelected) {
        return apiService.getPatients(1, 100, undefined, undefined);
      }
      return apiService.getPatients(1, 100, undefined, debouncedSearchQuery);
    },
    [debouncedSearchQuery, shouldFetchForPreSelected]
  );
  
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
      enabled: !authLoading && isAuthenticated && (hasValidSearch || shouldFetchForPreSelected),
      dependencies: [authLoading, isAuthenticated, preSelectedPatientId, debouncedSearchQuery, hasValidSearch, shouldFetchForPreSelected],
      cacheTTL: 5 * 60 * 1000,
      defaultErrorMessage: '無法載入病患列表',
      initialData: { patients: [], total: 0, page: 1, page_size: 1 },
    }
  );
  
  // Keep previous data visible during loading to prevent flicker
  const [previousPatientsData, setPreviousPatientsData] = useState<{
    patients: Patient[];
    total: number;
    page: number;
    page_size: number;
  } | null>(null);

  useEffect(() => {
    if (!hasValidSearch && !shouldFetchForPreSelected) {
      setPreviousPatientsData(null);
    } else if (!isLoadingPatients && patientsData) {
      setPreviousPatientsData(patientsData);
    }
  }, [isLoadingPatients, patientsData, hasValidSearch, shouldFetchForPreSelected]);

  const displayData = (hasValidSearch || shouldFetchForPreSelected) && isLoadingPatients && previousPatientsData 
    ? previousPatientsData 
    : (hasValidSearch || shouldFetchForPreSelected)
      ? patientsData 
      : null;
  const patients = displayData?.patients || [];
  const totalPatients = displayData?.total || 0;
  const displayPatients = patients;
  
  // Update error state when patients fetch fails
  useEffect(() => {
    if (patientsError) {
      setError(patientsError);
    }
  }, [patientsError]);

  // Derived values
  const selectedPatient = useMemo(() => {
    if (preSelectedPatientData && preSelectedPatientData.id === selectedPatientId) {
      return preSelectedPatientData;
    }
    return patients.find(p => p.id === selectedPatientId) || null;
  }, [patients, selectedPatientId, preSelectedPatientData]);
  
  // Pre-fill search input when preSelectedPatientId is provided and patient is loaded
  useEffect(() => {
    if (preSelectedPatientId && selectedPatient && !searchInput) {
      setSearchInput(selectedPatient.full_name);
    }
  }, [preSelectedPatientId, selectedPatient, searchInput]);

  // Clear patient selection when search input is cleared
  useEffect(() => {
    if (selectedPatientId && !searchInput.trim()) {
      setSelectedPatientId(null);
    }
  }, [searchInput, selectedPatientId]);
  
  // Clear sessionStorage when patient is found in the patients array
  useEffect(() => {
    if (preSelectedPatientData && selectedPatient && selectedPatient.id === preSelectedPatientData.id && patients.length > 0) {
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

  // Sort appointment types alphabetically
  const sortedAppointmentTypes = useMemo(() => {
    return [...appointmentTypes].sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'));
  }, [appointmentTypes]);

  // Reset all state function
  const resetState = useCallback(() => {
    setSelectedPatientId(null);
    setSelectedAppointmentTypeId(null);
    setSelectedPractitionerId(null);
    setSelectedDate(initialDate || null);
    setSelectedTime('');
    setClinicNotes('');
    setSearchInput('');
    setStep('form');
    setError(null);
  }, [initialDate]);

  // Reset state when preSelectedPatientId changes
  useEffect(() => {
    if (isCreatingPatientFromModal.current) {
      return;
    }
    
    if (preSelectedPatientId === undefined) {
      resetState();
    } else {
      setSelectedPatientId(preSelectedPatientId);
      setSelectedAppointmentTypeId(null);
      setSelectedPractitionerId(null);
      setSelectedDate(initialDate || null);
      setSelectedTime('');
      setClinicNotes('');
      setSearchInput('');
      setStep('form');
      setError(null);
    }
  }, [preSelectedPatientId, resetState, initialDate]);

  const handleFormSubmit = () => {
    // Validate required fields
    if (!selectedPatientId) {
      setError('請選擇病患');
      return;
    }
    if (!selectedAppointmentTypeId) {
      setError('請選擇預約類型');
      return;
    }
    if (!selectedPractitionerId) {
      setError('請選擇治療師');
      return;
    }
    if (!selectedDate || !selectedTime) {
      setError('請選擇日期與時間');
      return;
    }

    setError(null);
    setStep('confirm');
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
      const formData: {
        patient_id: number;
        appointment_type_id: number;
        practitioner_id: number;
        start_time: string;
        clinic_notes?: string;
      } = {
        patient_id: selectedPatientId,
        appointment_type_id: selectedAppointmentTypeId,
        practitioner_id: selectedPractitionerId,
        start_time: startTime,
      };
      if (clinicNotes.trim()) {
        formData.clinic_notes = clinicNotes.trim();
      }
      await onConfirm(formData);
      // Reset state after successful creation
      resetState();
    } catch (err) {
      logger.error('Error creating appointment:', err);
      setError(getErrorMessage(err));
      setStep('form');
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

  // Handle appointment type change - clear dependent fields
  const handleAppointmentTypeChange = (appointmentTypeId: number | null) => {
    setSelectedAppointmentTypeId(appointmentTypeId);
    // Auto-deselection handled by useEffect
  };

  // Handle practitioner change - clear dependent fields
  const handlePractitionerChange = (practitionerId: number | null) => {
    setSelectedPractitionerId(practitionerId);
    // Auto-deselection handled by useEffect
  };

  // Render form step
  const renderFormStep = () => (
    <>
      <div className="space-y-4 mb-6">
        {/* Patient search and selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            病患 <span className="text-red-500">*</span>
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <SearchInput
                ref={searchInputRef}
                value={searchInput}
                onChange={setSearchInput}
                onCompositionStart={() => { setIsComposing(true); }}
                onCompositionEnd={() => { setIsComposing(false); }}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                placeholder="搜尋病患姓名、電話或LINE..."
              />
            </div>
            {!isSearchFocused && (
              <button
                onClick={() => setIsCreatePatientModalOpen(true)}
                className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                aria-label="新增病患"
                title="新增病患"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            )}
          </div>
          {!selectedPatientId && (
            <>
              {!isLoadingPatients && displayPatients.length === 0 && searchInput.trim() ? (
                <div className="mt-3 text-center py-4 text-gray-500 text-sm">找不到符合的病患</div>
              ) : displayPatients.length > 0 ? (
                <div className="mt-3 space-y-2 max-h-48 overflow-y-auto pb-3 border-b border-gray-200">
                  {displayPatients.map((patient) => (
                    <button
                      key={patient.id}
                      onClick={() => {
                        setSelectedPatientId(patient.id);
                        setSearchInput(patient.full_name);
                      }}
                      className="w-full bg-white border border-gray-200 rounded-lg p-3 hover:border-primary-300 hover:shadow-md transition-all duration-200 text-left"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900 whitespace-nowrap">{patient.full_name}</span>
                        <span className="text-sm text-gray-500 whitespace-nowrap">{patient.phone_number}</span>
                        {patient.line_user_display_name && (
                          <span className="text-sm text-gray-500 whitespace-nowrap">・{patient.line_user_display_name}</span>
                        )}
                      </div>
                    </button>
                  ))}
                  {totalPatients > 100 && (
                    <div className="text-center py-2 text-sm text-gray-500">
                      找到 {totalPatients} 筆結果
                    </div>
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* Appointment type selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            預約類型 <span className="text-red-500">*</span>
          </label>
          <select
            value={selectedAppointmentTypeId || ''}
            onChange={(e) => handleAppointmentTypeChange(e.target.value ? parseInt(e.target.value) : null)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
            >
              <option value="">選擇預約類型</option>
              {sortedAppointmentTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name} ({type.duration_minutes}分鐘)
                </option>
              ))}
            </select>
          </div>

        {/* Practitioner selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            治療師 <span className="text-red-500">*</span>
          </label>
          <select
            value={selectedPractitionerId || ''}
            onChange={(e) => handlePractitionerChange(e.target.value ? parseInt(e.target.value) : null)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            required
            disabled={!selectedAppointmentTypeId || isLoadingPractitioners}
          >
            <option value="">選擇治療師</option>
            {isLoadingPractitioners ? (
              <option value="" disabled>載入中...</option>
            ) : (
              availablePractitioners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))
            )}
          </select>
          {selectedAppointmentTypeId && !isLoadingPractitioners && availablePractitioners.length === 0 && (
            <p className="text-sm text-gray-500 mt-1">此預約類型目前沒有可用的治療師</p>
          )}
        </div>

        {/* Date/Time Picker */}
        {selectedAppointmentTypeId && selectedPractitionerId && (
          <DateTimePicker
            selectedDate={selectedDate}
            selectedTime={selectedTime}
            selectedPractitionerId={selectedPractitionerId}
            appointmentTypeId={selectedAppointmentTypeId}
            onDateSelect={handleDateSelect}
            onTimeSelect={handleTimeSelect}
            error={error}
            />
          )}

          {/* Clinic Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            診所備注
          </label>
          <ClinicNotesTextarea
            value={clinicNotes}
            onChange={(e) => setClinicNotes(e.target.value)}
            rows={4}
          />
        </div>
      </div>

      <div className="flex justify-end space-x-2 mt-6 pt-4 border-t border-gray-200 flex-shrink-0">
        <button
          onClick={handleFormSubmit}
          disabled={
            !selectedPatientId ||
            !selectedAppointmentTypeId ||
            !selectedPractitionerId ||
            !selectedDate ||
            !selectedTime
          }
          className={`btn-primary ${
            (!selectedPatientId ||
              !selectedAppointmentTypeId ||
              !selectedPractitionerId ||
              !selectedDate ||
              !selectedTime)
              ? 'opacity-50 cursor-not-allowed'
              : ''
          }`}
        >
          下一步
        </button>
      </div>
    </>
  );

  // Render confirmation step
  const renderConfirmStep = () => {
    const dateTime = selectedDate && selectedTime 
      ? moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei')
      : null;
    const dateStr = dateTime ? dateTime.format('YYYY-MM-DD') : '';
    const timeStr = selectedTime ? formatTo12Hour(selectedTime).display : '';

    return (
      <>
        <div className="space-y-4 mb-6">
          <div className="space-y-2">
            <div>
              <span className="text-sm text-gray-600">病患：</span>
              <span className="text-sm text-gray-900 ml-2">
                {selectedPatient?.full_name}
                {selectedPatient && !selectedPatient.line_user_id && <span className="text-gray-500 ml-1">(無LINE帳號)</span>}
              </span>
            </div>
            <div>
              <span className="text-sm text-gray-600">預約類型：</span>
              <span className="text-sm text-gray-900 ml-2">{selectedAppointmentType?.name}</span>
            </div>
            <div>
              <span className="text-sm text-gray-600">治療師：</span>
              <span className="text-sm text-gray-900 ml-2">
                {availablePractitioners.find(p => p.id === selectedPractitionerId)?.full_name || '未知'}
              </span>
            </div>
            <div>
              <span className="text-sm text-gray-600">日期：</span>
              <span className="text-sm text-gray-900 ml-2">{dateStr}</span>
            </div>
            <div>
              <span className="text-sm text-gray-600">時間：</span>
              <span className="text-sm text-gray-900 ml-2">{timeStr}</span>
            </div>
            {clinicNotes.trim() && (
              <div>
                <span className="text-sm text-gray-600">診所備注：</span>
                <span className="text-sm text-gray-900 ml-2 whitespace-pre-wrap">{clinicNotes.trim()}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end space-x-2 mt-6 pt-4 border-t border-gray-200 flex-shrink-0">
          <button
            onClick={() => {
              setStep('form');
              setError(null);
            }}
            className="btn-secondary"
          >
            返回修改
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="btn-primary"
          >
            {isSaving ? '建立中...' : '確認建立'}
          </button>
        </div>
      </>
    );
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
    onClose();
  }, [onClose]);

  // Handle "新增預約" button in success modal - select patient and continue appointment creation
  const handleCreateAppointmentFromSuccess = useCallback(() => {
    if (createdPatientId) {
      isCreatingPatientFromModal.current = true;
      
      try {
        sessionStorage.setItem('preSelectedPatientData', JSON.stringify({
          id: createdPatientId,
          full_name: createdPatientName,
          phone_number: createdPatientPhone,
          birthday: createdPatientBirthday,
        }));
      } catch (err) {
        logger.warn('Failed to store patient data in sessionStorage:', err);
      }
      
      const fallbackPatient: Patient = {
        id: createdPatientId,
        clinic_id: 0,
        full_name: createdPatientName,
        phone_number: createdPatientPhone,
        created_at: new Date().toISOString(),
      };
      if (createdPatientBirthday) {
        fallbackPatient.birthday = createdPatientBirthday;
      }
      
      flushSync(() => {
        setIsSuccessModalOpen(false);
        setPreSelectedPatientData(fallbackPatient);
        setSelectedPatientId(createdPatientId);
        setSearchInput(createdPatientName);
      });
      
      setCreatedPatientId(null);
      setCreatedPatientName('');
      setCreatedPatientPhone(null);
      setCreatedPatientBirthday(null);
      
      (async () => {
        try {
          const response = await apiService.getPatients(1, 100);
          const fullPatientData = response.patients.find(p => p.id === createdPatientId);
          
          if (fullPatientData) {
            setPreSelectedPatientData(fullPatientData);
          }
          
          refetchPatients();
        } catch (err) {
          logger.warn('Failed to fetch full patient data, using fallback data:', err);
        }
      })();
    }
  }, [createdPatientId, createdPatientName, createdPatientPhone, createdPatientBirthday, refetchPatients]);

  // Handle modal close with state reset
  const handleClose = useCallback(() => {
    if (step === 'confirm') {
      // Return to form instead of closing
      setStep('form');
      setError(null);
    } else {
      resetState();
      onClose();
    }
  }, [resetState, onClose, step]);

  const modalTitle = step === 'form' ? '建立預約' : '確認預約';

  return (
    <>
      <BaseModal onClose={handleClose} aria-label={modalTitle} className="!p-0">
        <div className="sticky top-0 bg-white z-10 px-6 py-3 flex items-center justify-between flex-shrink-0 border-b border-gray-200 rounded-t-lg">
          <div className="flex items-center">
            <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mr-2">
              <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                <path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-blue-800">{modalTitle}</h3>
          </div>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
            aria-label="關閉"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 pt-4 pb-6">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {step === 'form' && renderFormStep()}
          {step === 'confirm' && renderConfirmStep()}
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


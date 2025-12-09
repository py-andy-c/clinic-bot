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
import { formatTo12Hour, getWeekdayNames } from '../../utils/calendarUtils';
import { useApiData } from '../../hooks/useApiData';
import { useAuth } from '../../hooks/useAuth';
import { useDebouncedSearch, shouldTriggerSearch } from '../../utils/searchUtils';
import { PatientCreationModal } from '../PatientCreationModal';
import { PatientCreationSuccessModal } from '../PatientCreationSuccessModal';
import { ClinicNotesTextarea } from '../shared/ClinicNotesTextarea';

// Wrapper component for DateTimePicker in conflict resolution
const RecurrenceDateTimePickerWrapper: React.FC<{
  initialDate: string | null;
  initialTime: string;
  selectedPractitionerId: number;
  appointmentTypeId: number;
  onConfirm: (date: string, time: string) => void | Promise<void>;
  onCancel: () => void;
}> = ({ initialDate, initialTime, selectedPractitionerId, appointmentTypeId, onConfirm, onCancel }) => {
  const [selectedDate, setSelectedDate] = useState<string | null>(initialDate);
  const [selectedTime, setSelectedTime] = useState<string>(initialTime);
  
  const handleDateSelect = (date: string) => {
    setSelectedDate(date);
    setSelectedTime(''); // Clear time when date changes
  };
  
  const handleTimeSelect = (time: string) => {
    setSelectedTime(time);
  };
  
  const handleConfirm = async () => {
    if (selectedDate && selectedTime) {
      await onConfirm(selectedDate, selectedTime);
    }
  };
  
  return (
    <div className="space-y-4">
      <DateTimePicker
        selectedDate={selectedDate}
        selectedTime={selectedTime}
        selectedPractitionerId={selectedPractitionerId}
        appointmentTypeId={appointmentTypeId}
        onDateSelect={handleDateSelect}
        onTimeSelect={handleTimeSelect}
      />
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="btn-secondary text-sm py-1 px-3"
        >
          取消
        </button>
        <button
          onClick={handleConfirm}
          disabled={!selectedDate || !selectedTime}
          className={`btn-primary text-sm py-1 px-3 ${!selectedDate || !selectedTime ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          確認
        </button>
      </div>
    </div>
  );
};

type CreateStep = 'form' | 'conflict-resolution' | 'confirm';

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
  
  // Recurrence state
  const [recurrenceEnabled, setRecurrenceEnabled] = useState<boolean>(false);
  const [weeksInterval, setWeeksInterval] = useState<number>(1);
  const [occurrenceCount, setOccurrenceCount] = useState<number | null>(null);
  const [occurrences, setOccurrences] = useState<Array<{
    id: string;
    date: string;
    time: string;
    hasConflict: boolean;
  }>>([]);
  const [isCheckingConflicts, setIsCheckingConflicts] = useState<boolean>(false);
  const [editingOccurrenceId, setEditingOccurrenceId] = useState<string | null>(null);
  const [addingOccurrence, setAddingOccurrence] = useState<boolean>(false);
  const [hasVisitedConflictResolution, setHasVisitedConflictResolution] = useState<boolean>(false);
  
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
    // Reset recurrence state
    setRecurrenceEnabled(false);
    setWeeksInterval(1);
    setOccurrenceCount(null);
    setOccurrences([]);
    setEditingOccurrenceId(null);
    setAddingOccurrence(false);
    setHasVisitedConflictResolution(false);
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

  const handleFormSubmit = async () => {
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

    // If recurrence is enabled, validate and check conflicts
    if (recurrenceEnabled) {
      if (!occurrenceCount || occurrenceCount < 1) {
        setError('請輸入預約次數');
        return;
      }
      if (occurrenceCount > 50) {
        setError('最多只能建立50個預約');
        return;
      }
      
      // Generate occurrences from pattern
      const baseDateTime = moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei');
      const generatedOccurrences: Array<{ id: string; date: string; time: string; hasConflict: boolean }> = [];
      
      for (let i = 0; i < occurrenceCount; i++) {
        const occurrenceDate = baseDateTime.clone().add(i * weeksInterval, 'weeks');
        // Filter out past dates
        if (occurrenceDate.isAfter(moment())) {
          generatedOccurrences.push({
            id: `gen-${i}`,
            date: occurrenceDate.format('YYYY-MM-DD'),
            time: occurrenceDate.format('HH:mm'),
            hasConflict: false,
          });
        }
      }
      
      if (generatedOccurrences.length === 0) {
        setError('所有日期都無效，請調整日期或模式');
        return;
      }
      
      // Always check conflicts (no state preservation)
      setIsCheckingConflicts(true);
      setError(null);
      
      try {
        const occurrenceStrings = generatedOccurrences.map(occ => 
          moment.tz(`${occ.date}T${occ.time}`, 'Asia/Taipei').toISOString()
        );
        
        const conflictResult = await apiService.checkRecurringConflicts({
          practitioner_id: selectedPractitionerId!,
          appointment_type_id: selectedAppointmentTypeId!,
          occurrences: occurrenceStrings,
        });
        
        // Update occurrences with conflict status
        const updatedOccurrences = generatedOccurrences.map((occ, idx) => {
          const conflictStatus = conflictResult.occurrences[idx];
          return {
            ...occ,
            hasConflict: conflictStatus?.has_conflict || false,
          };
        });
        
        setOccurrences(updatedOccurrences);
        
        // Check if there are any conflicts
        const hasConflicts = updatedOccurrences.some(occ => occ.hasConflict);
        
        if (hasConflicts) {
          setHasVisitedConflictResolution(true);
          setStep('conflict-resolution');
        } else {
          setHasVisitedConflictResolution(false);
          setStep('confirm');
        }
      } catch (err) {
        logger.error('Error checking conflicts:', err);
        setError(getErrorMessage(err) || '無法檢查衝突，請稍後再試');
      } finally {
        setIsCheckingConflicts(false);
      }
    } else {
      // Single appointment - go directly to confirmation
      setError(null);
      setStep('confirm');
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
      if (recurrenceEnabled && occurrences.length > 0) {
        // Create recurring appointments
        const occurrenceStrings = occurrences.map(occ => 
          moment.tz(`${occ.date}T${occ.time}`, 'Asia/Taipei').toISOString()
        );
        
        const result = await apiService.createRecurringAppointments({
          patient_id: selectedPatientId,
          appointment_type_id: selectedAppointmentTypeId,
          practitioner_id: selectedPractitionerId,
          ...(clinicNotes.trim() ? { clinic_notes: clinicNotes.trim() } : {}),
          occurrences: occurrenceStrings.map(start_time => ({ start_time })),
        });
        
        if (result.failed_count > 0) {
          const errorMessages = result.failed_occurrences.map(f => `${f.start_time}: ${f.error_message}`).join('\n');
          setError(`已建立 ${result.created_count} 個預約，${result.failed_count} 個失敗：\n${errorMessages}`);
          setStep('conflict-resolution');
        } else {
          // Success - close modal without showing alert
          // The success is indicated by closing the modal
          resetState();
          onClose();
        }
      } else {
        // Single appointment
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
      }
    } catch (err) {
      logger.error('Error creating appointment:', err);
      setError(getErrorMessage(err));
      setStep(recurrenceEnabled ? 'conflict-resolution' : 'form');
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

          {/* Recurrence Toggle */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={recurrenceEnabled}
                onChange={(e) => {
                  setRecurrenceEnabled(e.target.checked);
                  if (!e.target.checked) {
                    // Reset recurrence state when disabled (but preserve occurrenceCount)
                    setOccurrences([]);
                    setWeeksInterval(1);
                    setHasVisitedConflictResolution(false);
                  }
                }}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">重複</span>
            </label>
          </div>

          {/* Recurrence Pattern Inputs */}
          {recurrenceEnabled && (
            <div className="space-y-3 pl-6 border-l-2 border-blue-200">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
                  每
                </label>
                <input
                  type="number"
                  min="1"
                  value={weeksInterval}
                  onChange={(e) => {
                    const value = parseInt(e.target.value) || 1;
                    setWeeksInterval(Math.max(1, value));
                  }}
                  onWheel={(e) => {
                    if (document.activeElement === e.currentTarget) {
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-16 border border-gray-300 rounded-md px-2 py-1 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
                  週,
                </label>
                <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
                  共
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={occurrenceCount || ''}
                  onChange={(e) => {
                    const value = e.target.value ? parseInt(e.target.value) : null;
                    if (value !== null) {
                      setOccurrenceCount(Math.max(1, Math.min(50, value)));
                    } else {
                      setOccurrenceCount(null);
                    }
                  }}
                  onWheel={(e) => {
                    if (document.activeElement === e.currentTarget) {
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-16 border border-gray-300 rounded-md px-2 py-1 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="次數"
                />
                <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
                  次
                </label>
              </div>
            </div>
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
            !selectedTime ||
            isCheckingConflicts ||
            (recurrenceEnabled && (!occurrenceCount || occurrenceCount < 1))
          }
          className={`btn-primary ${
            (!selectedPatientId ||
              !selectedAppointmentTypeId ||
              !selectedPractitionerId ||
              !selectedDate ||
              !selectedTime ||
              isCheckingConflicts ||
              (recurrenceEnabled && (!occurrenceCount || occurrenceCount < 1)))
              ? 'opacity-50 cursor-not-allowed'
              : ''
          }`}
        >
          {isCheckingConflicts ? '正在檢查衝突...' : '下一步'}
        </button>
      </div>
    </>
  );

  // Render conflict resolution step
  const renderConflictResolutionStep = () => {
    const hasConflicts = occurrences.some(occ => occ.hasConflict);
    const canProceed = occurrences.length > 0 && !hasConflicts;
    
    return (
      <>
        <div className="space-y-4 mb-6">
          {hasConflicts && (
            <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
              <p className="text-sm text-blue-800">
                請刪除或重新安排所有衝突的時段後才能繼續
              </p>
            </div>
          )}
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">#</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">日期</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">時間</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">狀態</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {occurrences.map((occ, idx) => (
                  <tr key={occ.id} className={occ.hasConflict ? 'bg-red-50' : ''}>
                    <td className="px-3 py-2 text-sm text-gray-900">{idx + 1}</td>
                    <td className="px-3 py-2 text-sm text-gray-900">
                      {(() => {
                        const dateMoment = moment.tz(`${occ.date}T${occ.time}`, 'Asia/Taipei');
                        const weekdayNames = getWeekdayNames();
                        const weekday = weekdayNames[dateMoment.day()];
                        return `${dateMoment.format('YYYY/MM/DD')} (${weekday})`;
                      })()}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-900">{formatTo12Hour(occ.time).display}</td>
                    <td className="px-3 py-2 text-sm">
                      {occ.hasConflict ? (
                        <span className="text-red-600">✗ 衝突</span>
                      ) : (
                        <span className="text-green-600">✓ 可用</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            const updated = occurrences.filter(o => o.id !== occ.id);
                            setOccurrences(updated);
                          }}
                          className="text-red-600 hover:text-red-800 text-sm"
                        >
                          刪除
                        </button>
                        <button
                          onClick={() => {
                            setEditingOccurrenceId(occ.id);
                          }}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          修改
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={5} className="px-3 py-2">
                    <button
                      onClick={() => {
                        setAddingOccurrence(true);
                      }}
                      className="flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      新增
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          
          {occurrences.length === 0 && (
            <div className="text-center py-4 text-red-600 text-sm">
              至少需要一個預約時段
            </div>
          )}
          
          {/* DateTimePicker for rescheduling or adding occurrence */}
          {(editingOccurrenceId || addingOccurrence) && selectedAppointmentTypeId && selectedPractitionerId && (
            <div className="mt-4 border-t border-gray-200 pt-4">
              <div className="mb-2 text-sm font-medium text-gray-700">
                {addingOccurrence ? '新增預約時段' : '重新選擇時間'}
              </div>
              <RecurrenceDateTimePickerWrapper
                initialDate={editingOccurrenceId 
                  ? occurrences.find(o => o.id === editingOccurrenceId)?.date || null
                  : null}
                initialTime={editingOccurrenceId
                  ? occurrences.find(o => o.id === editingOccurrenceId)?.time || ''
                  : ''}
                selectedPractitionerId={selectedPractitionerId}
                appointmentTypeId={selectedAppointmentTypeId}
                onConfirm={async (date: string, time: string) => {
                  if (editingOccurrenceId) {
                    // Update existing occurrence
                    const updated = occurrences.map(o => 
                      o.id === editingOccurrenceId
                        ? { ...o, date, time, hasConflict: false }
                        : o
                    );
                    // Check for duplicates (excluding current)
                    const isDuplicate = updated.some(o => 
                      o.id !== editingOccurrenceId && o.date === date && o.time === time
                    );
                    if (isDuplicate) {
                      setError('此時間已在列表中，請選擇其他時間');
                    } else {
                      setOccurrences(updated);
                      setEditingOccurrenceId(null);
                      setError(null);
                    }
                  } else if (addingOccurrence) {
                    // Add new occurrence - check for conflicts first
                    const isDuplicate = occurrences.some(o => o.date === date && o.time === time);
                    if (isDuplicate) {
                      setError('此時間已在列表中，請選擇其他時間');
                    } else {
                      // Check for conflicts with existing appointments/availability
                      const occurrenceString = moment.tz(`${date}T${time}`, 'Asia/Taipei').toISOString();
                      try {
                        const conflictResult = await apiService.checkRecurringConflicts({
                          practitioner_id: selectedPractitionerId!,
                          appointment_type_id: selectedAppointmentTypeId!,
                          occurrences: [occurrenceString],
                        });
                        
                        const conflictStatus = conflictResult.occurrences[0];
                        const hasConflict = conflictStatus?.has_conflict || false;
                        
                        if (hasConflict) {
                          setError('此時間段已有衝突，請選擇其他時間');
                        } else {
                          const newOcc = {
                            id: `new-${Date.now()}`,
                            date,
                            time,
                            hasConflict: false,
                          };
                          setOccurrences([...occurrences, newOcc]);
                          setAddingOccurrence(false);
                          setError(null);
                        }
                      } catch (err) {
                        logger.error('Error checking conflict for new occurrence:', err);
                        setError('無法檢查衝突，請稍後再試');
                      }
                    }
                  }
                }}
                onCancel={() => {
                  setEditingOccurrenceId(null);
                  setAddingOccurrence(false);
                }}
              />
            </div>
          )}
        </div>
        
        <div className="flex justify-end space-x-2 mt-6 pt-4 border-t border-gray-200">
          <button
            onClick={() => {
              // Clear conflict resolution state when going back
              setOccurrences([]);
              setHasVisitedConflictResolution(false);
              setStep('form');
              setError(null);
            }}
            className="btn-secondary"
          >
            返回
          </button>
          <button
            onClick={() => {
              if (canProceed) {
                setHasVisitedConflictResolution(true);
                setStep('confirm');
              }
            }}
            disabled={!canProceed}
            className={`btn-primary ${!canProceed ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            下一步
          </button>
        </div>
      </>
    );
  };

  // Render confirmation step
  const renderConfirmStep = () => {
    const dateTime = selectedDate && selectedTime 
      ? moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei')
      : null;
    const weekdayNames = getWeekdayNames();
    const dateStr = dateTime 
      ? `${dateTime.format('YYYY/MM/DD')} (${weekdayNames[dateTime.day()]})`
      : '';
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
            {recurrenceEnabled && occurrences.length > 0 ? (
              <>
                <div>
                  <span className="text-sm text-gray-600">重複模式：</span>
                  <span className="text-sm text-gray-900 ml-2">
                    {hasVisitedConflictResolution
                      ? `自定義, 共 ${occurrences.length} 次`
                      : `每 ${weeksInterval} 週, 共 ${occurrenceCount} 次`}
                  </span>
                </div>
                <div>
                  <span className="text-sm text-gray-600">將建立：</span>
                  <span className="text-sm text-gray-900 ml-2">{occurrences.length} 個預約</span>
                </div>
                <div className="mt-3 max-h-48 overflow-y-auto border border-gray-200 rounded-md p-3">
                  <div className="space-y-1">
                    {occurrences.slice(0, 10).map((occ, idx) => {
                      const dateMoment = moment.tz(`${occ.date}T${occ.time}`, 'Asia/Taipei');
                      const weekdayNames = getWeekdayNames();
                      const weekday = weekdayNames[dateMoment.day()];
                      const dateStr = dateMoment.format('YYYY/MM/DD');
                      const timeStr = formatTo12Hour(occ.time).display;
                      return (
                        <div key={occ.id} className="text-sm text-gray-700">
                          {idx + 1}. {dateStr} ({weekday}) {timeStr}
                        </div>
                      );
                    })}
                    {occurrences.length > 10 && (
                      <div className="text-sm text-gray-500">... 還有 {occurrences.length - 10} 個</div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span className="text-sm text-gray-600">日期：</span>
                  <span className="text-sm text-gray-900 ml-2">{dateStr}</span>
                </div>
                <div>
                  <span className="text-sm text-gray-600">時間：</span>
                  <span className="text-sm text-gray-900 ml-2">{timeStr}</span>
                </div>
              </>
            )}
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
              // If conflict resolution was visited, go back there; otherwise go to form
              if (hasVisitedConflictResolution) {
                setStep('conflict-resolution');
              } else {
                setStep('form');
              }
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
    resetState();
    onClose();
  }, [resetState, onClose]);

  const modalTitle = step === 'form' ? '建立預約' : step === 'conflict-resolution' ? '解決衝突' : '確認預約';

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
          {step === 'conflict-resolution' && renderConflictResolutionStep()}
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


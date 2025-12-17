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
import { formatAppointmentDateTime } from '../../utils/calendarUtils';
import { useApiData } from '../../hooks/useApiData';
import { useAuth } from '../../hooks/useAuth';
import { useDebouncedSearch, shouldTriggerSearch } from '../../utils/searchUtils';
import { PatientCreationModal } from '../PatientCreationModal';
import { PatientCreationSuccessModal } from '../PatientCreationSuccessModal';
import { ClinicNotesTextarea } from '../shared/ClinicNotesTextarea';
import { preventScrollWheelChange } from '../../utils/inputUtils';
import { NumberInput } from '../shared/NumberInput';
import { ConflictIndicator } from '../shared';
import { SchedulingConflictResponse } from '../../types';
import { useIsMobile } from '../../hooks/useIsMobile';

/**
 * Helper function to convert recurring conflict status to SchedulingConflictResponse format
 */
const convertConflictStatusToResponse = (
  conflictStatus: any
): SchedulingConflictResponse | null => {
  if (!conflictStatus) {
    return null;
  }

  return {
    has_conflict: conflictStatus.has_conflict || false,
    conflict_type: conflictStatus.conflict_type || null,
    appointment_conflict: conflictStatus.appointment_conflict || null,
    exception_conflict: conflictStatus.exception_conflict || null,
    default_availability: conflictStatus.default_availability || {
      is_within_hours: true,
      normal_hours: null,
    },
  };
};

// Wrapper component for DateTimePicker in conflict resolution
const RecurrenceDateTimePickerWrapper: React.FC<{
  initialDate: string | null;
  initialTime: string;
  selectedPractitionerId: number;
  appointmentTypeId: number;
  onConfirm: (date: string, time: string) => void | Promise<void>;
  onCancel: () => void;
}> = ({ initialDate, initialTime: _initialTime, selectedPractitionerId, appointmentTypeId, onConfirm, onCancel }) => {
  const [selectedDate, setSelectedDate] = useState<string | null>(initialDate);
  // When editing (initialTime has value), start with empty selectedTime to prevent auto-initialization
  // Note: initialTime is intentionally not used to prevent auto-initialization issues
  const [selectedTime, setSelectedTime] = useState<string>('');
  
  const handleDateSelect = (date: string | null) => {
    setSelectedDate(date);
    setSelectedTime(''); // Clear time when date changes
  };
  
  const handleTimeSelect = (time: string) => {
    setSelectedTime(time);
  };
  
  const handleConfirm = async (e: React.MouseEvent) => {
    // Stop propagation to prevent DateTimePicker's click outside handler from collapsing
    e.stopPropagation();
    
    // selectedDate and selectedTime are always up to date (updated immediately on selection)
    if (selectedDate && selectedTime) {
      await onConfirm(selectedDate, selectedTime);
    }
  };
  
  const handleCancel = (e: React.MouseEvent) => {
    // Stop propagation to prevent DateTimePicker's click outside handler from collapsing
    e.stopPropagation();
    onCancel();
  };
  
  // Stop mousedown propagation to prevent DateTimePicker's click outside handler from collapsing
  // This allows the confirm/cancel buttons to work without collapsing the picker.
  // Note: This only stops mousedown events, not click events, so DateTimePicker's internal
  // onClick handlers (for date/time selection) continue to work normally.
  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
  };
  
  return (
    <div className="space-y-4" onMouseDown={handleMouseDown}>
      <DateTimePicker
        selectedDate={selectedDate}
        selectedTime={selectedTime}
        selectedPractitionerId={selectedPractitionerId}
        appointmentTypeId={appointmentTypeId}
        onDateSelect={handleDateSelect}
        onTimeSelect={handleTimeSelect}
        allowOverride={true}
        isOverrideMode={false}
      />
      <div className="flex gap-2">
        <button
          onClick={handleCancel}
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
  preSelectedAppointmentTypeId?: number;
  preSelectedPractitionerId?: number;
  preSelectedTime?: string; // Initial time in HH:mm format
  preSelectedClinicNotes?: string; // Initial clinic notes
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
  onRecurringAppointmentsCreated?: () => Promise<void>;
}

export const CreateAppointmentModal: React.FC<CreateAppointmentModalProps> = React.memo(({
  preSelectedPatientId,
  initialDate,
  preSelectedAppointmentTypeId,
  preSelectedPractitionerId,
  preSelectedTime,
  preSelectedClinicNotes,
  practitioners: initialPractitioners,
  appointmentTypes,
  onClose,
  onConfirm,
  onRecurringAppointmentsCreated,
}) => {
  const isMobile = useIsMobile();
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
  
  const [selectedAppointmentTypeId, setSelectedAppointmentTypeId] = useState<number | null>(
    preSelectedAppointmentTypeId !== undefined ? preSelectedAppointmentTypeId : null
  );
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<number | null>(
    preSelectedPractitionerId !== undefined ? preSelectedPractitionerId : null
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(initialDate || null);
  const [selectedTime, setSelectedTime] = useState<string>(preSelectedTime || '');
  const [clinicNotes, setClinicNotes] = useState<string>(preSelectedClinicNotes || '');
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
    conflictInfo?: any;
  }>>([]);
  const [isCheckingConflicts, setIsCheckingConflicts] = useState<boolean>(false);
  const [editingOccurrenceId, setEditingOccurrenceId] = useState<string | null>(null);
  const [addingOccurrence, setAddingOccurrence] = useState<boolean>(false);
  const [hasVisitedConflictResolution, setHasVisitedConflictResolution] = useState<boolean>(false);
  const [singleAppointmentConflict, setSingleAppointmentConflict] = useState<any>(null);

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
  
  // Track if this is the initial mount to prevent auto-deselection from clearing pre-filled values
  const isInitialMountRef = useRef(true);

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

  // Sync effective values when selected values change (for initial state)

  // Mark initial mount as complete after first render
  useEffect(() => {
    isInitialMountRef.current = false;
  }, []);

  // Auto-deselection: When appointment type changes, clear practitioner, date, time
  useEffect(() => {
    // Skip on initial mount to preserve pre-filled values
    if (isInitialMountRef.current) return;
    
    if (selectedAppointmentTypeId === null && (selectedPractitionerId !== null || selectedDate !== null || selectedTime !== '')) {
      // Appointment type was cleared - clear dependent fields
      setSelectedPractitionerId(null);
      setSelectedDate(null);
      setSelectedTime('');
    }
  }, [selectedAppointmentTypeId, selectedPractitionerId, selectedDate, selectedTime]);

  // Auto-deselection: When practitioner changes, clear date, time
  useEffect(() => {
    // Skip on initial mount to preserve pre-filled values
    if (isInitialMountRef.current) return;
    
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
      // Only clear appointment type/practitioner/time if they weren't pre-filled
      // This preserves pre-filled values when duplicating
      if (preSelectedAppointmentTypeId === undefined) {
        setSelectedAppointmentTypeId(null);
      }
      if (preSelectedPractitionerId === undefined) {
        setSelectedPractitionerId(null);
      }
      if (preSelectedTime === undefined) {
        setSelectedTime('');
      }
      if (preSelectedClinicNotes === undefined) {
        setClinicNotes('');
      }
      setSelectedDate(initialDate || null);
      setSearchInput('');
      setStep('form');
      setError(null);
    }
  }, [preSelectedPatientId, resetState, initialDate, preSelectedAppointmentTypeId, preSelectedPractitionerId, preSelectedTime, preSelectedClinicNotes]);

  // Clear single appointment conflict when date/time changes
  useEffect(() => {
    setSingleAppointmentConflict(null);
  }, [selectedDate, selectedTime]);

  // Clear single appointment conflict when step changes away from confirm
  useEffect(() => {
    if (step !== 'confirm') {
      setSingleAppointmentConflict(null);
    }
  }, [step]);

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
        // Include all occurrences (including past ones) - conflicts will be detected by backend
        generatedOccurrences.push({
          id: `gen-${i}`,
          date: occurrenceDate.format('YYYY-MM-DD'),
          time: occurrenceDate.format('HH:mm'),
          hasConflict: false,
        });
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
        
        // Update occurrences with conflict status (using new backend format)
        const updatedOccurrences = generatedOccurrences.map((occ, idx) => {
          const conflictStatus = conflictResult.occurrences[idx];
          if (!conflictStatus) {
            return {
              ...occ,
              hasConflict: false,
              conflictInfo: null,
            };
          }
          
          // Convert to SchedulingConflictResponse format
          const conflictInfo = convertConflictStatusToResponse(conflictStatus);
          
          return {
            ...occ,
            hasConflict: conflictStatus.has_conflict || false,
            conflictInfo: conflictInfo?.has_conflict ? conflictInfo : null,
          };
        });
        
        setOccurrences(updatedOccurrences);
        
        // Always show conflict resolution if any conflicts exist (simplified logic)
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
      // Single appointment - check conflicts before going to confirmation
      setError(null);
      if (selectedDate && selectedTime && selectedPractitionerId && selectedAppointmentTypeId) {
        try {
          const conflictResponse = await apiService.checkSchedulingConflicts(
            selectedPractitionerId,
            selectedDate,
            selectedTime,
            selectedAppointmentTypeId
          );
          setSingleAppointmentConflict(conflictResponse.has_conflict ? conflictResponse : null);
        } catch (error) {
          logger.error('Failed to check single appointment conflicts:', error);
          // Don't block confirmation on conflict check failure
          setSingleAppointmentConflict(null);
        }
      }
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
          // Still trigger refresh if some appointments were created
          if (result.created_count > 0 && onRecurringAppointmentsCreated) {
            await onRecurringAppointmentsCreated();
          }
        } else {
          // Success - trigger refresh callback if provided
          if (onRecurringAppointmentsCreated) {
            await onRecurringAppointmentsCreated();
          }
          // Close modal without showing alert
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

  const handleDateSelect = (dateString: string | null) => {
    setSelectedDate(dateString);
    setSelectedTime('');
    // Clear error when user selects a new date (error might be stale from previous action)
    if (error && dateString) {
      setError(null);
    }
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

  // Render form step content (without buttons)
  const renderFormStepContent = () => (
    <div className="space-y-4">
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
            allowOverride={true}
          />
        )}

          {/* Recurrence Toggle */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onMouseDown={(e) => {
                // Stop propagation to prevent DateTimePicker's click outside handler from collapsing
                // This allows the button to work even when picker is expanded
                e.stopPropagation();
              }}
              onClick={() => {
                const newValue = !recurrenceEnabled;
                setRecurrenceEnabled(newValue);
                if (!newValue) {
                  // Reset recurrence state when disabled
                  setOccurrences([]);
                  setWeeksInterval(1);
                  setOccurrenceCount(null);
                  setHasVisitedConflictResolution(false);
                }
              }}
              aria-pressed={recurrenceEnabled}
              className={
                recurrenceEnabled
                  ? 'inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500 flex-shrink-0'
                  : 'inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 bg-gray-200 text-gray-900 hover:bg-gray-300 focus:ring-gray-500 flex-shrink-0'
              }
            >
              重複
            </button>

            {/* Recurrence Pattern Inputs */}
            {recurrenceEnabled && (
              <div 
                className="flex items-center gap-2 flex-1"
                onMouseDown={(e) => {
                  // Stop propagation to prevent DateTimePicker's click outside handler from collapsing
                  e.stopPropagation();
                }}
              >
                <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
                  每
                </label>
                <NumberInput
                  value={weeksInterval}
                  onChange={(value) => setWeeksInterval(value)}
                  fallback={1}
                  parseFn="parseInt"
                  min={1}
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
                  onWheel={preventScrollWheelChange}
                  className="w-16 border border-gray-300 rounded-md px-2 py-1 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
                  次
                </label>
              </div>
            )}
          </div>

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
  );

  // Render form step footer buttons
  const renderFormStepFooter = () => (
    <div 
      className="flex justify-end space-x-2 pt-4 border-t border-gray-200 flex-shrink-0"
      onMouseDown={(e) => {
        // Stop propagation to prevent DateTimePicker's click outside handler from collapsing
        // This allows the button to work even when picker is expanded
        e.stopPropagation();
      }}
    >
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
  );

  // Render conflict resolution step content (without buttons)
  const renderConflictResolutionStepContent = () => {
    // Simplified: canProceed is always enabled if occurrences exist (users can proceed with conflicts)
    const canProceed = occurrences.length > 0;
    
    return (
      <div className="space-y-4">
          <div className="space-y-2">
            {occurrences.map((occ, idx) => {
              const dateMoment = moment.tz(`${occ.date}T${occ.time}`, 'Asia/Taipei');
              const formattedDateTime = formatAppointmentDateTime(dateMoment.toDate());
              const isEditing = editingOccurrenceId === occ.id;
              
              return (
                <div key={occ.id} className="space-y-2">
                  <div className="flex items-center justify-between gap-3 p-3 rounded-md bg-white border border-gray-200">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-700">
                        {idx + 1}
                      </div>
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-sm font-medium text-gray-900">
                          {formattedDateTime}
                        </span>
                        {occ.hasConflict && occ.conflictInfo && (
                          <ConflictIndicator
                            conflictInfo={occ.conflictInfo}
                            compact={true}
                          />
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => {
                          const updated = occurrences.filter(o => o.id !== occ.id);
                          setOccurrences(updated);
                        }}
                        className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-md transition-colors"
                        aria-label="刪除"
                        title="刪除"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                      <button
                        onClick={() => {
                          setEditingOccurrenceId(occ.id);
                        }}
                        className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md transition-colors"
                        aria-label="修改"
                        title="修改"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  
                  {/* DateTimePicker for editing - appears right below the occurrence */}
                  {isEditing && selectedAppointmentTypeId && selectedPractitionerId && (
                    <div className="border-t border-gray-200 pt-3">
                      <RecurrenceDateTimePickerWrapper
                        initialDate={occ.date}
                        initialTime={occ.time}
                        selectedPractitionerId={selectedPractitionerId}
                        appointmentTypeId={selectedAppointmentTypeId}
                        onConfirm={async (date: string, time: string) => {
                          // Check for duplicates (excluding current)
                          const isDuplicate = occurrences.some(o => 
                            o.id !== occ.id && o.date === date && o.time === time
                          );
                          if (isDuplicate) {
                            setError('此時間已在列表中，請選擇其他時間');
                            return;
                          }
                          
                          // Real-time conflict detection - check conflicts immediately
                          const occurrenceString = moment.tz(`${date}T${time}`, 'Asia/Taipei').toISOString();
                          try {
                            const conflictResult = await apiService.checkRecurringConflicts({
                              practitioner_id: selectedPractitionerId!,
                              appointment_type_id: selectedAppointmentTypeId!,
                              occurrences: [occurrenceString],
                            });
                            
                            const conflictStatus = conflictResult.occurrences[0];
                            if (!conflictStatus) {
                              setError('無法檢查衝突，請稍後再試');
                              return;
                            }
                            
                            // Convert to SchedulingConflictResponse format
                            const conflictInfo = convertConflictStatusToResponse(conflictStatus);
                            
                            // Update occurrence immediately with new time and conflict status
                            // Users can proceed with conflicts (override implicit for clinic users)
                            const updated = occurrences.map(o => 
                              o.id === occ.id
                                ? {
                                    ...o,
                                    date,
                                    time,
                                    hasConflict: conflictStatus.has_conflict || false,
                                    conflictInfo: conflictInfo?.has_conflict ? conflictInfo : null,
                                  }
                                : o
                            );
                            
                            setOccurrences(updated);
                            setEditingOccurrenceId(null);
                            setError(null);
                          } catch (err) {
                            logger.error('Error checking conflict for edited occurrence:', err);
                            setError('無法檢查衝突，請稍後再試');
                          }
                        }}
                        onCancel={() => {
                          setEditingOccurrenceId(null);
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            
            {/* Add button - hidden when addingOccurrence is true */}
            {!addingOccurrence && (
              <button
                onClick={() => {
                  setAddingOccurrence(true);
                }}
                className="w-full flex items-center justify-center gap-2 p-3 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md border border-dashed border-blue-300 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-sm font-medium">新增</span>
              </button>
            )}
            
            {/* DateTimePicker for adding new occurrence - appears after the add button */}
            {addingOccurrence && selectedAppointmentTypeId && selectedPractitionerId && (
              <div className="border-t border-gray-200 pt-3">
                <RecurrenceDateTimePickerWrapper
                  initialDate={null}
                  initialTime={''}
                  selectedPractitionerId={selectedPractitionerId}
                  appointmentTypeId={selectedAppointmentTypeId}
                  onConfirm={async (date: string, time: string) => {
                    // Add new occurrence - check for conflicts first
                    const isDuplicate = occurrences.some(o => o.date === date && o.time === time);
                    if (isDuplicate) {
                      setError('此時間已在列表中，請選擇其他時間');
                      return;
                    }
                    
                    // Real-time conflict detection - check conflicts immediately
                    const occurrenceString = moment.tz(`${date}T${time}`, 'Asia/Taipei').toISOString();
                    try {
                      const conflictResult = await apiService.checkRecurringConflicts({
                        practitioner_id: selectedPractitionerId!,
                        appointment_type_id: selectedAppointmentTypeId!,
                        occurrences: [occurrenceString],
                      });
                      
                      const conflictStatus = conflictResult.occurrences[0];
                      if (!conflictStatus) {
                        setError('無法檢查衝突，請稍後再試');
                        return;
                      }
                      
                      // Convert to SchedulingConflictResponse format
                      const conflictInfo = convertConflictStatusToResponse(conflictStatus);
                      
                      // Add occurrence immediately (users can proceed with conflicts)
                      const newOcc = {
                        id: `new-${Date.now()}`,
                        date,
                        time,
                        hasConflict: conflictStatus.has_conflict || false,
                        conflictInfo: conflictInfo?.has_conflict ? conflictInfo : null,
                      };
                      setOccurrences([...occurrences, newOcc]);
                      // Close the picker and show the 新增 button again
                      setAddingOccurrence(false);
                      setError(null);
                    } catch (err) {
                      logger.error('Error checking conflict for new occurrence:', err);
                      setError('無法檢查衝突，請稍後再試');
                    }
                  }}
                  onCancel={() => {
                    setAddingOccurrence(false);
                  }}
                />
              </div>
            )}
          </div>
          
          {occurrences.length === 0 && (
            <div className="text-center py-4 text-red-600 text-sm">
              至少需要一個預約時段
            </div>
          )}
        </div>
    );
  };

  // Render conflict resolution step footer buttons
  const renderConflictResolutionStepFooter = () => {
    const canProceed = occurrences.length > 0;
    
    return (
      <div className="flex justify-end space-x-2 pt-4 border-t border-gray-200 flex-shrink-0">
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
            // Always enabled - users can proceed with conflicts
            setHasVisitedConflictResolution(true);
            setStep('confirm');
          }}
          disabled={!canProceed}
          className={`btn-primary ${!canProceed ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          下一步
        </button>
      </div>
    );
  };

  // Render confirmation step content (without buttons)
  const renderConfirmStepContent = () => {
    const dateTime = selectedDate && selectedTime 
      ? moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei').toDate()
      : null;
    const formattedDateTime = dateTime ? formatAppointmentDateTime(dateTime) : '';

    return (
      <div className="space-y-4">
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
                      const formattedDateTime = formatAppointmentDateTime(dateMoment.toDate());
                      return (
                        <div key={occ.id} className="flex items-center gap-2 text-sm text-gray-700">
                          <span>{idx + 1}. {formattedDateTime}</span>
                          {occ.hasConflict && occ.conflictInfo && (
                            <ConflictIndicator
                              conflictInfo={occ.conflictInfo}
                              compact={true}
                            />
                          )}
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
              <div className="flex items-center gap-2">
                <div>
                  <span className="text-sm text-gray-600">日期時間：</span>
                  <span className="text-sm text-gray-900 ml-2">{formattedDateTime}</span>
                </div>
                {singleAppointmentConflict && (
                  <ConflictIndicator
                    conflictInfo={singleAppointmentConflict}
                    compact={true}
                  />
                )}
              </div>
            )}
            {clinicNotes.trim() && (
              <div>
                <span className="text-sm text-gray-600">診所備注：</span>
                <span className="text-sm text-gray-900 ml-2 whitespace-pre-wrap">{clinicNotes.trim()}</span>
              </div>
            )}
          </div>
        </div>
    );
  };

  // Render confirmation step footer buttons
  const renderConfirmStepFooter = () => (
    <div className="flex justify-end space-x-2 pt-4 border-t border-gray-200 flex-shrink-0">
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
  );

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
      <BaseModal onClose={handleClose} aria-label={modalTitle} className="!p-0" fullScreen={isMobile}>
        <div className={`flex flex-col h-full ${isMobile ? 'px-4 pt-4 pb-0' : 'px-6 pt-6 pb-6'}`}>
          {/* Header */}
          <div className="flex items-center mb-4 flex-shrink-0">
            <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mr-2">
              <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                <path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-blue-800">{modalTitle}</h3>
          </div>
          
          {/* Error messages */}
          {/* Only show error at top if DateTimePicker is not visible (to avoid duplicate error messages) */}
          {error && step === 'form' && (!selectedAppointmentTypeId || !selectedPractitionerId) && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3 flex-shrink-0">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
          {/* Show error for other steps (conflict-resolution, confirm) */}
          {error && step !== 'form' && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3 flex-shrink-0">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Scrollable content area */}
          <div className={`flex-1 overflow-y-auto ${isMobile ? 'px-0' : ''}`}>
            {step === 'form' && renderFormStepContent()}
            {step === 'conflict-resolution' && renderConflictResolutionStepContent()}
            {step === 'confirm' && renderConfirmStepContent()}
          </div>
          
          {/* Footer with buttons - always visible at bottom */}
          <div 
            className={`flex-shrink-0 ${isMobile ? 'px-4' : ''}`}
            style={isMobile ? {
              paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
            } : undefined}
          >
            {step === 'form' && renderFormStepFooter()}
            {step === 'conflict-resolution' && renderConflictResolutionStepFooter()}
            {step === 'confirm' && renderConfirmStepFooter()}
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


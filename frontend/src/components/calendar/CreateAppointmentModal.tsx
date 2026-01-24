/**
 * CreateAppointmentModal Component
 * 
 * Modal for creating new appointments on behalf of patients.
 * Single-page form with confirmation step, similar to EditAppointmentModal.
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { BaseModal } from './BaseModal';
import { ServiceItemSelectionModal } from './ServiceItemSelectionModal';
import { DateTimePicker } from './DateTimePicker';
import { apiService } from '../../services/api';
import { getErrorMessage } from '../../types/api';
import { logger } from '../../utils/logger';
import { SearchInput } from '../shared';
import { Patient, AppointmentType, ServiceTypeGroup, Practitioner } from '../../types';
import moment from 'moment-timezone';
import { formatAppointmentDateTime } from '../../utils/calendarUtils';
import { usePatients } from '../../hooks/queries';
import { useAuth } from '../../hooks/useAuth';
import { useDebouncedSearch, shouldTriggerSearch } from '../../utils/searchUtils';
import { PatientCreationModal } from '../PatientCreationModal';
import { PatientCreationSuccessModal } from '../PatientCreationSuccessModal';
import { ClinicNotesTextarea } from '../shared/ClinicNotesTextarea';
import { preventScrollWheelChange } from '../../utils/inputUtils';
import { NumberInput } from '../shared/NumberInput';
import { ConflictIndicator, ConflictWarningButton, ConflictDisplay } from '../shared';
import { SchedulingConflictResponse } from '../../types';
import { useIsMobile } from '../../hooks/useIsMobile';
import { ResourceSelection } from '../ResourceSelection';
import { useAppointmentForm } from '../../hooks/useAppointmentForm';
import { CalendarEvent } from '../../utils/calendarDataAdapter';
import {
  AppointmentReferenceHeader,
  AppointmentTypeSelector,
  AppointmentFormSkeleton
} from './form';
import { PractitionerSelectionModal } from './PractitionerSelectionModal';
import { useBatchPractitionerConflicts, usePractitionerConflicts } from '../../hooks/queries/usePractitionerConflicts';
import { shouldPromptForAssignment } from '../../hooks/usePractitionerAssignmentPrompt';
import { PractitionerAssignmentPromptModal } from '../PractitionerAssignmentPromptModal';
import { PractitionerAssignmentConfirmationModal } from '../PractitionerAssignmentConfirmationModal';
import { useModalQueue } from '../../contexts/ModalQueueContext';
import { getAssignedPractitionerIds } from '../../utils/patientUtils';
import { useModal } from '../../contexts/ModalContext';
import { EMPTY_ARRAY, EMPTY_OBJECT } from '../../utils/constants';

/**
 * Helper function to merge practitioner type mismatch information with API conflict response.
 * This ensures the type mismatch warning is preserved alongside other conflict types.
 * 
 * @param apiConflict - The conflict response from the API (may be null/undefined)
 * @param hasPractitionerTypeMismatch - Whether there's a practitioner type mismatch
 * @returns Merged conflict info or null if no conflicts exist
 */
function mergeConflictWithTypeMismatch(
  apiConflict: SchedulingConflictResponse | null | undefined,
  hasPractitionerTypeMismatch: boolean
): SchedulingConflictResponse | null {
  if (!hasPractitionerTypeMismatch) {
    // No type mismatch, return API conflict as-is
    return apiConflict?.has_conflict ? apiConflict : null;
  }

  if (apiConflict) {
    // Merge mismatch status with existing API conflicts
    // Use 'as any' to allow custom is_type_mismatch property
    return {
      ...apiConflict,
      has_conflict: true,
      // Keep existing conflict type (e.g., 'past_appointment') if present
      conflict_type: apiConflict.conflict_type || 'practitioner_type_mismatch',
      // Custom flag to ensure mismatch warning shows alongside other warnings
      is_type_mismatch: true,
      // Ensure default availability is set
      default_availability: apiConflict.default_availability || { is_within_hours: true, normal_hours: null }
    } as any;
  } else {
    // Only type mismatch, no API conflicts
    // Use 'as any' to allow custom is_type_mismatch property
    return {
      has_conflict: true,
      conflict_type: 'practitioner_type_mismatch',
      is_type_mismatch: true,
      appointment_conflict: null,
      exception_conflict: null,
      default_availability: { is_within_hours: true, normal_hours: null }
    } as any;
  }
}


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
    selection_insufficient_warnings: conflictStatus.selection_insufficient_warnings || [],
    resource_conflict_warnings: conflictStatus.resource_conflict_warnings || [],
    default_availability: conflictStatus.default_availability || EMPTY_OBJECT as any,
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
}> = ({ initialDate, initialTime, selectedPractitionerId, appointmentTypeId, onConfirm, onCancel }) => {
  const [selectedDate, setSelectedDate] = useState<string | null>(initialDate);
  // Use initialTime to pre-populate the picker (First Path logic)
  const [selectedTime, setSelectedTime] = useState<string>(initialTime);

  const handleDateSelect = (date: string | null) => {
    setSelectedDate(date);
    setSelectedTime(''); // Clear time when date changes
  };

  const handleTimeSelect = (time: string) => {
    setSelectedTime(time);
  };

  const handleConfirm = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedDate && selectedTime) {
      await onConfirm(selectedDate, selectedTime);
    }
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCancel();
  };

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
  preSelectedPatientId?: number | undefined;
  preSelectedPatientName?: string | undefined; // Optional: patient name for pre-selection
  initialDate?: string | null | undefined; // Initial date in YYYY-MM-DD format
  preSelectedAppointmentTypeId?: number | undefined;
  preSelectedPractitionerId?: number | undefined;
  preSelectedTime?: string | null | undefined; // Initial time in HH:mm format
  preSelectedClinicNotes?: string | null | undefined; // Initial clinic notes
  practitioners: Practitioner[];
  appointmentTypes: AppointmentType[];
  onClose: () => void;
  onConfirm: (formData: {
    patient_id: number;
    appointment_type_id: number;
    practitioner_id: number;
    start_time: string;
    clinic_notes?: string;
    selected_resource_ids?: number[];
  }) => Promise<void>;
  onRecurringAppointmentsCreated?: () => Promise<void>;
  prePopulatedFromSlot?: boolean;
  event?: CalendarEvent | null | undefined; // Optional original event for duplication reference
}

export const CreateAppointmentModal: React.FC<CreateAppointmentModalProps> = React.memo(({
  preSelectedPatientId,
  preSelectedPatientName,
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
  prePopulatedFromSlot = false,
  event,
}) => {
  const isMobile = useIsMobile(1024);
  const { enqueueModal, showNext } = useModalQueue();
  const { alert } = useModal();
  const [step, setStep] = useState<CreateStep>('form');

  // Practitioner selection modal state
  const [isPractitionerModalOpen, setIsPractitionerModalOpen] = useState(false);

  // Duplication mode detection
  const isDuplication = !!preSelectedTime || !!event;

  const {
    selectedPatientId,
    setSelectedPatientId,
    selectedAppointmentTypeId,
    setSelectedAppointmentTypeId,
    selectedPractitionerId,
    setSelectedPractitionerId,
    selectedDate,
    setSelectedDate,
    selectedTime,
    setSelectedTime,
    clinicNotes,
    setClinicNotes,
    selectedResourceIds,
    setSelectedResourceIds,
    availablePractitioners,
    isInitialLoading,
    isLoadingPractitioners,
    error,
    setError,
    isValid,
    referenceDateTime,
    hasPractitionerTypeMismatch,
  } = useAppointmentForm({
    mode: isDuplication ? 'duplicate' : 'create',
    event,
    appointmentTypes,
    practitioners: initialPractitioners,
    initialDate,
    preSelectedPatientId,
    preSelectedAppointmentTypeId,
    preSelectedPractitionerId,
    preSelectedTime,
    preSelectedClinicNotes,
    prePopulatedFromSlot,
  });

  // Conflict checking hooks
  const practitionerConflictsQuery = useBatchPractitionerConflicts(
    availablePractitioners.length > 0 ? availablePractitioners.map(p => ({ user_id: p.id })) : null,
    selectedDate,
    selectedTime,
    selectedAppointmentTypeId,
    selectedResourceIds,
    !!selectedDate && !!selectedTime && !!selectedAppointmentTypeId && availablePractitioners.length > 0
  ) || { data: null, isLoading: false };

  // Single practitioner conflict checking for form validation
  const singlePractitionerConflictsQuery = usePractitionerConflicts(
    selectedPractitionerId,
    selectedDate,
    selectedTime,
    selectedAppointmentTypeId,
    selectedResourceIds,
    undefined, // excludeCalendarEventId
    !!selectedPractitionerId && !!selectedDate && !!selectedTime && !!selectedAppointmentTypeId
  );

  // Update single appointment conflict state from hook result
  useEffect(() => {
    if (singlePractitionerConflictsQuery?.data || hasPractitionerTypeMismatch) {
      setSingleAppointmentConflict(mergeConflictWithTypeMismatch(
        singlePractitionerConflictsQuery?.data,
        hasPractitionerTypeMismatch
      ));
    } else if (singlePractitionerConflictsQuery?.error) {
      logger.error('Failed to check conflicts:', singlePractitionerConflictsQuery.error);
      setSingleAppointmentConflict(null);
    } else {
      setSingleAppointmentConflict(null);
    }
  }, [singlePractitionerConflictsQuery?.data, singlePractitionerConflictsQuery?.error, hasPractitionerTypeMismatch]);

  // Try to get patient data from sessionStorage if preSelectedPatientId is set
  const [preSelectedPatientData, setPreSelectedPatientData] = useState<Patient | null>(() => {
    if (selectedPatientId) {
      try {
        const stored = sessionStorage.getItem('preSelectedPatientData');
        if (stored) {
          const data = JSON.parse(stored);
          if (data.id === selectedPatientId) {
            return data as Patient;
          }
        }
      } catch (err) {
        logger.warn('Failed to read preSelectedPatientData from sessionStorage:', err);
      }
    }
    return null;
  });

  const [occurrenceResourceIds, setOccurrenceResourceIds] = useState<Record<string, number[]>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [groups, setGroups] = useState<ServiceTypeGroup[]>([]);
  const [isServiceItemModalOpen, setIsServiceItemModalOpen] = useState(false);

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

  // Compute conflicts for all practitioners, including type mismatches
  const practitionerConflictsWithTypeMismatch = useMemo(() => {
    const apiConflicts = practitionerConflictsQuery?.data?.results?.reduce((acc: Record<number, SchedulingConflictResponse>, result: any) => {
      if (result.practitioner_id) {
        acc[result.practitioner_id] = result as SchedulingConflictResponse;
      }
      return acc;
    }, {}) || {};

    if (!selectedAppointmentTypeId) return apiConflicts;

    const availableIds = new Set(availablePractitioners.map(p => p.id));
    const fullConflicts = { ...apiConflicts };

    initialPractitioners.forEach(p => {
      if (!availableIds.has(p.id)) {
        // Only add mismatch conflict if there isn't already a more specific conflict from API
        if (!fullConflicts[p.id]?.has_conflict) {
          fullConflicts[p.id] = {
            has_conflict: true,
            conflict_type: 'practitioner_type_mismatch',
            appointment_conflict: null,
            exception_conflict: null,
            resource_conflicts: null,
            default_availability: { is_within_hours: true, normal_hours: null }
          } as SchedulingConflictResponse;
        }
      }
    });

    return fullConflicts;
  }, [practitionerConflictsQuery?.data?.results, availablePractitioners, initialPractitioners, selectedAppointmentTypeId]);

  // Validation state
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Compute appointment types offered by the selected practitioner
  const practitionerAppointmentTypeIds = useMemo(() => {
    if (!selectedPractitionerId) return undefined;
    const practitioner = initialPractitioners.find(p => p.id === selectedPractitionerId);
    return practitioner?.offered_types;
  }, [selectedPractitionerId, initialPractitioners]);

  // Assignment prompt state
  const [currentPatient, setCurrentPatient] = useState<Patient | null>(null);

  // Fetch patient data when patient is selected to get assigned practitioners
  useEffect(() => {
    const loadPatient = async () => {
      if (selectedPatientId) {
        try {
          const patient = await apiService.getPatient(selectedPatientId);
          setCurrentPatient(patient);
        } catch (err) {
          logger.error('Failed to fetch patient for assignment check:', err);
          setCurrentPatient(null);
        }
      } else {
        setCurrentPatient(null);
      }
    };
    loadPatient();
  }, [selectedPatientId]);

  // Fetch groups on mount
  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const response = await apiService.getServiceTypeGroups();
        setGroups(response.groups || EMPTY_ARRAY);
      } catch (err) {
        logger.error('Error loading service type groups:', err);
        setGroups([]);
      }
    };
    fetchGroups();
  }, []);

  const hasGrouping = groups.length > 0;

  // Handle service item selection from modal
  const handleServiceItemSelect = useCallback((serviceItemId: number | undefined) => {
    setSelectedAppointmentTypeId(serviceItemId ?? null);
    setIsServiceItemModalOpen(false);
  }, [setSelectedAppointmentTypeId]);

  // Memoize assigned practitioner IDs for PractitionerSelector
  const assignedPractitionerIdsSet = useMemo(() => {
    if (!currentPatient) return undefined;
    const ids = getAssignedPractitionerIds(currentPatient);
    return ids.length > 0 ? new Set(ids) : undefined;
  }, [currentPatient]);

  // Auto-select first assigned practitioner when dependencies change
  useEffect(() => {
    // Only auto-select if:
    // 1. Patient is selected and loaded
    // 2. Appointment type is selected
    // 3. Available practitioners are loaded
    // 4. No practitioner is currently selected (don't override user selection)
    if (
      currentPatient &&
      selectedAppointmentTypeId &&
      availablePractitioners.length > 0 &&
      !selectedPractitionerId &&
      !isLoadingPractitioners &&
      !prePopulatedFromSlot
    ) {
      const assignedIds = getAssignedPractitionerIds(currentPatient);

      if (assignedIds.length > 0) {
        // Find the first assigned practitioner that is available for the selected appointment type
        const firstAssignedAvailable = availablePractitioners.find((p) => assignedIds.includes(p.id));

        if (firstAssignedAvailable) {
          setSelectedPractitionerId(firstAssignedAvailable.id);
        }
      }
    }
  }, [currentPatient, selectedAppointmentTypeId, availablePractitioners.length, selectedPractitionerId, isLoadingPractitioners]);

  const [searchInput, setSearchInput] = useState<string>(
    preSelectedPatientName || ((isDuplication && event?.resource.patient_name) ? event.resource.patient_name : '')
  );
  const [isComposing, setIsComposing] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Refs for scrolling to validation errors
  const patientFieldRef = useRef<HTMLDivElement>(null);
  const appointmentTypeFieldRef = useRef<HTMLDivElement>(null);
  const practitionerFieldRef = useRef<HTMLDivElement>(null);
  const dateTimeFieldRef = useRef<HTMLDivElement>(null);
  const recurrenceCountFieldRef = useRef<HTMLDivElement>(null);
  const isCreatingPatientFromModal = useRef(false);
  const searchInputInitializedRef = useRef(!!preSelectedPatientName || (isDuplication && !!event?.resource.patient_name));

  // Patient creation modal state
  const [isCreatePatientModalOpen, setIsCreatePatientModalOpen] = useState(false);
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
  const [createdPatientId, setCreatedPatientId] = useState<number | null>(null);
  const [createdPatientName, setCreatedPatientName] = useState<string>('');
  const [createdPatientPhone, setCreatedPatientPhone] = useState<string | null>(null);
  const [createdPatientBirthday, setCreatedPatientBirthday] = useState<string | null>(null);

  // Use debounced search for server-side search
  const debouncedSearchQuery = useDebouncedSearch(searchInput, 400, isComposing);

  const hasValidSearch = debouncedSearchQuery.trim().length > 0 && shouldTriggerSearch(debouncedSearchQuery);
  const shouldFetchForPreSelected = !!selectedPatientId && !hasValidSearch;

  const { } = useAuth();

  const {
    data: patientsData,
    isLoading: isLoadingPatients,
    error: patientsError,
    refetch: refetchPatients
  } = usePatients(
    1, // page
    50, // pageSize - larger for search results
    hasValidSearch ? debouncedSearchQuery : undefined,
    undefined // practitionerId
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
  const patients = displayData?.patients || EMPTY_ARRAY;
  const totalPatients = displayData?.total || 0;
  const displayPatients = patients;

  useEffect(() => {
    if (patientsError) {
      setError(patientsError.message || 'Unable to load patients');
    }
  }, [patientsError, setError]);

  const selectedPatient = useMemo(() => {
    if (preSelectedPatientData && preSelectedPatientData.id === selectedPatientId) {
      return preSelectedPatientData;
    }
    return patients.find(p => p.id === selectedPatientId) || null;
  }, [patients, selectedPatientId, preSelectedPatientData]);

  useEffect(() => {
    if (selectedPatientId && selectedPatient && !searchInput) {
      setSearchInput(selectedPatient.full_name);
      searchInputInitializedRef.current = true;
    }
  }, [selectedPatientId, selectedPatient, searchInput]);

  useEffect(() => {
    // Only clear if searchInput is empty AND it was previously initialized (either by prop or by auto-fill)
    if (selectedPatientId && !searchInput.trim() && searchInputInitializedRef.current) {
      setSelectedPatientId(null);
      searchInputInitializedRef.current = false;
    }
  }, [searchInput, selectedPatientId, setSelectedPatientId]);

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



  // Clear validation errors when fields are selected
  useEffect(() => {
    if (selectedPatientId) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors.patient;
        return newErrors;
      });
    }
  }, [selectedPatientId]);

  useEffect(() => {
    if (selectedAppointmentTypeId) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors.appointmentType;
        return newErrors;
      });
    }
  }, [selectedAppointmentTypeId]);

  useEffect(() => {
    if (selectedPractitionerId) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors.practitioner;
        return newErrors;
      });
    }
  }, [selectedPractitionerId]);

  useEffect(() => {
    if (selectedDate && selectedTime) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors.dateTime;
        return newErrors;
      });
    }
  }, [selectedDate, selectedTime]);

  // Helper to get field display name in Chinese
  const getFieldDisplayName = (fieldKey: string): string => {
    const fieldNames: Record<string, string> = {
      patient: '病患',
      appointmentType: '預約類型',
      practitioner: '治療師',
      dateTime: '日期時間',
      recurrenceCount: '預約次數'
    };
    return fieldNames[fieldKey] || fieldKey;
  };

  // Helper to scroll to first error field
  const scrollToFirstError = (errors: Record<string, string>) => {
    const fieldRefs: Record<string, React.RefObject<HTMLDivElement>> = {
      patient: patientFieldRef,
      appointmentType: appointmentTypeFieldRef,
      practitioner: practitionerFieldRef,
      dateTime: dateTimeFieldRef,
      recurrenceCount: recurrenceCountFieldRef
    };

    // Find first error field in order
    const fieldOrder = ['patient', 'appointmentType', 'practitioner', 'dateTime', 'recurrenceCount'];
    for (const fieldKey of fieldOrder) {
      if (errors[fieldKey] && fieldRefs[fieldKey]?.current) {
        fieldRefs[fieldKey].current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
        break;
      }
    }
  };

  const handleFormSubmit = async () => {
    // Check all missing fields
    const newValidationErrors: Record<string, string> = {};
    if (!selectedPatientId) newValidationErrors.patient = '必填';
    if (!selectedAppointmentTypeId) newValidationErrors.appointmentType = '必填';
    if (!selectedPractitionerId) newValidationErrors.practitioner = '必填';
    if (!selectedDate || !selectedTime) newValidationErrors.dateTime = '必填';

    if (recurrenceEnabled) {
      if (!occurrenceCount || occurrenceCount < 1) {
        newValidationErrors.recurrenceCount = '必填';
      }
    }

    if (Object.keys(newValidationErrors).length > 0) {
      setValidationErrors(newValidationErrors);
      scrollToFirstError(newValidationErrors);
      return;
    }

    if (recurrenceEnabled) {
      // Should effectively be caught by validation above, but satisfy TS
      if (!occurrenceCount) return;

      if (occurrenceCount > 50) {
        setError('最多只能建立50個預約');
        return;
      }

      const baseDateTime = moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei');
      const generatedOccurrences: Array<{ id: string; date: string; time: string; hasConflict: boolean }> = [];

      for (let i = 0; i < occurrenceCount; i++) {
        const occurrenceDate = baseDateTime.clone().add(i * weeksInterval, 'weeks');
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

        const updatedOccurrences = generatedOccurrences.map((occ, idx) => {
          const conflictStatus = conflictResult.occurrences[idx];
          if (!conflictStatus) {
            return { ...occ, hasConflict: false, conflictInfo: null };
          }

          const conflictInfo = convertConflictStatusToResponse(conflictStatus);

          return {
            ...occ,
            hasConflict: conflictStatus.has_conflict || false,
            conflictInfo: conflictInfo?.has_conflict ? conflictInfo : null,
          };
        });

        setOccurrences(updatedOccurrences);

        const initialOccurrenceResources: Record<string, number[]> = {};
        updatedOccurrences.forEach(occ => {
          initialOccurrenceResources[occ.id] = [...selectedResourceIds];
        });
        setOccurrenceResourceIds(initialOccurrenceResources);

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
      setError(null);
      if (selectedDate && selectedTime && selectedPractitionerId && selectedAppointmentTypeId) {
        try {
          // Use batch API for consistency
          const result = await apiService.checkBatchPractitionerConflicts({
            practitioners: [{ user_id: selectedPractitionerId }],
            date: selectedDate,
            start_time: selectedTime,
            appointment_type_id: selectedAppointmentTypeId,
            selected_resource_ids: selectedResourceIds,
          });
          const conflictResponse = result.results[0];
          setSingleAppointmentConflict(mergeConflictWithTypeMismatch(conflictResponse, hasPractitionerTypeMismatch));
        } catch (error) {
          logger.error('Failed to check single appointment conflicts:', error);
          setSingleAppointmentConflict(null);
        }
      }
      setStep('confirm');
    }
  };

  const handleSave = async () => {
    if (!isValid) {
      setError('請填寫所有必填欄位');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      if (recurrenceEnabled && occurrences.length > 0) {
        const occurrenceStrings = occurrences.map(occ =>
          moment.tz(`${occ.date}T${occ.time}`, 'Asia/Taipei').toISOString()
        );

        const result = await apiService.createRecurringAppointments({
          patient_id: selectedPatientId!,
          appointment_type_id: selectedAppointmentTypeId!,
          practitioner_id: selectedPractitionerId!,
          ...(clinicNotes.trim() ? { clinic_notes: clinicNotes.trim() } : {}),
          occurrences: occurrences.map((occ, idx) => {
            const startTime = occurrenceStrings[idx];
            if (!startTime) throw new Error(`Invalid start time for occurrence ${idx}`);
            const resourceIds = occurrenceResourceIds[occ.id];
            return {
              start_time: startTime,
              ...(resourceIds && resourceIds.length > 0 ? { selected_resource_ids: resourceIds } : {}),
            };
          }),
        });

        if (result.failed_count > 0) {
          const errorMessages = result.failed_occurrences.map(f => `${f.start_time}: ${f.error_message}`).join('\n');
          setError(`已建立 ${result.created_count} 個預約，${result.failed_count} 個失敗：\n${errorMessages}`);
          setStep('conflict-resolution');
          if (result.created_count > 0 && onRecurringAppointmentsCreated) {
            await onRecurringAppointmentsCreated();
          }
        } else {
          if (onRecurringAppointmentsCreated) {
            await onRecurringAppointmentsCreated();
          }
          onClose();
        }
      } else {
        const startTime = moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei').toISOString();
        const formData: any = {
          patient_id: selectedPatientId,
          appointment_type_id: selectedAppointmentTypeId,
          practitioner_id: selectedPractitionerId,
          start_time: startTime,
        };
        if (clinicNotes.trim()) formData.clinic_notes = clinicNotes.trim();
        if (selectedResourceIds.length > 0) formData.selected_resource_ids = selectedResourceIds;

        await onConfirm(formData);

        // After successful appointment creation, check for assignment prompt
        // Only check if practitioner is not null (not "不指定")
        // Use already-fetched patient data if available, otherwise fetch
        if (selectedPractitionerId !== null && selectedPatientId) {
          try {
            // Use currentPatient if available and matches, otherwise fetch
            let patient = currentPatient;
            if (!patient || patient.id !== selectedPatientId) {
              patient = await apiService.getPatient(selectedPatientId);
              setCurrentPatient(patient);
            }

            // Check if we need to prompt for assignment
            if (shouldPromptForAssignment(patient, selectedPractitionerId)) {
              const practitionerName = availablePractitioners.find(p => p.id === selectedPractitionerId)?.full_name || '';

              // Get current assigned practitioners to display
              // Prefer assigned_practitioners array if available, otherwise use assigned_practitioner_ids
              let currentAssigned: Array<{ id: number; full_name: string }> = [];
              if (patient.assigned_practitioners && patient.assigned_practitioners.length > 0) {
                currentAssigned = patient.assigned_practitioners
                  .filter((p) => p.is_active !== false)
                  .map((p) => ({ id: p.id, full_name: p.full_name }));
              } else if (patient.assigned_practitioner_ids && patient.assigned_practitioner_ids.length > 0) {
                // Use assigned_practitioner_ids and look up names from all practitioners (not just available ones)
                // Use initialPractitioners which contains all practitioners, not filtered by appointment type
                currentAssigned = patient.assigned_practitioner_ids
                  .map((id) => {
                    const practitioner = initialPractitioners.find(p => p.id === id);
                    return practitioner ? { id: practitioner.id, full_name: practitioner.full_name } : null;
                  })
                  .filter((p): p is { id: number; full_name: string } => p !== null);
              }

              // Enqueue the assignment prompt modal (defer until this modal closes)
              enqueueModal<React.ComponentProps<typeof PractitionerAssignmentPromptModal>>({
                id: 'assignment-prompt',
                component: PractitionerAssignmentPromptModal,
                defer: true, // Don't show until CreateAppointmentModal closes
                props: {
                  practitionerName,
                  currentAssignedPractitioners: currentAssigned,
                  onConfirm: async () => {
                    // Handle assignment
                    if (!patient || !selectedPractitionerId) return;

                    try {
                      const updatedPatient = await apiService.assignPractitionerToPatient(
                        patient.id,
                        selectedPractitionerId
                      );

                      // Get all assigned practitioners (including the newly added one)
                      const allAssigned = updatedPatient.assigned_practitioners || EMPTY_ARRAY;
                      const activeAssigned = allAssigned
                        .filter((p) => p.is_active !== false)
                        .map((p) => ({ id: p.id, full_name: p.full_name }));

                      // Update patient state
                      setCurrentPatient(updatedPatient);

                      // Enqueue confirmation modal (exclude the newly added practitioner)
                      // Use defer: true to wait for the prompt modal to fully close
                      enqueueModal<React.ComponentProps<typeof PractitionerAssignmentConfirmationModal>>({
                        id: 'assignment-confirmation',
                        component: PractitionerAssignmentConfirmationModal,
                        defer: true, // Wait for prompt modal to fully close
                        props: {
                          assignedPractitioners: activeAssigned,
                          excludePractitionerId: selectedPractitionerId,
                        },
                      });

                      // Show the confirmation modal after the prompt modal closes
                      setTimeout(() => {
                        showNext();
                      }, 250);
                    } catch (err) {
                      logger.error('Failed to add practitioner assignment:', err);
                      const errorMessage = getErrorMessage(err) || '無法將治療師設為負責人員';
                      await alert(errorMessage, '錯誤');
                    }
                  },
                  onCancel: () => {
                    // User declined assignment, just close
                  },
                },
              });

              // Close this modal, then show the queued prompt modal
              onClose();
              // Delay to ensure this modal closes before showing next
              // Using 250ms to account for close animation (200ms) + buffer
              setTimeout(() => {
                showNext();
              }, 250);
              return;
            }
          } catch (err) {
            logger.error('Failed to fetch patient for assignment check:', err);
            // Continue to close modal even if we can't check
          }
        }

        // Close modal if no prompt needed
        onClose();
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
    if (error && dateString) setError(null);
  };

  // Render form step content (without buttons)
  const renderFormStepContent = () => {
    if (isInitialLoading) {
      return <AppointmentFormSkeleton />;
    }

    return (
      <div className="space-y-4">
        {/* Patient search and selection */}
        <div ref={patientFieldRef}>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            病患 <span className="text-red-500">*</span>
            {validationErrors.patient && (
              <span className="ml-2 text-sm font-normal text-red-600">{validationErrors.patient}</span>
            )}
          </label>
          <div className="flex items-center gap-2" data-testid="patient-selector">
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
                data-testid="create-patient-button"
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

        {hasGrouping ? (
          <div ref={appointmentTypeFieldRef}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              預約類型 <span className="text-red-500">*</span>
              {validationErrors.appointmentType && (
                <span className="ml-2 text-sm font-normal text-red-600">{validationErrors.appointmentType}</span>
              )}
            </label>
            <button
              type="button"
              onClick={() => setIsServiceItemModalOpen(true)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-left bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              {selectedAppointmentTypeId ? (() => {
                const selectedType = appointmentTypes.find(at => at.id === selectedAppointmentTypeId);
                if (!selectedType) return '選擇預約類型';
                const duration = selectedType.duration_minutes ? `(${selectedType.duration_minutes}分鐘)` : '';
                return `${selectedType.name} ${duration}`.trim();
              })() : (
                '選擇預約類型'
              )}
            </button>
          </div>
        ) : (
          <div ref={appointmentTypeFieldRef}>
            <AppointmentTypeSelector
              value={selectedAppointmentTypeId}
              options={appointmentTypes}
              onChange={setSelectedAppointmentTypeId}
              requiredError={validationErrors.appointmentType || undefined}
            />
          </div>
        )}

        {/* Practitioner Selection Button */}
        <div ref={practitionerFieldRef}>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            治療師 <span className="text-red-500">*</span>


            {validationErrors.practitioner && (
              <span className="ml-2 text-sm font-normal text-red-600">{validationErrors.practitioner}</span>
            )}
          </label>
          <button
            type="button"
            onClick={() => setIsPractitionerModalOpen(true)}
            disabled={isLoadingPractitioners}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
          >
            {isLoadingPractitioners ? (
              '載入中...'
            ) : selectedPractitionerId ? (
              initialPractitioners.find(p => p.id === selectedPractitionerId)?.full_name || '未知治療師'
            ) : (
              '選擇治療師'
            )}
          </button>

          {/* Assigned Practitioner Info Message */}
          {selectedPatientId && selectedPractitionerId && assignedPractitionerIdsSet && !assignedPractitionerIdsSet.has(selectedPractitionerId) && (
            <div className="mt-2 text-xs text-blue-600 flex items-center gap-1">
              <span>ℹ️ 此病患的負責治療師為：</span>
              {Array.from(assignedPractitionerIdsSet).map((id, index) => {
                const name = initialPractitioners.find(p => p.id === id)?.full_name;
                return (
                  <span key={id}>
                    {name}{index < assignedPractitionerIdsSet.size - 1 ? '、' : ''}
                  </span>
                );
              })}
            </div>
          )}


        </div>

        {/* Practitioner Selection Modal */}
        <PractitionerSelectionModal
          isOpen={isPractitionerModalOpen}
          onClose={() => setIsPractitionerModalOpen(false)}
          onSelect={(practitionerId) => {
            setSelectedPractitionerId(practitionerId);
            setIsPractitionerModalOpen(false);
          }}
          practitioners={initialPractitioners}
          selectedPractitionerId={selectedPractitionerId}
          originalPractitionerId={isDuplication ? event?.resource.practitioner_id || null : null}
          assignedPractitionerIds={assignedPractitionerIdsSet || EMPTY_ARRAY}
          practitionerConflicts={practitionerConflictsWithTypeMismatch}
          isLoadingConflicts={practitionerConflictsQuery.isLoading}
        />

        <AppointmentReferenceHeader referenceDateTime={referenceDateTime} />

        <div ref={dateTimeFieldRef}>
          <DateTimePicker
            selectedDate={selectedDate}
            selectedTime={selectedTime}
            selectedPractitionerId={selectedPractitionerId}
            appointmentTypeId={selectedAppointmentTypeId}
            onDateSelect={handleDateSelect}
            onTimeSelect={setSelectedTime}
            error={error && error.includes('衝突') ? error : null}
            requiredError={validationErrors.dateTime || null}
            allowOverride={true}
            initialExpanded={false}

            canExpand={!!selectedPractitionerId && !!selectedAppointmentTypeId}
          />
        </div>

        {/* Recurrence Toggle */}
        <div ref={recurrenceCountFieldRef} className="flex items-center gap-4">
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              const newValue = !recurrenceEnabled;
              setRecurrenceEnabled(newValue);
              if (!newValue) {
                setOccurrences([]);
                setWeeksInterval(1);
                setOccurrenceCount(null);
                setHasVisitedConflictResolution(false);
              } else {
                setOccurrenceCount(1);
              }
              // Clear validation errors when toggling recurrence
              setValidationErrors({});
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

          {recurrenceEnabled && (
            <div className="flex items-center gap-2 flex-1" onMouseDown={(e) => e.stopPropagation()}>
              <label className="text-sm font-medium text-gray-700 whitespace-nowrap">每</label>
              <NumberInput
                value={weeksInterval}
                onChange={setWeeksInterval}
                fallback={1}
                parseFn="parseInt"
                min={1}
                className="w-16 border border-gray-300 rounded-md px-2 py-1 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <label className="text-sm font-medium text-gray-700 whitespace-nowrap">週,</label>
              <label className="text-sm font-medium text-gray-700 whitespace-nowrap">共</label>
              <input
                type="number"
                min="1"
                max="50"
                value={occurrenceCount || ''}
                onChange={(e) => {
                  const value = e.target.value ? parseInt(e.target.value) : null;
                  if (value !== null) {
                    setOccurrenceCount(Math.max(1, Math.min(50, value)));
                    // Clear error on change
                    setValidationErrors(prev => {
                      const newErrors = { ...prev };
                      delete newErrors.recurrenceCount;
                      return newErrors;
                    });
                  } else {
                    setOccurrenceCount(null);
                  }
                }}
                onWheel={preventScrollWheelChange}
                className={`w-16 border rounded-md px-2 py-1 text-center focus:outline-none focus:ring-2 focus:ring-blue-500 ${validationErrors.recurrenceCount ? 'border-red-300 ring-1 ring-red-500' : 'border-gray-300'
                  }`}
              />
              <label className="text-sm font-medium text-gray-700 whitespace-nowrap">次</label>
              {validationErrors.recurrenceCount && (
                <span className="text-sm font-normal text-red-600 ml-1">{validationErrors.recurrenceCount}</span>
              )}
            </div>
          )}
        </div>

        {selectedAppointmentTypeId && selectedPractitionerId && selectedDate && selectedTime && (
          <ResourceSelection
            appointmentTypeId={selectedAppointmentTypeId}
            practitionerId={selectedPractitionerId}
            date={selectedDate}
            startTime={selectedTime}
            durationMinutes={appointmentTypes.find(t => t.id === selectedAppointmentTypeId)?.duration_minutes || 30}
            selectedResourceIds={selectedResourceIds}
            onSelectionChange={setSelectedResourceIds}
            skipInitialDebounce={isDuplication}
            conflictInfo={singleAppointmentConflict}
          />
        )}

        {/* Conflict display - show conflicts when they exist */}
        {singleAppointmentConflict && singleAppointmentConflict.has_conflict && (
          <div className="mt-2">
            <ConflictDisplay
              conflictInfo={singleAppointmentConflict}
            />
          </div>
        )}

        <div data-testid="clinic-notes">
          <label className="block text-sm font-medium text-gray-700 mb-1">診所備註</label>
          <ClinicNotesTextarea
            value={clinicNotes}
            onChange={(e) => setClinicNotes(e.target.value)}
            rows={4}
          />
        </div>
      </div>
    );
  };

  const renderFormStepFooter = () => {
    const errorFields = Object.keys(validationErrors).filter(key => validationErrors[key]);
    const hasErrors = errorFields.length > 0;

    return (
      <div className="pt-4 border-t border-gray-200 flex-shrink-0" onMouseDown={(e) => e.stopPropagation()}>
        {/* Validation Error Summary */}
        {hasErrors && (
          <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-800">
            <div className="flex items-start gap-2">
              <span className="flex-shrink-0 text-base leading-tight">⚠️</span>
              <div className="flex-1 leading-tight">
                <span className="font-medium">請填寫必填欄位：</span>
                {errorFields.map(getFieldDisplayName).join('、')}
              </div>
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="flex justify-end items-center space-x-2">
          <ConflictWarningButton conflictInfo={singleAppointmentConflict} />
          <button
            onClick={handleFormSubmit}
            disabled={isCheckingConflicts || isInitialLoading}
            className={`btn-primary ${(isCheckingConflicts || isInitialLoading)
              ? 'opacity-50 cursor-not-allowed'
              : ''
              }`}
          >
            {isCheckingConflicts ? '正在檢查衝突...' : '下一步'}
          </button>
        </div>
      </div>
    );
  };

  const renderConflictResolutionStepContent = () => (
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
                    <span className="text-sm font-medium text-gray-900">{formattedDateTime}</span>
                    {occ.hasConflict && occ.conflictInfo && (
                      <ConflictIndicator conflictInfo={occ.conflictInfo} compact={true} />
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => setOccurrences(occurrences.filter(o => o.id !== occ.id))}
                    className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-md transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setEditingOccurrenceId(occ.id)}
                    className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </div>
              </div>

              {isEditing && selectedAppointmentTypeId && selectedPractitionerId && (
                <div className="border-t border-gray-200 pt-3 space-y-3">
                  <RecurrenceDateTimePickerWrapper
                    initialDate={occ.date}
                    initialTime={occ.time}
                    selectedPractitionerId={selectedPractitionerId}
                    appointmentTypeId={selectedAppointmentTypeId}
                    onConfirm={async (date, time) => {
                      if (occurrences.some(o => o.id !== occ.id && o.date === date && o.time === time)) {
                        setError('此時間已在列表中，請選擇其他時間');
                        return;
                      }

                      try {
                        const occurrenceString = moment.tz(`${date}T${time}`, 'Asia/Taipei').toISOString();
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

                        const conflictInfo = convertConflictStatusToResponse(conflictStatus);
                        setOccurrences(occurrences.map(o => o.id === occ.id ? {
                          ...o, date, time,
                          hasConflict: conflictStatus.has_conflict || false,
                          conflictInfo: conflictInfo?.has_conflict ? conflictInfo : null
                        } : o));
                        setEditingOccurrenceId(null);
                        setError(null);
                      } catch (err) {
                        logger.error('Error checking conflict for edited occurrence:', err);
                        setError('無法檢查衝突，請稍後再試');
                      }
                    }}
                    onCancel={() => setEditingOccurrenceId(null)}
                  />
                  <div className="border-t border-gray-200 pt-3">
                    <ResourceSelection
                      appointmentTypeId={selectedAppointmentTypeId}
                      practitionerId={selectedPractitionerId}
                      date={occ.date}
                      startTime={occ.time}
                      durationMinutes={appointmentTypes.find(t => t.id === selectedAppointmentTypeId)?.duration_minutes || 30}
                      selectedResourceIds={occurrenceResourceIds[occ.id] || EMPTY_ARRAY}
                      onSelectionChange={(ids) => setOccurrenceResourceIds({ ...occurrenceResourceIds, [occ.id]: ids })}
                      conflictInfo={occ.conflictInfo}
                    />
                  </div>
                </div>
              )}

              {!isEditing && selectedAppointmentTypeId && selectedPractitionerId && (
                <div className="border-t border-gray-200 pt-3">
                  <ResourceSelection
                    appointmentTypeId={selectedAppointmentTypeId}
                    practitionerId={selectedPractitionerId}
                    date={occ.date}
                    startTime={occ.time}
                    durationMinutes={appointmentTypes.find(t => t.id === selectedAppointmentTypeId)?.duration_minutes || 30}
                    selectedResourceIds={occurrenceResourceIds[occ.id] || EMPTY_ARRAY}
                    onSelectionChange={(ids) => setOccurrenceResourceIds({ ...occurrenceResourceIds, [occ.id]: ids })}
                    conflictInfo={occ.conflictInfo}
                  />
                </div>
              )}
            </div>
          );
        })}

        {!addingOccurrence && (
          <button
            onClick={() => setAddingOccurrence(true)}
            className="w-full flex items-center justify-center gap-2 p-3 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md border border-dashed border-blue-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-sm font-medium">新增</span>
          </button>
        )}

        {addingOccurrence && selectedAppointmentTypeId && selectedPractitionerId && (
          <div className="border-t border-gray-200 pt-3">
            <RecurrenceDateTimePickerWrapper
              initialDate={null}
              initialTime={''}
              selectedPractitionerId={selectedPractitionerId}
              appointmentTypeId={selectedAppointmentTypeId}
              onConfirm={async (date, time) => {
                if (occurrences.some(o => o.date === date && o.time === time)) {
                  setError('此時間已在列表中，請選擇其他時間');
                  return;
                }

                try {
                  const occurrenceString = moment.tz(`${date}T${time}`, 'Asia/Taipei').toISOString();
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

                  const conflictInfo = convertConflictStatusToResponse(conflictStatus);
                  const newOccId = `new-${Date.now()}`;
                  setOccurrenceResourceIds({ ...occurrenceResourceIds, [newOccId]: [...selectedResourceIds] });
                  setOccurrences([...occurrences, {
                    id: newOccId, date, time,
                    hasConflict: conflictStatus.has_conflict || false,
                    conflictInfo: conflictInfo?.has_conflict ? conflictInfo : null
                  }]);
                  setAddingOccurrence(false);
                  setError(null);
                } catch (err) {
                  logger.error('Error checking conflict for new occurrence:', err);
                  setError('無法檢查衝突，請稍後再試');
                }
              }}
              onCancel={() => setAddingOccurrence(false)}
            />
          </div>
        )}
      </div>

      {occurrences.length === 0 && (
        <div className="text-center py-4 text-red-600 text-sm">至少需要一個預約時段</div>
      )}
    </div>
  );

  const renderConflictResolutionStepFooter = () => (
    <div className="flex justify-end space-x-2 pt-4 border-t border-gray-200 flex-shrink-0">
      <button
        onClick={() => {
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
          setHasVisitedConflictResolution(true);
          setStep('confirm');
        }}
        disabled={occurrences.length === 0}
        className={`btn-primary ${occurrences.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        下一步
      </button>
    </div>
  );

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
                          <ConflictIndicator conflictInfo={occ.conflictInfo} compact={true} />
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
                <ConflictIndicator conflictInfo={singleAppointmentConflict} compact={true} />
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

  const renderConfirmStepFooter = () => (
    <div className="flex justify-end space-x-2 pt-4 border-t border-gray-200 flex-shrink-0">
      <button
        onClick={() => {
          if (hasVisitedConflictResolution) setStep('conflict-resolution');
          else setStep('form');
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
        data-testid="create-appointment-submit"
      >
        {isSaving ? '建立中...' : '確認建立'}
      </button>
    </div>
  );

  const handlePatientCreated = useCallback((patientId: number, patientName: string, phoneNumber: string | null, birthday: string | null) => {
    setCreatedPatientId(patientId);
    setCreatedPatientName(patientName);
    setCreatedPatientPhone(phoneNumber);
    setCreatedPatientBirthday(birthday);
    setIsCreatePatientModalOpen(false);
    setIsSuccessModalOpen(true);
  }, []);

  const handleSuccessModalClose = useCallback(() => {
    setIsSuccessModalOpen(false);
    setCreatedPatientId(null);
    setCreatedPatientName('');
    setCreatedPatientPhone(null);
    setCreatedPatientBirthday(null);
    onClose();
  }, [onClose]);

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
        id: createdPatientId, clinic_id: 0, full_name: createdPatientName,
        phone_number: createdPatientPhone, created_at: new Date().toISOString(),
      };
      if (createdPatientBirthday) fallbackPatient.birthday = createdPatientBirthday;

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
          if (fullPatientData) setPreSelectedPatientData(fullPatientData);
          refetchPatients();
        } catch (err) {
          logger.warn('Failed to fetch full patient data, using fallback data:', err);
        }
      })();
    }
  }, [createdPatientId, createdPatientName, createdPatientPhone, createdPatientBirthday, refetchPatients, setSelectedPatientId]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const modalTitle = step === 'form' ? '建立預約' : step === 'conflict-resolution' ? '解決衝突' : '確認預約';

  return (
    <>
      <BaseModal onClose={handleClose} aria-label={modalTitle} className="!p-0" fullScreen={isMobile}>
        <div className={`flex flex-col h-full ${isMobile ? 'px-4 pt-4 pb-0' : 'px-6 pt-6 pb-6'}`}>
          <div className="flex items-center mb-4 flex-shrink-0">
            <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mr-2">
              <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                <path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-blue-800">{modalTitle}</h3>
          </div>

          {error && step !== 'form' && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3 flex-shrink-0">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <div className={`flex-1 overflow-y-auto ${isMobile ? 'px-0' : ''}`}>
            {step === 'form' && renderFormStepContent()}
            {step === 'conflict-resolution' && renderConflictResolutionStepContent()}
            {step === 'confirm' && renderConfirmStepContent()}
          </div>

          <div className={`flex-shrink-0 ${isMobile ? 'px-4' : ''}`} style={isMobile ? { paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' } : undefined}>
            {step === 'form' && renderFormStepFooter()}
            {step === 'conflict-resolution' && renderConflictResolutionStepFooter()}
            {step === 'confirm' && renderConfirmStepFooter()}
          </div>
        </div>
      </BaseModal>

      {/* Service Item Selection Modal */}
      <ServiceItemSelectionModal
        isOpen={isServiceItemModalOpen}
        onClose={() => setIsServiceItemModalOpen(false)}
        onSelect={handleServiceItemSelect}
        serviceItems={appointmentTypes}
        groups={groups}
        selectedServiceItemId={selectedAppointmentTypeId || undefined}
        practitionerAppointmentTypeIds={practitionerAppointmentTypeIds}
        title="選擇預約類型"
      />

      <PatientCreationModal isOpen={isCreatePatientModalOpen} onClose={() => setIsCreatePatientModalOpen(false)} onSuccess={handlePatientCreated} />

      {createdPatientId && <PatientCreationSuccessModal isOpen={isSuccessModalOpen} onClose={handleSuccessModalClose} patientId={createdPatientId} patientName={createdPatientName} phoneNumber={createdPatientPhone} birthday={createdPatientBirthday} onCreateAppointment={handleCreateAppointmentFromSuccess} />}
    </>
  );
});

CreateAppointmentModal.displayName = 'CreateAppointmentModal';

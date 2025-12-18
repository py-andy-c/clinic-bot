import { useState, useEffect, useMemo, useRef } from 'react';
import { apiService } from '../services/api';
import { CalendarEvent } from '../utils/calendarDataAdapter';
import moment from 'moment-timezone';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../types/api';

export type AppointmentFormMode = 'create' | 'edit' | 'duplicate';

export interface UseAppointmentFormProps {
  mode: AppointmentFormMode;
  event?: CalendarEvent | null | undefined;
  appointmentTypes: { id: number; name: string; duration_minutes: number }[];
  practitioners: { id: number; full_name: string }[];
  initialDate?: string | null | undefined;
  preSelectedPatientId?: number | null | undefined;
  preSelectedAppointmentTypeId?: number | null | undefined;
  preSelectedPractitionerId?: number | null | undefined;
  preSelectedTime?: string | null | undefined;
  preSelectedClinicNotes?: string | null | undefined;
  preSelectedResourceIds?: number[] | null | undefined;
}

export const useAppointmentForm = ({
  mode,
  event,
  appointmentTypes: _appointmentTypes,
  practitioners: allPractitioners,
  initialDate,
  preSelectedPatientId,
  preSelectedAppointmentTypeId,
  preSelectedPractitionerId,
  preSelectedTime,
  preSelectedClinicNotes,
  preSelectedResourceIds,
}: UseAppointmentFormProps) => {
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(preSelectedPatientId || event?.resource.patient_id || null);
  const [selectedAppointmentTypeId, setSelectedAppointmentTypeId] = useState<number | null>(null);
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [clinicNotes, setClinicNotes] = useState<string>('');
  const [selectedResourceIds, setSelectedResourceIds] = useState<number[]>([]);
  
  const [availablePractitioners, setAvailablePractitioners] = useState<{ id: number; full_name: string }[]>(allPractitioners);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingPractitioners, setIsLoadingPractitioners] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const isInitialMountRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastFetchedTypeIdRef = useRef<number | null>(null);

  // Reference date/time for display (Original appointment time)
  const referenceDateTime = useMemo(() => {
    if (!event) return null;
    return moment(event.start).tz('Asia/Taipei').toDate();
  }, [event]);

  // Initial state setup based on mode and props
  useEffect(() => {
    if (!isInitialMountRef.current) return;

    const init = async () => {
      setIsInitialLoading(true);
      setError(null);
      
      // Setup AbortController for cleanup
      if (abortControllerRef.current) abortControllerRef.current.abort();
      abortControllerRef.current = new AbortController();

      try {
        let typeId = preSelectedAppointmentTypeId || event?.resource.appointment_type_id || null;
        let pracId = preSelectedPractitionerId || event?.resource.practitioner_id || null;
        let date = initialDate || (event ? moment(event.start).tz('Asia/Taipei').format('YYYY-MM-DD') : null);
        let time = preSelectedTime || (event ? moment(event.start).tz('Asia/Taipei').format('HH:mm') : '');
        let notes = preSelectedClinicNotes || event?.resource.clinic_notes || '';
        let resourceIds = preSelectedResourceIds || [];

        // Special handling for duplication mode: clear time to avoid immediate conflict
        if (mode === 'duplicate') {
          time = '';
        }

        setSelectedAppointmentTypeId(typeId);
        setSelectedPractitionerId(pracId);
        setSelectedDate(date);
        setSelectedTime(time);
        setClinicNotes(notes);
        setSelectedResourceIds(resourceIds);
        
        // Track the initial type ID as "fetched"
        lastFetchedTypeIdRef.current = typeId;

        // Parallel data fetching: Practitioners filtered by type and Original Resources
        const fetchTasks: Promise<any>[] = [];
        const signal = abortControllerRef.current?.signal;
        
        // 1. Fetch practitioners for the appointment type
        if (typeId) {
          fetchTasks.push(apiService.getPractitioners(typeId, signal));
        } else {
          fetchTasks.push(Promise.resolve(allPractitioners));
        }

        // 2. Fetch original resources if editing or duplicating
        const shouldFetchResources = (mode === 'edit' || mode === 'duplicate') && event?.resource.calendar_event_id;
        if (shouldFetchResources) {
          fetchTasks.push(apiService.getAppointmentResources(event.resource.calendar_event_id, signal));
        }

        const results = await Promise.allSettled(fetchTasks);

        // Handle practitioners result
        const practitionersResult = results[0];
        if (practitionersResult && practitionersResult.status === 'fulfilled') {
          const sorted = [...practitionersResult.value].sort((a, b) => a.full_name.localeCompare(b.full_name, 'zh-TW'));
          setAvailablePractitioners(sorted);
          
          // Auto-deselect practitioner if current selection is not in the filtered list
          if (pracId && !sorted.find(p => p.id === pracId)) {
            setSelectedPractitionerId(null);
            setSelectedTime('');
          }
        } else if (practitionersResult && practitionersResult.status === 'rejected') {
          logger.error('Failed to fetch practitioners:', practitionersResult.reason);
          setAvailablePractitioners([]);
          setError('無法載入治療師列表，請稍後再試');
        }

        // Handle resources result
        if (shouldFetchResources && results[1]) {
          const resourcesResult = results[1];
          if (resourcesResult && resourcesResult.status === 'fulfilled') {
            const ids = resourcesResult.value.resources.map((r: any) => r.id);
            setSelectedResourceIds(ids);
          } else if (resourcesResult && resourcesResult.status === 'rejected') {
            logger.error('Failed to load appointment resources:', resourcesResult.reason);
            // Don't block the form if resources fail to load
          }
        }

      } catch (err) {
        logger.error('Error initializing appointment form:', err);
        setError(getErrorMessage(err));
      } finally {
        setIsInitialLoading(false);
        isInitialMountRef.current = false;
      }
    };

    init();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [mode, event, preSelectedAppointmentTypeId, preSelectedPractitionerId, preSelectedTime, preSelectedClinicNotes, preSelectedResourceIds, initialDate, allPractitioners]);

  // Fetch practitioners when appointment type changes (after initial mount)
  useEffect(() => {
    if (isInitialMountRef.current || isInitialLoading) return;
    
    // Skip if this type was already fetched (prevents redundant fetch after initial load)
    if (selectedAppointmentTypeId === lastFetchedTypeIdRef.current) return;

    let isStale = false;

    const fetchPractitioners = async () => {
      if (!selectedAppointmentTypeId) {
        if (!isStale) {
          setAvailablePractitioners(allPractitioners);
          lastFetchedTypeIdRef.current = null;
        }
        return;
      }

      setIsLoadingPractitioners(true);
      const signal = abortControllerRef.current?.signal;
      try {
        const fetched = await apiService.getPractitioners(selectedAppointmentTypeId, signal);
        if (isStale) return;

        const sorted = [...fetched].sort((a, b) => a.full_name.localeCompare(b.full_name, 'zh-TW'));
        setAvailablePractitioners(sorted);
        lastFetchedTypeIdRef.current = selectedAppointmentTypeId;
      } catch (err) {
        if (isStale) return;
        logger.error('Failed to fetch practitioners:', err);
        setError('無法載入治療師列表，請稍後再試');
        setAvailablePractitioners([]);
      } finally {
        if (!isStale) setIsLoadingPractitioners(false);
      }
    };

    fetchPractitioners();

    return () => {
      isStale = true;
    };
  }, [selectedAppointmentTypeId, allPractitioners, isInitialLoading]);

  // Auto-deselection logic: when available practitioners change, check if current selection is still valid
  useEffect(() => {
    if (isInitialLoading || !selectedPractitionerId) return;

    if (!availablePractitioners.find(p => p.id === selectedPractitionerId)) {
      setSelectedPractitionerId(null);
      setSelectedTime('');
    }
  }, [availablePractitioners, selectedPractitionerId, isInitialLoading]);

  // Auto-deselection logic when type is null
  useEffect(() => {
    if (isInitialMountRef.current || isInitialLoading) return;

    if (selectedAppointmentTypeId === null && (selectedPractitionerId !== null || selectedTime !== '')) {
      setSelectedPractitionerId(null);
      setSelectedDate(null);
      setSelectedTime('');
    }
  }, [selectedAppointmentTypeId, selectedPractitionerId, selectedTime, isInitialLoading]);

  // Handle practitioner null state
  useEffect(() => {
    if (isInitialMountRef.current || isInitialLoading) return;

    if (selectedPractitionerId === null && (selectedDate !== null || selectedTime !== '')) {
      setSelectedDate(null);
      setSelectedTime('');
    }
  }, [selectedPractitionerId, selectedDate, selectedTime, isInitialLoading]);

  // Form validity check
  const isValid = useMemo(() => {
    if (mode === 'create' || mode === 'duplicate') {
      return !!selectedPatientId && !!selectedAppointmentTypeId && !!selectedPractitionerId && !!selectedDate && !!selectedTime;
    }
    // For edit, check if required fields are present
    return !!selectedAppointmentTypeId && !!selectedPractitionerId && !!selectedDate && !!selectedTime;
  }, [mode, selectedPatientId, selectedAppointmentTypeId, selectedPractitionerId, selectedDate, selectedTime]);

  // Check if any changes have been made (for edit mode)
  const changeDetails = useMemo(() => {
    if (mode !== 'edit' || !event || !selectedAppointmentTypeId || !selectedPractitionerId || !selectedTime) {
      return { appointmentTypeChanged: false, practitionerChanged: false, timeChanged: false, dateChanged: false };
    }

    const originalStartTime = moment(event.start).tz('Asia/Taipei');
    const newStartTime = moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei');
    
    const timeChanged = !newStartTime.isSame(originalStartTime, 'minute');
    const dateChanged = !newStartTime.isSame(originalStartTime, 'day');
    const practitionerChanged = selectedPractitionerId !== event.resource.practitioner_id;
    const appointmentTypeChanged = selectedAppointmentTypeId !== event.resource.appointment_type_id;

    return { appointmentTypeChanged, practitionerChanged, timeChanged, dateChanged };
  }, [mode, event, selectedDate, selectedTime, selectedPractitionerId, selectedAppointmentTypeId]);

  const hasChanges = useMemo(() => {
    return changeDetails.appointmentTypeChanged || changeDetails.practitionerChanged || changeDetails.timeChanged || changeDetails.dateChanged;
  }, [changeDetails]);

  return {
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
    hasChanges,
    changeDetails,
  };
};

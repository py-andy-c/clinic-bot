import { useState, useEffect, useMemo, useRef } from 'react';
import { apiService } from '../services/api';
import { CalendarEvent } from '../utils/calendarDataAdapter';
import moment from 'moment-timezone';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../types/api';
import { ResourceAvailabilityResponse } from '../types';

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
  prePopulatedFromSlot?: boolean;
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
  prePopulatedFromSlot,
}: UseAppointmentFormProps) => {
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(preSelectedPatientId ?? event?.resource.patient_id ?? null);
  const [selectedAppointmentTypeId, setSelectedAppointmentTypeId] = useState<number | null>(
    preSelectedAppointmentTypeId ?? event?.resource.appointment_type_id ?? null
  );
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<number | null>(
    preSelectedPractitionerId ?? event?.resource.practitioner_id ?? null
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(() => {
    if (initialDate) return initialDate;
    if (event) return moment(event.start).tz('Asia/Taipei').format('YYYY-MM-DD');
    return null;
  });
  const [selectedTime, setSelectedTime] = useState<string>(() => {
    // For duplication mode, don't pre-populate time to avoid immediate conflict
    if (preSelectedTime) return preSelectedTime;
    if (event && !preSelectedTime) return '';  // Duplication: clear time
    return '';
  });
  const [clinicNotes, setClinicNotes] = useState<string>(preSelectedClinicNotes ?? event?.resource.clinic_notes ?? '');
  const [selectedResourceIds, setSelectedResourceIds] = useState<number[]>(event?.resource.resource_ids ?? []);
  const [initialResourceIds, setInitialResourceIds] = useState<number[]>([]);
  const [initialResources, setInitialResources] = useState<Array<{ id: number; resource_type_id: number; resource_type_name?: string; name: string }>>([]);
  const [initialAvailability, setInitialAvailability] = useState<ResourceAvailabilityResponse | null>(null);

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

      // Instant UI: Setup form state while fetching fresh data in the background
      const hasEventData = mode === 'edit' && event && (
        event.resource.appointment_type_id &&
        event.resource.practitioner_id &&
        (event.resource.resource_ids && event.resource.resource_ids.length > 0)
      );

      try {
        // State is now initialized directly from props in useState()
        // We only need to set lastFetchedTypeIdRef and initialResourceIds here
        const typeId = preSelectedAppointmentTypeId ?? event?.resource.appointment_type_id ?? null;
        const resourceIds = event?.resource.resource_ids ?? [];

        lastFetchedTypeIdRef.current = typeId;

        if (hasEventData && resourceIds.length > 0) {
          setInitialResourceIds(resourceIds);
        }

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

        // 3. Fetch resource availability for edit mode (when we have all required data)
        const pracId = preSelectedPractitionerId ?? event?.resource.practitioner_id ?? null;
        const dateValue = initialDate ?? (event ? moment(event.start).tz('Asia/Taipei').format('YYYY-MM-DD') : null);
        const timeValue = preSelectedTime ?? (event ? moment(event.start).tz('Asia/Taipei').format('HH:mm') : null);
        const shouldFetchAvailability = mode === 'edit' && typeId && pracId && dateValue && timeValue;
        if (shouldFetchAvailability) {
          // Get duration from appointment type
          const appointmentType = _appointmentTypes.find(t => t.id === typeId);
          const durationMinutes = appointmentType?.duration_minutes || 30;

          // Calculate end time
          const startMoment = moment.tz(`${dateValue}T${timeValue}`, 'Asia/Taipei');
          const endMoment = startMoment.clone().add(durationMinutes, 'minutes');

          const availabilityParams: {
            appointment_type_id: number;
            practitioner_id: number;
            date: string;
            start_time: string;
            end_time: string;
            exclude_calendar_event_id?: number;
          } = {
            appointment_type_id: typeId,
            practitioner_id: pracId,
            date: dateValue,
            start_time: startMoment.format('HH:mm'),
            end_time: endMoment.format('HH:mm'),
          };

          if (event?.resource.calendar_event_id) {
            availabilityParams.exclude_calendar_event_id = event.resource.calendar_event_id;
          }

          fetchTasks.push(apiService.getResourceAvailability(availabilityParams, signal));
        }

        const results = await Promise.allSettled(fetchTasks);

        // Handle practitioners result
        const practitionersResult = results[0];
        let practitionersReadyFromResult = false;

        if (practitionersResult && practitionersResult.status === 'fulfilled') {
          const sorted = [...practitionersResult.value].sort((a, b) => a.full_name.localeCompare(b.full_name, 'zh-TW'));
          setAvailablePractitioners(sorted);
          practitionersReadyFromResult = true;
        } else if (practitionersResult && practitionersResult.status === 'rejected') {
          const reason = practitionersResult.reason;
          if (reason?.name !== 'CanceledError' && reason?.name !== 'AbortError') {
            logger.error('Failed to fetch practitioners:', reason);
            setAvailablePractitioners([]);
            setError('無法載入治療師列表，請稍後再試');
            practitionersReadyFromResult = false;
          } else {
            // Request was aborted (likely due to React strict mode or component unmount)
            // Use allPractitioners as fallback since we have that data available
            const sorted = [...allPractitioners].sort((a, b) => a.full_name.localeCompare(b.full_name, 'zh-TW'));
            setAvailablePractitioners(sorted);
            practitionersReadyFromResult = true;
          }
        } else {
          // Missing result - use allPractitioners as fallback
          const sorted = [...allPractitioners].sort((a, b) => a.full_name.localeCompare(b.full_name, 'zh-TW'));
          setAvailablePractitioners(sorted);
          practitionersReadyFromResult = true;
        }

        // Handle resources result
        const resourcesResult = shouldFetchResources ? results[1] : null;
        const availabilityResult = shouldFetchAvailability ? results[shouldFetchResources ? 2 : 1] : null;

        // Wait for both initialResources and initialAvailability (for edit mode) before showing the form
        if (shouldFetchResources && resourcesResult) {
          if (resourcesResult.status === 'fulfilled') {
            // Use fetched resources (more fresh) - this updates the initial state if it changed
            const fetchedResources = resourcesResult.value.resources;
            const ids = fetchedResources.map((r: any) => r.id);
            const resourceData = fetchedResources.map((r: any) => ({
              id: r.id,
              resource_type_id: r.resource_type_id,
              resource_type_name: r.resource_type_name,
              name: r.name,
            }));
            setSelectedResourceIds(ids);
            setInitialResourceIds(ids);
            setInitialResources(resourceData);
          } else if (resourcesResult.status === 'rejected') {
            const reason = resourcesResult.reason;
            if (reason?.name !== 'CanceledError' && reason?.name !== 'AbortError') {
              logger.error('Failed to load appointment resources, falling back to event data:', reason);
              // Don't block the form if resources fail to load
              // Keep using event.resource.resource_ids that were set initially (graceful degradation)
              if (resourceIds.length > 0) {
                logger.info(`Using ${resourceIds.length} resource(s) from event data as fallback`);
              }
            }
          }
        }

        // Handle availability result (edit mode only)
        if (shouldFetchAvailability && availabilityResult) {
          if (availabilityResult.status === 'fulfilled') {
            setInitialAvailability(availabilityResult.value);
          } else if (availabilityResult.status === 'rejected') {
            const reason = availabilityResult.reason;
            if (reason?.name !== 'CanceledError' && reason?.name !== 'AbortError') {
              logger.error('Failed to load resource availability:', reason);
              // Don't block the form if availability fails to load (graceful degradation)
            }
          }
        }

        // Set loading to false only after all required data is loaded
        // Use practitionersReadyFromResult which handles aborted requests with fallback data
        const practitionersReady = practitionersReadyFromResult;

        // Resources are ready if not needed, fetched successfully, or aborted/failed (we have fallback data)
        const resourcesReady = !shouldFetchResources ||
          resourcesResult?.status === 'fulfilled' ||
          (resourcesResult?.status === 'rejected' &&
            (resourcesResult.reason?.name === 'CanceledError' ||
              resourcesResult.reason?.name === 'AbortError' ||
              resourceIds.length > 0)); // Have fallback data

        // Availability is ready if not needed, fetched successfully, or aborted/failed (not critical)
        const availabilityReady = !shouldFetchAvailability ||
          availabilityResult?.status === 'fulfilled' ||
          availabilityResult?.status === 'rejected'; // Always ready if attempted (graceful degradation)

        // Wait for practitioners (always required) and resources/availability if needed
        if (practitionersReady && resourcesReady && availabilityReady) {
          setIsInitialLoading(false);
        } else if (practitionersReady && !shouldFetchResources && !shouldFetchAvailability) {
          // Create/duplicate mode: only practitioners needed
          setIsInitialLoading(false);
        }

      } catch (err: any) {
        if (err?.name !== 'CanceledError' && err?.name !== 'AbortError') {
          logger.error('Error initializing appointment form:', err);
          setError(getErrorMessage(err));
        }
        // Set loading to false on error to prevent blocking the UI
        setIsInitialLoading(false);
      } finally {
        isInitialMountRef.current = false;
      }
    };

    init();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [mode, event, preSelectedAppointmentTypeId, preSelectedPractitionerId, preSelectedTime, preSelectedClinicNotes, initialDate, allPractitioners]);

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
      } catch (err: any) {
        if (isStale || err?.name === 'CanceledError' || err?.name === 'AbortError') return;
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

  // NOTE: Cascading deselection logic has been removed.
  // All fields can now be selected independently in any order.
  // Mismatch warnings are shown in the UI but don't block selection.

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
      return {
        appointmentTypeChanged: false,
        practitionerChanged: false,
        timeChanged: false,
        dateChanged: false,
        resourcesChanged: false
      };
    }

    const originalStartTime = moment(event.start).tz('Asia/Taipei');
    const newStartTime = moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei');

    const timeChanged = !newStartTime.isSame(originalStartTime, 'minute');
    const dateChanged = !newStartTime.isSame(originalStartTime, 'day');
    const practitionerChanged = selectedPractitionerId !== event.resource.practitioner_id;
    const appointmentTypeChanged = selectedAppointmentTypeId !== event.resource.appointment_type_id;

    // Check if resources changed
    const resourcesChanged = selectedResourceIds.length !== initialResourceIds.length ||
      !selectedResourceIds.every(id => initialResourceIds.includes(id)) ||
      !initialResourceIds.every(id => selectedResourceIds.includes(id));

    // Get appointment type names for display
    const originalAppointmentType = _appointmentTypes.find(t => t.id === event.resource.appointment_type_id);
    const newAppointmentType = _appointmentTypes.find(t => t.id === selectedAppointmentTypeId);

    // Get practitioner names for display
    const originalPractitioner = allPractitioners.find(p => p.id === event.resource.practitioner_id);
    const newPractitioner = allPractitioners.find(p => p.id === selectedPractitionerId);

    return {
      appointmentTypeChanged,
      practitionerChanged,
      timeChanged,
      dateChanged,
      resourcesChanged,
      // Include actual values for preview display
      originalAppointmentTypeName: originalAppointmentType?.name || 'Unknown',
      newAppointmentTypeName: newAppointmentType?.name || 'Unknown',
      originalPractitionerName: originalPractitioner?.full_name || 'Unknown',
      newPractitionerName: newPractitioner?.full_name || 'Unknown',
      originalStartTime: originalStartTime.format('YYYY-MM-DD HH:mm'),
      newStartTime: newStartTime.format('YYYY-MM-DD HH:mm')
    };
  }, [mode, event, selectedDate, selectedTime, selectedPractitionerId, selectedAppointmentTypeId, selectedResourceIds, initialResourceIds, _appointmentTypes, allPractitioners]);

  const hasChanges = useMemo(() => {
    return changeDetails.appointmentTypeChanged || changeDetails.practitionerChanged || changeDetails.timeChanged || changeDetails.dateChanged || changeDetails.resourcesChanged;
  }, [changeDetails]);

  // Check if current selection is incompatible according to configuration
  const hasPractitionerTypeMismatch = useMemo(() => {
    if (!selectedAppointmentTypeId || !selectedPractitionerId) return false;
    // Check if the selected practitioner is in the list of available practitioners for this type
    return !availablePractitioners.some(p => p.id === selectedPractitionerId);
  }, [selectedAppointmentTypeId, selectedPractitionerId, availablePractitioners]);

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
    initialResources,
    availablePractitioners,
    isInitialLoading,
    isLoadingPractitioners,
    error,
    setError,
    isValid,
    referenceDateTime,
    hasChanges,
    changeDetails,
    initialAvailability,
    hasPractitionerTypeMismatch,
    prePopulatedFromSlot,
  };
};
